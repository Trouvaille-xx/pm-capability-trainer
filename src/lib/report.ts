/**
 * 训练报告的生成与规整。
 *
 * 「每次训练都要有报告和建议」是这个平台的核心闭环，
 * 所以模型输出必须经过校验与兜底，保证前端拿到的结构永远可用。
 */

import { chatOnce, parseJsonLoose } from "./ai";
import { renderSessionForReport, reportSystemPrompt } from "./prompts";
import { MODES, SCENARIOS, gradeFor, scenarioRubric } from "./catalog";
import type {
  ReportScore,
  TrainingReport,
  TrainingScenario,
  TrainingSession,
} from "./types";

/**
 * 没有自定义评分表的场景，用这套默认维度（百分制）。
 * 产品拆解有自己的 10 维 /5 分评分表，见 catalog.ts，这里不会用到。
 */
const DEFAULT_DIMENSIONS: Record<TrainingScenario, string[]> = {
  "product-teardown": [
    "问题定义",
    "结构完整度",
    "机制洞察",
    "证据与推断分离",
    "结论可执行性",
  ],
  "requirement-research": [
    "诉求澄清",
    "假设可证伪",
    "方法与问题匹配",
    "判定标准",
    "用户视角",
  ],
  "process-design": [
    "现状还原",
    "流程完整度",
    "异常覆盖",
    "角色边界",
    "指标设计",
  ],
};

/** 本次报告该用哪张评分表。 */
function rubricFor(
  scenario: TrainingScenario,
): { dimension: string; max: number }[] {
  const custom = scenarioRubric(scenario);
  if (custom.length > 0) {
    return custom.map((item) => ({
      dimension: item.dimension,
      max: item.max,
    }));
  }
  return (DEFAULT_DIMENSIONS[scenario] ?? []).map((dimension) => ({
    dimension,
    max: 100,
  }));
}

/** 把维度名做归一化后互相包含匹配，容忍模型轻微改写。 */
function matchesDimension(name: string, dimension: string): boolean {
  const a = name.replace(/\s/g, "");
  const b = dimension.replace(/\s/g, "");
  if (a === "" || b === "") return false;
  return a === b || a.includes(b) || b.includes(a);
}

function clampScore(value: unknown, fallback: number, max = 100): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.max(0, Math.min(max, n));
  // 保留一位小数：5 分制下 4.5 是有意义的
  return Math.round(clamped * 10) / 10;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : String(item ?? "").trim()))
    .filter((item) => item.length > 0);
}

/**
 * 最后一道兜底：当 JSON 彻底解析不了时，用正则把能救的字段捞出来。
 * 报告是这个平台的核心产出，宁可字段略少，也不能让整次训练白跑。
 */
function salvageReport(raw: string): Partial<TrainingReport> {
  const text = raw.replace(/```(?:json)?/gi, "");

  const readString = (key: string): string => {
    const match = text.match(
      new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`),
    );
    if (!match) return "";
    return match[1]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .trim();
  };

  const readArray = (key: string): string[] => {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*\\[([\\s\\S]*?)\\]`));
    if (!match) return [];
    return Array.from(match[1].matchAll(/"((?:[^"\\]|\\.)*)"/g))
      .map((entry) =>
        entry[1].replace(/\\n/g, "\n").replace(/\\"/g, '"').trim(),
      )
      .filter((entry) => entry.length > 0);
  };

  const readNumber = (key: string): number | undefined => {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`));
    return match ? Number(match[1]) : undefined;
  };

  const scores: ReportScore[] = Array.from(
    text.matchAll(/\{[^{}]*"dimension"\s*:\s*"((?:[^"\\]|\\.)*)"[^{}]*\}/g),
  )
    .map((match) => {
      const block = match[0];
      const score = block.match(/"score"\s*:\s*(-?\d+(?:\.\d+)?)/);
      const max = block.match(/"max"\s*:\s*(-?\d+(?:\.\d+)?)/);
      const comment = block.match(/"comment"\s*:\s*"((?:[^"\\]|\\.)*)"/);
      return {
        dimension: match[1].replace(/\\"/g, '"').trim(),
        score: score ? Number(score[1]) : 0,
        max: max ? Number(max[1]) : 100,
        comment: comment ? comment[1].replace(/\\"/g, '"').trim() : "",
      };
    })
    .filter((entry) => entry.dimension.length > 0);

  const salvaged: Partial<TrainingReport> = {
    summary: readString("summary"),
    overall: readNumber("overall"),
    strengths: readArray("strengths"),
    improvements: readArray("improvements"),
    suggestions: readArray("suggestions"),
    nextSteps: readArray("nextSteps"),
  };
  if (scores.length > 0) salvaged.scores = scores;
  return salvaged;
}

/**
 * 请求报告并解析。模型输出的 JSON 有时会出格式问题，
 * 依次尝试：本地修复 → 让模型自修一次 → 正则抢救。
 */
