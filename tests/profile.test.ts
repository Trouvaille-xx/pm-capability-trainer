import { describe, expect, it } from "vitest";

import { buildProfile, dimensionTrend, reportPercent } from "@/lib/profile";
import { recommendNext, suggestionHref } from "@/lib/review";
import type { ReportScore, TrainingReport } from "@/lib/types";

function report(
  scores: { dimension: string; score: number; max?: number }[],
  createdAt: string,
): { createdAt: string; report: TrainingReport } {
  const items: ReportScore[] = scores.map((item) => ({
    dimension: item.dimension,
    score: item.score,
    max: item.max ?? 5,
    comment: "",
  }));
  const overall = items.reduce((sum, item) => sum + item.score, 0);
  const overallMax = items.reduce((sum, item) => sum + item.max, 0);
  return {
    createdAt,
    report: {
      summary: "s",
      overall,
      overallMax,
      grade: "良好",
      scores: items,
      strengths: [],
      improvements: [],
      suggestions: [],
      nextSteps: [],
      generatedAt: createdAt,
    },
  };
}

describe("reportPercent", () => {
  it("50 分制与百分制都能换算成同量纲", () => {
    expect(
      reportPercent({
        summary: "",
        overall: 40,
        overallMax: 50,
        grade: "",
        scores: [],
        strengths: [],
        improvements: [],
        suggestions: [],
        nextSteps: [],
        generatedAt: "",
      }),
    ).toBe(80);
  });
});

describe("buildProfile", () => {
  it("没有报告时返回空画像", () => {
    const profile = buildProfile([{ createdAt: "2026-01-01", report: undefined }]);
    expect(profile.scoredSessions).toBe(0);
    expect(profile.averagePercent).toBeNull();
    expect(profile.weakest).toEqual([]);
  });

  it("把不同满分的报告归一后聚合（回归：直接相加求平均会失真）", () => {
    const profile = buildProfile([
      // 5 分制：3/5 = 60%
      report([{ dimension: "场景理解深度", score: 3, max: 5 }], "2026-01-01T00:00:00.000Z"),
      // 百分制：90/100 = 90%
      report(
        [{ dimension: "场景理解深度", score: 90, max: 100 }],
        "2026-01-02T00:00:00.000Z",
      ),
    ]);

    const stat = profile.dimensions[0];
    expect(stat.dimension).toBe("场景理解深度");
    expect(stat.count).toBe(2);
    expect(stat.average).toBe(75); // (60 + 90) / 2
    expect(stat.latest).toBe(90);
    expect(stat.previous).toBe(60);
  });

  it("维度按平均得分率升序排列，最弱的在最前面", () => {
    const profile = buildProfile([
      report(
        [
          { dimension: "强项", score: 5 },
          { dimension: "弱项", score: 2 },
          { dimension: "中等", score: 3.5 },
        ],
        "2026-01-01T00:00:00.000Z",
      ),
    ]);

    expect(profile.dimensions.map((stat) => stat.dimension)).toEqual([
      "弱项",
      "中等",
      "强项",
    ]);
  });

  it("薄弱项只收低于 70 分的，且最多 3 个", () => {
    const profile = buildProfile([
      report(
        [
          { dimension: "a", score: 1 },
          { dimension: "b", score: 2 },
          { dimension: "c", score: 3 },
          { dimension: "d", score: 3.4 },
          { dimension: "e", score: 5 },
        ],
        "2026-01-01T00:00:00.000Z",
      ),
    ]);

    expect(profile.weakest.map((stat) => stat.dimension)).toEqual(["a", "b", "c"]);
  });

  it("走势按时间升序", () => {
    const profile = buildProfile([
      report([{ dimension: "x", score: 5 }], "2026-03-01T00:00:00.000Z"),
      report([{ dimension: "x", score: 1 }], "2026-01-01T00:00:00.000Z"),
    ]);
    expect(profile.trend.map((point) => point.percent)).toEqual([20, 100]);
  });
});

describe("dimensionTrend", () => {
  const base = {
    dimension: "d",
    average: 50,
    count: 2,
  };

  it("样本不足时返回 unknown", () => {
    expect(dimensionTrend({ ...base, latest: 50, previous: null })).toBe("unknown");
  });

  it("差值够大才算变化", () => {
    expect(dimensionTrend({ ...base, latest: 80, previous: 60 })).toBe("up");
    expect(dimensionTrend({ ...base, latest: 40, previous: 60 })).toBe("down");
    expect(dimensionTrend({ ...base, latest: 62, previous: 60 })).toBe("flat");
  });
});

describe("recommendNext", () => {
  it("没有评分记录时给一条起步建议", () => {
    const suggestions = recommendNext([]);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].starter).toBe(true);
    expect(suggestions[0].mode).toBe("assistant");
  });

  it("按维度关键词映射到合适的场景，并带上原题目", () => {
    const suggestions = recommendNext([
      {
        scenario: "requirement-research",
        topic: "验证企业客户愿意为批量导出付费",
        ...report([{ dimension: "假设可证伪", score: 2 }], "2026-01-01T00:00:00.000Z"),
      },
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].dimension).toBe("假设可证伪");
    expect(suggestions[0].scenario).toBe("requirement-research");
    expect(suggestions[0].topic).toBe("验证企业客户愿意为批量导出付费");
    expect(suggestions[0].mode).toBe("grill");
  });

  it("全部维度都不弱时不硬推", () => {
    const suggestions = recommendNext([
      {
        scenario: "product-teardown",
        topic: "拆解某个产品",
        ...report([{ dimension: "x", score: 5 }], "2026-01-01T00:00:00.000Z"),
      },
    ]);
    expect(suggestions).toEqual([]);
  });
});

describe("suggestionHref", () => {
  it("生成带预选参数、且题目被转义的深链", () => {
    const href = suggestionHref({
      dimension: "x",
      scenario: "process-design",
      mode: "grill",
      topic: "入职流程 & 首次产出",
      reason: "",
      starter: false,
    });

    expect(href.startsWith("/trainer/new?")).toBe(true);

    // 解析回来验参数，避免断言具体的百分号编码
    const params = new URLSearchParams(href.slice(href.indexOf("?") + 1));
    expect(params.get("scenario")).toBe("process-design");
    expect(params.get("mode")).toBe("grill");
    // 题目里的 & 已被正确转义，解回来仍是原文
    expect(params.get("topic")).toBe("入职流程 & 首次产出");
  });
});
