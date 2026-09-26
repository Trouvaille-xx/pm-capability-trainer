import { describe, expect, it } from "vitest";

import { sessionToMarkdown, sessionToPptOutline } from "@/lib/export";
import type { TrainingSession } from "@/lib/types";

function makeSession(partial: Partial<TrainingSession> = {}): TrainingSession {
  return {
    id: "s1",
    scenario: "product-teardown",
    mode: "assistant",
    topic: "拆解小红书",
    status: "completed",
    transcript: [],
    submission: "",
    currentStep: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("sessionToMarkdown", () => {
  it("题目里的换行不会把文档结构冲散", () => {
    const session = makeSession({ topic: "第一行\n## 我插入的标题" });
    const md = sessionToMarkdown(session);

    // 注入的 "## 我插入的标题" 不该以独立标题的形式出现
    expect(md).not.toMatch(/^## 我插入的标题$/m);
    expect(md).toContain("- 拆解对象：第一行 ## 我插入的标题");
  });

  it("表格单元格里的竖线与换行不会切断表格", () => {
    const session = makeSession({
      report: {
        summary: "还行",
        overall: 30,
        overallMax: 50,
        grade: "良好",
        scores: [
          {
            dimension: "场景理解深度",
            score: 3,
            max: 5,
            comment: "不错 | 但换行\n会切断表格",
          },
        ],
        strengths: ["a"],
        improvements: ["b"],
        suggestions: ["c"],
        nextSteps: ["d"],
        generatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const md = sessionToMarkdown(session);
    const row = md.split("\n").find((line) => line.startsWith("| 场景理解深度"));
    expect(row).toBeDefined();
    // 转义后仍是一行；三列的结构保住了
    expect(row).toContain("\\|");
    expect(row?.endsWith(" |")).toBe(true);
  });
});

describe("sessionToPptOutline", () => {
  it("分步页面用学员的真实作答替代占位符", () => {
    const session = makeSession({
      transcript: [
        { role: "user", content: "我的第一步答案", at: "2026-01-01T00:00:00.000Z" },
      ],
    });
    const outline = sessionToPptOutline(session);

    expect(outline).toContain("- 我的答案：我的第一步答案");
    expect(outline).not.toContain("从对话记录里提炼");
  });

  it("没有对应作答时不写「我的答案」，也不留占位符", () => {
    const outline = sessionToPptOutline(makeSession());
    expect(outline).not.toContain("我的答案");
    expect(outline).not.toContain("从对话记录里提炼");
  });
});
