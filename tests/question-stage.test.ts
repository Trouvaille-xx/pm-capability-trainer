import { describe, expect, it } from "vitest";

import { questionStage, questionStageName } from "@/lib/catalog";

/**
 * 题目三态的判定。
 *
 * 这一条驱动两个界面的图钉颜色与筛选，所以边界要钉死：
 * 四块内容（我的回答 / AI 回答 / 相关知识 / 推荐阅读）齐了才算完成。
 * 「题目」本身不算一块 —— 没有题就没有这条记录。
 */
function q(partial: {
  myAnswer?: string;
  aiAnswer?: string;
  related?: unknown[];
  readings?: unknown[];
}) {
  return {
    myAnswer: "",
    aiAnswer: "",
    related: [] as unknown[],
    readings: [] as unknown[],
    ...partial,
  };
}

const full = {
  myAnswer: "我答的",
  aiAnswer: "AI 答的",
  related: [{ term: "x" }],
  readings: [{ title: "y" }],
};

describe("questionStage", () => {
  it("还没写我的回答 → 待作答", () => {
    expect(questionStage(q({}))).toBe("todo");
    // 就算别的块有内容，只要我没答，就还是待作答
    expect(questionStage(q({ aiAnswer: "AI 答的", related: [{ term: "x" }] }))).toBe(
      "todo",
    );
  });

  it("我答了但四块没齐 → 作答中", () => {
    expect(questionStage(q({ myAnswer: "我答的" }))).toBe("doing");
    expect(questionStage(q({ myAnswer: "我答的", aiAnswer: "AI 答的" }))).toBe("doing");
    expect(
      questionStage(q({ myAnswer: "我答的", related: [{ term: "x" }] })),
    ).toBe("doing");
  });

  it("四块都有内容 → 已完成", () => {
    expect(questionStage(full)).toBe("done");
  });

  it("只有空白字符不算有内容", () => {
    expect(questionStage(q({ myAnswer: "   \n  " }))).toBe("todo");
    expect(questionStage({ ...full, myAnswer: "  " })).toBe("todo");
    expect(questionStage({ ...full, aiAnswer: "\n" })).toBe("doing");
  });

  it("相关知识与推荐阅读按条数算，空数组就是没内容", () => {
    expect(questionStage({ ...full, related: [] })).toBe("doing");
    expect(questionStage({ ...full, readings: [] })).toBe("doing");
  });

  it("三态都有名字", () => {
    expect(questionStageName("todo")).toBe("待作答");
    expect(questionStageName("doing")).toBe("作答中");
    expect(questionStageName("done")).toBe("已完成");
  });
});
