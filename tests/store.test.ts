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
