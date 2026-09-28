import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { TrainingSession } from "@/lib/types";

/**
 * store 是「一个集合一个 JSON 文件」的实现，DATA_DIR 在模块加载时就定下来了，
 * 所以必须先设好环境变量、再动态 import，否则测试会写到项目真实的 data/ 里。
 */
let dir: string;
let store: typeof import("@/lib/store");

function makeSession(id: string): TrainingSession {
  return {
    id,
    scenario: "product-teardown",
    mode: "assistant",
    topic: "测试题目",
    status: "active",
    transcript: [],
    submission: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pm-trainer-test-"));
  process.env.PM_TRAINER_DATA_DIR = dir;
  store = await import("@/lib/store");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("store.mutate", () => {
  it("并发追加不会丢更新（回归：曾经后写覆盖前写，丢掉整轮回答）", async () => {
    const id = "sess-concurrent";
    await store.upsert("sessions", makeSession(id));

    await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        store.mutate("sessions", id, (current) => ({
          ...current,
          transcript: [
            ...current.transcript,
            { role: "user", content: `第 ${i} 轮`, at: "2026-01-01T00:00:00.000Z" },
          ],
        })),
      ),
    );

    const after = await store.findById("sessions", id);
    expect(after?.transcript).toHaveLength(8);
    // 八轮都在，且顺序完整（不是只有最后写进去的那一轮）
    expect(new Set(after?.transcript.map((t) => t.content)).size).toBe(8);
  });

  it("记录不存在时返回 null，不抛错", async () => {
    const result = await store.mutate("sessions", "not-there", (current) => current);
    expect(result).toBeNull();
  });

  it("updater 返回 null 表示放弃写入", async () => {
    const id = "sess-skip";
    await store.upsert("sessions", makeSession(id));

    const result = await store.mutate("sessions", id, () => null);

    expect(result).toBeNull();
    const after = await store.findById("sessions", id);
    expect(after?.topic).toBe("测试题目");
  });
});