async function requestReport(
  system: string,
  user: string,
  sessionId: string,
): Promise<{ parsed: Partial<TrainingReport>; degraded: boolean }> {
  const messages = [
    { role: "system" as const, content: system },
    { role: "user" as const, content: user },
  ];

  const raw = await chatOnce(messages, {
    temperature: 0.3,
    maxTokens: 4096,
    sessionId,
  });

  try {
    return { parsed: parseJsonLoose<Partial<TrainingReport>>(raw), degraded: false };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn("[report] 首次解析失败，尝试让模型自修：", reason);

    try {
      const repaired = await chatOnce(
        [
          ...messages,
          { role: "assistant", content: raw.slice(0, 4000) },
          {
            role: "user",
            content: `你上面的输出不是合法 JSON（${reason}）。请只输出修正后的合法 JSON 对象，不要任何解释文字，不要 markdown 代码块围栏。`,
          },
        ],
        { temperature: 0, maxTokens: 4096, sessionId },
      );
      return {
        parsed: parseJsonLoose<Partial<TrainingReport>>(repaired),
        degraded: false,
      };
    } catch (retryError) {
      console.warn("[report] 自修仍失败，改用正则抢救：", retryError);
      return { parsed: salvageReport(raw), degraded: true };
    }
  }
}

/** 训练结束后生成报告；结构不完整时用得分均值兜底，绝不返回半成品。 */
export async function generateReport(
  session: TrainingSession,
): Promise<TrainingReport> {
  const system = await reportSystemPrompt(session.scenario);
  const scenarioMeta = SCENARIOS.find((s) => s.id === session.scenario);
  const modeMeta = MODES.find((m) => m.id === session.mode);

  const user = [
    `以下是需要评估的训练记录。`,
    `（场景：${scenarioMeta?.name ?? session.scenario}；模式：${modeMeta?.name ?? session.mode}）`,
    "",
    renderSessionForReport(session),
    "",
    "请严格按系统提示里约定的 JSON 结构输出评估报告。",
  ].join("\n");

  const { parsed, degraded } = await requestReport(system, user, session.id);

  const rubric = rubricFor(session.scenario);
  const overallMax = rubric.reduce((sum, item) => sum + item.max, 0);
  const rawScores = Array.isArray(parsed.scores) ? parsed.scores : [];

  /* 按评分表的顺序和维度名产出成绩，保证同一场景的报告之间可以横向比较。
     模型自创的、评分表以外的维度会被丢弃。 */
  let scores: ReportScore[] = rubric.map((item) => {
    const hit = rawScores.find(
      (entry) =>
        entry &&
        typeof entry === "object" &&
        matchesDimension(String(entry.dimension ?? ""), item.dimension),
    );
    if (!hit) {
      return {
        dimension: item.dimension,
        score: 0,
        max: item.max,
        comment: "本次训练记录中没有体现这一维度，建议下一轮专门覆盖。",
      };
    }
    return {
      dimension: item.dimension,
      score: clampScore(hit.score, 0, item.max),
      max: item.max,
      comment: String(hit.comment ?? "").trim(),
    };
  });

  /* 兜底：如果模型把维度名改得面目全非，导致一条都没匹配上，
     就直接采用它给的分数，总比整份报告全 0 好。 */
  if (scores.every((s) => s.score === 0) && rawScores.length > 0) {
    scores = rawScores
      .filter(
        (entry): entry is ReportScore =>
          Boolean(entry) && typeof entry === "object",
      )
      .map((entry, index) => ({
        dimension: String(entry.dimension ?? `维度 ${index + 1}`),
        score: clampScore(entry.score, 0, 100),
        max: 100,
        comment: String(entry.comment ?? "").trim(),
      }));
  }

  /* 总分以各维度之和为准（评分表是权威口径）；
     只有一条都没算出来时才退回模型给的 overall。 */
  const sum = scores.reduce((acc, s) => acc + s.score, 0);
  const computedMax = scores.reduce((acc, s) => acc + s.max, 0);
  let overall = Math.round(sum * 10) / 10;
  if (overall === 0 && typeof parsed.overall === "number") {
    overall = clampScore(parsed.overall, 0, computedMax);
  }
  const grade =
    String(parsed.grade ?? "").trim() || gradeFor(overall, computedMax);

  const report: TrainingReport = {
    summary:
      String(parsed.summary ?? "").trim() ||
      (degraded
        ? "模型这次的输出格式有误，只抢救出部分评价内容。建议点「重新生成报告」再试一次。"
        : "本次训练已完成，但没有生成足够的评价内容，建议重试生成报告。"),
    overall,
    overallMax: computedMax || overallMax,
    grade,
    scores,
    strengths: toStringArray(parsed.strengths),
    improvements: toStringArray(parsed.improvements),
    suggestions: toStringArray(parsed.suggestions),
    nextSteps: toStringArray(parsed.nextSteps),
    generatedAt: new Date().toISOString(),
  };

  if (report.suggestions.length === 0) {
    report.suggestions = [
      "下一轮训练前，先写出三条可以被证伪的假设，再开始作答。",
    ];
  }
  if (report.nextSteps.length === 0) {
    report.nextSteps = [
      `围绕「${session.topic}」再练一次，但换一种模式（当前为 ${
        modeMeta?.name ?? session.mode
      }）。`,
    ];
  }

  return report;
}
