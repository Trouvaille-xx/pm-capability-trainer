import { describe, expect, it } from "vitest";

import { parseStep, renderSessionForReport, toChatMessages } from "@/lib/prompts";
import type { TrainingSession, TranscriptEntry } from "@/lib/types";

function entry(content: string, role: TranscriptEntry["role"] = "user"): TranscriptEntry {
  return { role, content, at: "2026-01-01T00:00:00.000Z" };
}

function makeSession(partial: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: "s1",
    scenario: "product-teardown",
    mode: "assistant",
    topic: "拆解小红书",
    status: "active",
    transcript: [],
    submission: "",
    currentStep: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("parseStep", () => {
  it("认锚点写法", () => {
    expect(parseStep("【当前步骤】第 3 步：场景与用户画像")).toBe(3);
    expect(parseStep("先总结一下。\n【当前步骤】现在是第2步")).toBe(2);
  });

  it("模型顺带提到后面的步骤时，不再误跳进度（回归）", () => {
    // 这句话提到了第 8 步，但当前明显还在第 2 步
    const reply = "【当前步骤】第 2 步：场景与用户画像\n后面我们还会走到第 8 步的 Aha Moment。";
    expect(parseStep(reply)).toBe(2);
  });

  it("完全没有锚点时返回 null，保持原进度不动", () => {
    expect(parseStep("这段回答提到了第 5 步，但没有锚点。")).toBeNull();
    expect(parseStep("")).toBeNull();
  });
});

describe("renderSessionForReport", () => {
  it("单轮超长内容会被截断", () => {
    const session = makeSession({
      transcript: [entry("啊".repeat(5000))],
    });
    const text = renderSessionForReport(session);
    expect(text).toContain("已截断");
    expect(text.length).toBeLessThan(5000);
  });

  it("超长会话按总量预算丢弃较早轮次，并注明省略了几轮", () => {
    const session = makeSession({
      transcript: Array.from({ length: 20 }, (_, i) =>
        entry(`${i}:${"x".repeat(2500)}`, i % 2 === 0 ? "user" : "assistant"),
      ),
    });
    const text = renderSessionForReport(session);
    expect(text).toMatch(/较早的 \d+ 轮对话已省略/);
    // 最新的那一轮一定还在
    expect(text).toContain("19:");
  });

  it("独立作答超长会被截断", () => {
    const session = makeSession({ mode: "solo", submission: "y".repeat(20000) });
    const text = renderSessionForReport(session);
    expect(text).toContain("已截断");
    expect(text.length).toBeLessThan(15000);
  });
});

describe("toChatMessages", () => {
  it("限制轮数", () => {
    const session = makeSession({
      transcript: Array.from({ length: 40 }, (_, i) => entry(`m${i}`)),
    });
    const messages = toChatMessages("sys", session, 5);
    // system + 最近 5 轮
    expect(messages).toHaveLength(6);
    expect(messages[0].role).toBe("system");
    expect(messages.at(-1)?.content).toBe("m39");
  });

  it("轮数没超但字符总量超了，也会丢掉最旧的几轮（回归：只限轮数不限字符）", () => {
    const session = makeSession({
      transcript: Array.from({ length: 12 }, (_, i) => entry(`${i}:${"z".repeat(3000)}`)),
    });
    const messages = toChatMessages("sys", session, 24);
    expect(messages.length).toBeLessThan(13);
    // 最新一轮仍在
    expect(messages.at(-1)?.content.startsWith("11:")).toBe(true);
  });
});