describe("readCollection 播种语义", () => {
  it("文件不存在时会写入内置种子", async () => {
    const prompts = await store.readCollection("prompts");
    expect(prompts.length).toBeGreaterThan(0);
  });

  it("用户清空集合后不会再被塞回种子（回归：删不掉的集合）", async () => {
    await store.writeCollection("prompts", []);
    const after = await store.readCollection("prompts");
    expect(after).toEqual([]);
  });

  it("老数据缺了新增的内置 scope 时会补齐（回归：新提示词界面上看不见）", async () => {
    // 模拟「旧版本的 prompts.json」：只有训练那几条，没有题库那几条
    const seeded = (await import("@/lib/seed")).seedPrompts();
    const legacy = seeded.filter((t) => !t.scope.startsWith("question-"));
    const expectedMissing = seeded.filter((t) => t.scope.startsWith("question-"));
    await store.writeCollection("prompts", legacy);

    const after = await store.readCollection("prompts");
    const scopes = after.map((t) => t.scope);
    // 每一道题库提示词都应被补齐（不写死条数，免得下次加一条又挂）
    for (const t of expectedMissing) {
      expect(scopes).toContain(t.scope);
    }
    expect(scopes).toContain("question-classify");
    expect(scopes).toContain("question-answer");
    expect(scopes).toContain("question-review");
    expect(scopes).toContain("question-readings");
    // 原有条目一条不少，且总数 = 原有 + 补上的
    expect(after.length).toBe(legacy.length + expectedMissing.length);
  });

  it("老记录（还没有指纹字段）会跟上新版种子", async () => {
    const seeded = (await import("@/lib/seed")).seedPrompts();
    const target = seeded.find((t) => t.scope === "chat")!;

    // 模拟「旧版本写的记录」：还没有 seedHash 这个字段
    const legacy = { ...target, system: "旧版通用约束文案" };
    delete (legacy as { seedHash?: string }).seedHash;
    await store.writeCollection("prompts", [legacy]);

    const after = await store.readCollection("prompts");
    const chat = after.find((t) => t.scope === "chat")!;
    expect(chat.system).toBe(target.system);
    expect(chat.seedHash).toBe(target.seedHash);
  });

  it("用户改过的内置模板不会被新版种子覆盖", async () => {
    const seeded = (await import("@/lib/seed")).seedPrompts();
    const target = seeded.find((t) => t.scope === "chat")!;

    /* 用户手改后的状态：指纹停留在「播种时」的值（与当前种子不同），
       内容也被改过。指纹对不上就说明这中间被改过，保留不动。 */
    await store.writeCollection("prompts", [
      { ...target, system: "我自己改的约束，别动它", seedHash: "deadbeef" },
    ]);

    const after = await store.readCollection("prompts");
    const chat = after.find((t) => t.scope === "chat")!;
    expect(chat.system).toBe("我自己改的约束，别动它");
  });

  it("指纹在历史清单里的内置模板会升级（改名 / 改标准这类改动）", async () => {
    const seeded = (await import("@/lib/seed")).seedPrompts();
    const { LEGACY_SEED_HASHES } = await import("@/lib/seed-history");
    const target = seeded.find((t) => t.scope === "question-review")!;
    const oldHash = LEGACY_SEED_HASHES["question-review"][0];
    expect(oldHash).toBeTruthy();

    // 停在旧版内置、且旧指纹被登记过 → 应当升级
    await store.writeCollection("prompts", [
      { ...target, system: "旧版评分提示词", seedHash: oldHash },
    ]);

    const after = await store.readCollection("prompts");
    const review = after.find((t) => t.scope === "question-review")!;
    expect(review.system).toBe(target.system);
    expect(review.system).toContain("结构层次");
  });

  it("指纹不在历史清单里时保留（那就是用户改的）", async () => {
    const seeded = (await import("@/lib/seed")).seedPrompts();
    const target = seeded.find((t) => t.scope === "question-review")!;

    await store.writeCollection("prompts", [
      { ...target, system: "我自己写的评分标准", seedHash: "0badc0de" },
    ]);

    const after = await store.readCollection("prompts");
    const review = after.find((t) => t.scope === "question-review")!;
    expect(review.system).toBe("我自己写的评分标准");
  });

  it("被主动删掉的内置模板不会被补回来（回归：删不掉）", async () => {    const seeded = (await import("@/lib/seed")).seedPrompts();
    // 只剩「产品拆解」这一条
    const onlyTeardown = seeded.filter((t) => t.scope === "product-teardown");
    await store.writeCollection("prompts", onlyTeardown);

    // 用户把「产品拆解」也删了，DELETE 路由会记一笔
    await store.retirePromptScope("product-teardown");
    await store.writeCollection("prompts", []);

    const after = await store.readCollection("prompts");
    expect(after.map((t) => t.scope)).not.toContain("product-teardown");
  });
});

describe("readSettings 深合并", () => {
  it("落盘文件缺字段时能补齐嵌套默认值", async () => {
    // 模拟「旧版本写的 settings.json」：webSearch 只有一半字段
    await writeFile(
      path.join(dir, "settings.json"),
      JSON.stringify({ baseURL: "http://localhost:11434/v1", webSearch: { enabled: true } }),
      "utf8",
    );

    const settings = await store.readSettings();

    expect(settings.webSearch.enabled).toBe(true);
    // 缺失的嵌套字段回填默认值，而不是 undefined
    expect(settings.webSearch.provider).toBe("bing");
    expect(settings.webSearch.maxResults).toBe(5);
    expect(settings.webSearch.apiKey).toBe("");
    expect(settings.mcpServers).toEqual([]);
  });

  it("写回时会把 mcpServers 每项补齐形状", async () => {
    await store.writeSettings({
      mcpServers: [{ id: "m1", name: "x", url: "https://example.com/mcp" } as never],
    });
    const settings = await store.readSettings();

    expect(settings.mcpServers).toHaveLength(1);
    expect(settings.mcpServers[0]).toMatchObject({
      id: "m1",
      token: "",
      enabled: true,
    });
  });
});

describe("写盘是原子的", () => {
  it("写完不留临时文件", async () => {
    const id = "sess-atomic";
    await store.writeCollection("sessions", []);
    await store.upsert("sessions", makeSession(id));

    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    expect(files.some((f) => f.endsWith(".tmp"))).toBe(false);

    const raw = await readFile(path.join(dir, "sessions.json"), "utf8");
    expect(JSON.parse(raw)).toHaveLength(1);
  });
});
