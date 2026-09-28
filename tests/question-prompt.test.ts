import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PROMPT_SCOPES } from "@/lib/catalog";
import { seedPrompts } from "@/lib/seed";

/**
 * 题库的三条提示词必须和训练/报告走同一套模板存储。
 *
 * 回归的背景：这三条原来是硬编码在 src/lib/questions.ts 里的常量
 * （CLASSIFY_SYSTEM / ANSWER_SYSTEM / READING_SYSTEM），界面上既看不到
 * 也改不了 —— 「提示词管理」里管着训练和报告，唯独最常看到 AI 输出的
 * 「AI 回答」没有入口。这一组测试就是钉住「它们已经是可管理的模板」。
 *
 * 会真的读文件，所以先指 PM_TRAINER_DATA_DIR 再动态 import。
 */
const QUESTION_SCOPES = [
  "question-classify",
  "question-answer",
  "question-readings",
] as const;

let dir: string;
let prompts: typeof import("@/lib/prompts");

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "pm-trainer-qprompt-"));
  await writeFile(path.join(dir, "prompts.json"), JSON.stringify([]), "utf8");
  process.env.PM_TRAINER_DATA_DIR = dir;
  prompts = await import("@/lib/prompts");
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("题库提示词纳入了可管理范围", () => {
  it("三个 scope 都出现在目录里（界面的分组与校验都读它）", () => {
    const ids = PROMPT_SCOPES.map((s) => s.id);
    for (const scope of QUESTION_SCOPES) {
      expect(ids).toContain(scope);
    }
  });

  it("每个 scope 都有「什么时候用到它」的人话说明，且归在题库模块下", () => {
    for (const scope of QUESTION_SCOPES) {
      const entry = PROMPT_SCOPES.find((s) => s.id === scope);
      expect(entry?.module).toBe("题库");
      expect(entry?.when).toBeTruthy();
    }
  });

  it("种子数据里能直接取到这三条（全新安装也有）", () => {
    const seeded = seedPrompts();
    const scopes = seeded.map((t) => t.scope);
    for (const scope of QUESTION_SCOPES) {
      expect(scopes).toContain(scope);
    }
    // 内容不能是空的，否则界面上一展开就是白框
    for (const t of seeded.filter((t) => QUESTION_SCOPES.includes(t.scope as never))) {
      expect(t.system.trim().length).toBeGreaterThan(40);
    }
  });
});

describe("promptForScope：取单条提示词", () => {
  async function writePrompts(
    rows: { scope: string; system: string; enabled: boolean }[],
  ) {
    await writeFile(
      path.join(dir, "prompts.json"),
      JSON.stringify(
        rows.map((r, i) => ({
          id: `prm-${i}`,
          name: `t-${i}`,
          scope: r.scope,
          system: r.system,
          enabled: r.enabled,
          builtin: false,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        })),
      ),
      "utf8",
    );
  }

  it("界面上改过的内容会被取到（回归：以前改了没效果）", async () => {
    await writePrompts([
      { scope: "question-answer", system: "自定义回答提示词：说人话。", enabled: true },
    ]);

    const text = await prompts.promptForScope("question-answer");
    expect(text).toContain("自定义回答提示词：说人话。");
  });

  it("停用后取到空串 —— 由调用方决定报错，而不是悄悄退回内置文案", async () => {
    await writePrompts([
      { scope: "question-answer", system: "自定义回答提示词：说人话。", enabled: false },
    ]);

    const text = await prompts.promptForScope("question-answer");
    // 空串是「被停用」的信号；如果这里退回内置文案，停用就等于没停
    expect(text).toBe("");
    expect(text).not.toContain("资深产品经理");
  });

  it("没写过这一条时退回种子文案（内置模板打底）", async () => {
    await writePrompts([]);

    const text = await prompts.promptForScope("question-readings");
    expect(text).toContain("推荐阅读");
    expect(text.trim().length).toBeGreaterThan(40);
  });
});
