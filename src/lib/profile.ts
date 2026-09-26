/**
 * 跨会话能力画像。
 *
 * 刻意做成**派生式计算**、不落盘：报告的 `scores[]` 已经被 report.ts 强制
 * 对齐到场景评分表，天生可比，直接聚合历史即可。这样不用迁移老数据，
 * 也不存在「画像和报告对不上」的同步问题。
 *
 * 所有分数都换算成 0-100 的**得分率**再聚合：产品拆解是 50 分制、
 * 其它场景是百分制，直接相加求平均是没有意义的。
 */

import type { TrainingReport, TrainingSession } from "./types";

/**
 * 算画像只需要这几个字段。
 * 用最小依赖而不是整个 TrainingSession，列表页的轻量投影（不含 transcript）
 * 就能直接喂进来，不必先拉全量会话。
 */
export type ProfileSource = Pick<TrainingSession, "createdAt" | "report">;

/** 把一份报告的总分换算成 0-100。 */
export function reportPercent(report: TrainingReport): number {
  const max = report.overallMax > 0 ? report.overallMax : 100;
  return Math.round((report.overall / max) * 100);
}

export interface DimensionStat {
  dimension: string;
  /** 归一化后的平均得分率（0-100） */
  average: number;
  /** 该维度被评过几次 */
  count: number;
  /** 最近一次的得分率（0-100），没有则为 null */
  latest: number | null;
  /** 更早几次的平均得分率（0-100），用于判断趋势，没有则为 null */
  previous: number | null;
}

export interface TrendPoint {
  at: string;
  percent: number;
}

export interface CapabilityProfile {
  /** 出过报告的会话数 */
  scoredSessions: number;
  /** 归一化后的总平均分（0-100），没有报告时为 null */
  averagePercent: number | null;
  /** 各维度统计，按平均得分率**从低到高**（最弱的排最前） */
  dimensions: DimensionStat[];
  /** 时间升序的总分走势 */
  trend: TrendPoint[];
  /** 样本量足够、且确实偏弱的维度（最多 3 个） */
  weakest: DimensionStat[];
}

/** 判断维度是「变好了还是变差了」。差值小于 3 分视为持平。 */
export function dimensionTrend(stat: DimensionStat): "up" | "down" | "flat" | "unknown" {
  if (stat.latest === null || stat.previous === null) return "unknown";
  const delta = stat.latest - stat.previous;
  if (delta >= 3) return "up";
  if (delta <= -3) return "down";
  return "flat";
}

export function buildProfile(sessions: ProfileSource[]): CapabilityProfile {
  const scored = sessions
    .filter(
      (session): session is ProfileSource & { report: TrainingReport } =>
        Boolean(session.report),
    )
    .sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );

  if (scored.length === 0) {
    return {
      scoredSessions: 0,
      averagePercent: null,
      dimensions: [],
      trend: [],
      weakest: [],
    };
  }

  /** 维度名 → 按时间先后排列的得分率 */
  const byDimension = new Map<string, number[]>();

  for (const session of scored) {
    for (const score of session.report.scores) {
      const max = score.max > 0 ? score.max : 100;
      const percent = Math.round((score.score / max) * 100);
      const list = byDimension.get(score.dimension) ?? [];
      list.push(percent);
      byDimension.set(score.dimension, list);
    }
  }

  const dimensions: DimensionStat[] = Array.from(byDimension.entries())
    .map(([dimension, values]) => {
      const total = values.reduce((sum, value) => sum + value, 0);
      const latest = values.length > 0 ? values[values.length - 1] : null;
      const earlier = values.slice(0, -1);
      return {
        dimension,
        average: Math.round(total / values.length),
        count: values.length,
        latest,
        previous: earlier.length
          ? Math.round(earlier.reduce((sum, value) => sum + value, 0) / earlier.length)
          : null,
      };
    })
    .sort((a, b) => a.average - b.average);

  const averagePercent = Math.round(
    scored.reduce((sum, session) => sum + reportPercent(session.report), 0) /
      scored.length,
  );

  const trend: TrendPoint[] = scored.map((session) => ({
    at: session.createdAt,
    percent: reportPercent(session.report),
  }));

  /* 「薄弱」要有说服力：至少评过 1 次，且平均得分率低于 70 分。
     否则一次偶然的低分就会长期占据推荐位。 */
  const weakest = dimensions
    .filter((stat) => stat.count >= 1 && stat.average < 70)
    .slice(0, 3);

  return { scoredSessions: scored.length, averagePercent, dimensions, trend, weakest };
}
