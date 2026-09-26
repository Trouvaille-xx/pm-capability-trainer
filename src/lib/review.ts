/**
 * 「下一步练什么」的推荐。
 *
 * 把能力画像里的薄弱维度映射回训练场景与模式，生成一条可以直接点开的训练。
 * 这是把「报告 → 下一步」接成闭环的那一环：报告里的 nextSteps 是自由文本，
 * 而这里是可执行的深链。
 */

import { SCENARIOS } from "./catalog";
import { buildProfile } from "./profile";
import type { TrainingMode, TrainingScenario, TrainingSession } from "./types";

/** 推荐只需要这几个字段，列表页的轻量投影可以直接喂进来。 */
export type ReviewSource = Pick<
  TrainingSession,
  "createdAt" | "scenario" | "topic" | "report"
>;

export interface TrainingSuggestion {
  /** 针对哪个薄弱维度 */
  dimension: string;
  /** 建议的训练场景 */
  scenario: TrainingScenario;
  /** 建议的训练模式 */
  mode: TrainingMode;
  /** 预填的题目 */
  topic: string;
  /** 为什么推荐这个 */
  reason: string;
  /** 没有历史时会是 true：这是「先跑一轮」的引导，不是针对弱项 */
  starter: boolean;
}

/**
 * 维度名 → 场景。
 *
 * 维度名是场景评分表里的，所以按关键词归位就够了；
 * 认不出来时退回产品拆解——它的 8 步流程覆盖面最广。
 */
function scenarioForDimension(dimension: string): TrainingScenario {
  if (/需求|诉求|假设|判定|调研|用户视角|匮乏感/.test(dimension)) {
    return "requirement-research";
  }
  if (/流程|异常|角色|指标|现状|边界/.test(dimension)) {
    return "process-design";
  }
  return "product-teardown";
}

/** 该场景最近一次训练的题目，用来让下一轮接着同一个对象练。 */
function latestTopicOf(
  sessions: ReviewSource[],
  scenario: TrainingScenario,
): string {
  const latest = sessions
    .filter((session) => session.scenario === scenario)
    .sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )[0];
  return latest?.topic ?? "";
}

/** 推荐下一次训练；没有任何评分记录时，给一条「先跑一轮」的起步建议。 */
export function recommendNext(
  sessions: ReviewSource[],
  limit = 3,
): TrainingSuggestion[] {
  const profile = buildProfile(sessions);

  if (profile.scoredSessions === 0) {
    const scenario = SCENARIOS[0];
    return [
      {
        dimension: "",
        scenario: scenario?.id ?? "product-teardown",
        mode: "assistant",
        topic: "",
        reason:
          "还没有出过报告。先按 8 步流程完整走一遍产品拆解，平台就能算出你的能力画像。",
        starter: true,
      },
    ];
  }

  if (profile.weakest.length === 0) return [];

  return profile.weakest.slice(0, limit).map((stat) => {
    const scenario = scenarioForDimension(stat.dimension);
    const topic = latestTopicOf(sessions, scenario);
    const scenarioName = SCENARIOS.find((s) => s.id === scenario)?.name ?? scenario;

    return {
      dimension: stat.dimension,
      scenario,
      mode: "grill" as TrainingMode,
      topic,
      reason:
        `「${stat.dimension}」平均 ${stat.average} 分` +
        (stat.count > 1 ? `（${stat.count} 次评分）` : "") +
        `，是目前最弱的一环。用高强度质询练一轮「${scenarioName}」，最容易暴露问题。`,
      starter: false,
    };
  });
}

/** 把一条建议变成向导的深链。 */
export function suggestionHref(suggestion: TrainingSuggestion): string {
  const params = new URLSearchParams({ scenario: suggestion.scenario });
  params.set("mode", suggestion.mode);
  if (suggestion.topic) params.set("topic", suggestion.topic);
  return `/trainer/new?${params.toString()}`;
}
