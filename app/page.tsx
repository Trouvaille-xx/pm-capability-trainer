"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { MODES, SCENARIOS, captureKindName, modeName, scenarioName } from "@/lib/catalog";
import { apiGet, formatDate, scoreTone } from "@/lib/client";
import { buildProfile, dimensionTrend } from "@/lib/profile";
import { recommendNext, suggestionHref } from "@/lib/review";
import {
  IconArrowRight,
  IconCapture,
  IconFlow,
  IconMethodology,
  IconReport,
  IconSearch,
  IconTarget,
  IconTrainer,
  IconTrend,
  IconUser,
} from "@/components/icons";
import type {
  Capture,
  MethodologyCard,
  TrainingSessionListItem,
} from "@/lib/types";

/** 每个训练场景配一个图标，让入口一眼能区分开。 */
const SCENARIO_ICONS = {
  "product-teardown": IconSearch,
  "requirement-research": IconUser,
  "process-design": IconFlow,
} as const;

const TREND_LABEL = {
  up: "↑ 在变好",
  down: "↓ 在退步",
  flat: "→ 持平",
  unknown: "",
} as const;

export default function DashboardPage() {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [cards, setCards] = useState<MethodologyCard[]>([]);
  const [sessions, setSessions] = useState<TrainingSessionListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, m, s] = await Promise.all([
          apiGet<Capture[]>("/api/captures"),
          apiGet<MethodologyCard[]>("/api/methodology"),
          // 概览只看摘要（报告已在其中），不必拉整份 transcript
          apiGet<TrainingSessionListItem[]>("/api/sessions?view=list"),
        ]);
        if (!alive) return;
        setCaptures(c);
        setCards(m);
        setSessions(s);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* 画像是对历史报告做聚合，纯计算，不落后端 */
  const profile = useMemo(() => buildProfile(sessions), [sessions]);
  const suggestions = useMemo(() => recommendNext(sessions), [sessions]);
  const weakSet = useMemo(
    () => new Set(profile.weakest.map((stat) => stat.dimension)),
    [profile.weakest],
  );

  /* 加载中显示占位符而不是 0——否则新用户会看到一瞬间的「0 条记录」 */
  const statValue = (value: number) => (loading ? "—" : value);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>概览</h1>
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      {/* 焦点区：整页唯一的大色块。用户打开就想知道「下一步做什么」 */}
      <div className="hero">
        <h2>
          {sessions.length === 0
            ? "开始你的第一次训练"
            : `已训练 ${sessions.length} 次，继续保持`}
        </h2>
        <p>
          {sessions.length === 0
            ? "挑一个场景，选一种模式。AI 会陪你拆解、质询或追问，结束后给你一份带评分的报告。"
            : profile.averagePercent !== null
              ? `当前平均得分率 ${profile.averagePercent}%。挑一个场景继续，或看看下面的能力画像找薄弱项。`
              : "挑一个场景继续训练。"}
        </p>
        <div className="hero-row">
          <Link href="/trainer/new" className="btn">
            <IconTrainer width={15} height={15} />
            开始训练
          </Link>
          <Link href="/methodology" className="btn btn-hero-ghost">
            浏览方法论
          </Link>
        </div>
      </div>

      <div>
        <div className="section-label">数据概览</div>
        <div className="grid grid-4">
          <StatCard
            value={statValue(captures.length)}
            label="条记录总结"
            Icon={IconCapture}
            tone="brand"
          />
          <StatCard
            value={statValue(cards.length)}
            label="个知识点"
            Icon={IconMethodology}
            tone="good"
          />
          <StatCard
            value={statValue(sessions.length)}
            label="次训练"
            Icon={IconTrainer}
            tone="warn"
          />
          <StatCard
            value={loading ? "—" : profile.averagePercent ?? "—"}
            label="平均得分率"
            Icon={IconReport}
            tone="brand"
          />
        </div>
      </div>

      {/* 能力画像：跨会话看趋势，这是单个报告给不了的东西 */}
      {profile.scoredSessions > 0 ? (
        <div>
          <div className="section-label">
            能力画像 · 基于 {profile.scoredSessions} 份报告
          </div>
          <div className="card">
            <div className="row" style={{ alignItems: "flex-start", marginBottom: 4 }}>
              <div style={{ flex: 1, minWidth: 200 }}>
                <div className="row" style={{ gap: 7 }}>
                  <IconTrend width={15} height={15} style={{ color: "var(--brand)" }} />
                  <h2>各维度平均得分率</h2>
                </div>
                <div className="list-sub">
                  越靠上的越弱。分数已按各场景满分归一，50 分制与百分制可比。
                </div>
              </div>
              <Sparkline points={profile.trend.map((point) => point.percent)} />
            </div>

            <div>
              {profile.dimensions.map((stat) => {
                const tone = scoreTone(stat.average);
                const trend = dimensionTrend(stat);
                return (
                  <div key={stat.dimension} className="score-row">
                    <div className="row" style={{ gap: 6 }}>
                      <span style={{ fontSize: 13, fontWeight: 550 }}>
                        {stat.dimension}
                      </span>
                      {weakSet.has(stat.dimension) ? (
                        <span className="tag tag-bad">薄弱</span>
                      ) : null}
                    </div>
                    <div className="score-bar">
                      <div
                        className={`score-fill ${tone}`}
                        style={{ width: `${Math.max(0, Math.min(100, stat.average))}%` }}
                      />
                    </div>
                    <div className="score-value">
                      {stat.average}
                      <span className="score-max">%</span>
                    </div>
                    <div className="score-comment">
                      {stat.count} 次评分
                      {TREND_LABEL[trend] ? ` · ${TREND_LABEL[trend]}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {/* 下一步练什么：把报告里的薄弱项变成一条点得开的训练 */}
      {suggestions.length > 0 ? (
        <div>
          <div className="section-label">下一步练什么</div>
          <div className="stack" style={{ gap: 9 }}>
            {suggestions.map((suggestion, index) => (
              <div key={`${suggestion.dimension}-${index}`} className="card card-tight">
                <div className="row" style={{ alignItems: "flex-start" }}>
                  <span className="stat-icon stat-icon-warn">
                    <IconTarget width={16} height={16} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="list-title">
                      {suggestion.starter
                        ? "先完整走一遍产品拆解"
                        : `再练一轮「${suggestion.dimension}」`}
                    </div>
                    <div className="list-sub">{suggestion.reason}</div>
                  </div>
                  <Link
                    href={suggestionHref(suggestion)}
                    className="btn btn-sm btn-primary"
                  >
                    去训练
                    <IconArrowRight width={13} height={13} />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <div className="section-label">开始一次训练</div>
        <div className="grid grid-3">
          {SCENARIOS.map((scenario) => {
            const Icon = SCENARIO_ICONS[scenario.id] ?? IconSearch;
            return (
              <Link
                key={scenario.id}
                href={`/trainer/new?scenario=${scenario.id}`}
                className="option"
              >
                <span className="option-icon">
                  <Icon width={17} height={17} />
                </span>
                <div className="option-title">{scenario.name}</div>
                <div className="option-blurb">{scenario.blurb}</div>
                <div className="option-foot">
                  选这个场景
                  <IconArrowRight width={13} height={13} />
                </div>
              </Link>
            );
          })}
        </div>
        <div className="row" style={{ marginTop: 10, gap: 6 }}>
          <span className="stat-label">训练模式：</span>
          {MODES.map((mode) => (
            <span key={mode.id} className="tag">
              {mode.name}
            </span>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="loading">加载中…</div>
      ) : (
        <div className="grid grid-2">
          <div className="card">
            <div className="row" style={{ marginBottom: 12 }}>
              <h2 style={{ flex: 1 }}>最近训练</h2>
              <Link href="/trainer" className="btn btn-sm btn-ghost">
                全部
              </Link>
            </div>
            {sessions.length === 0 ? (
              <div className="empty">
                还没有训练记录。选上面任意一个场景开始第一次训练。
              </div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {sessions.slice(0, 5).map((session) => (
                  <Link
                    key={session.id}
                    href={`/trainer/${session.id}`}
                    className="list-item"
                  >
                    <div className="row">
                      <div className="list-title" style={{ flex: 1 }}>
                        {session.topic}
                      </div>
                      {session.report ? (
                        <span className="tag tag-brand">
                          {session.report.overall} 分
                        </span>
                      ) : (
                        <span className="tag tag-warn">进行中</span>
                      )}
                    </div>
                    <div className="list-sub">
                      {scenarioName(session.scenario)} · {modeName(session.mode)} ·{" "}
                      {formatDate(session.createdAt)}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="card">
            <div className="row" style={{ marginBottom: 12 }}>
              <h2 style={{ flex: 1 }}>最近记录</h2>
              <Link href="/capture" className="btn btn-sm btn-ghost">
                全部
              </Link>
            </div>
            {captures.length === 0 ? (
              <div className="empty">
                还没有记录。读书、看文章、随手想到的东西都可以记在这里。
              </div>
            ) : (
              <div className="stack" style={{ gap: 8 }}>
                {captures.slice(0, 5).map((capture) => (
                  <Link
                    key={capture.id}
                    href={`/capture/${capture.id}`}
                    className="list-item"
                  >
                    <div className="list-title">{capture.title}</div>
                    <div className="list-sub">
                      <span className="tag">{captureKindName(capture.kind)}</span>{" "}
                      {capture.summary || capture.thoughts || "（无摘要）"}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 总分走势的小折线。没有依赖图表库，够用就行。 */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null;

  const width = 180;
  const height = 44;
  const step = width / (points.length - 1);
  const path = points
    .map((value, index) => {
      const x = index * step;
      const y = height - (Math.max(0, Math.min(100, value)) / 100) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <div style={{ textAlign: "right" }}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`总分走势：${points.join(" → ")}`}
      >
        <polyline
          points={path}
          fill="none"
          stroke="var(--brand)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="stat-label">总分走势（{points.length} 次）</div>
    </div>
  );
}

/** 统计卡：图标 + 数值 + 说明。图标底色按语义区分，避免四张卡长得一样。 */
function StatCard({
  value,
  label,
  Icon,
  tone,
}: {
  value: string | number;
  label: string;
  Icon: (props: { width?: number; height?: number }) => React.ReactElement;
  tone: "brand" | "good" | "warn";
}) {
  return (
    <div className="card card-tight stat-card">
      <span className={`stat-icon stat-icon-${tone}`}>
        <Icon width={16} height={16} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="stat-value">{value}</div>
        <div className="stat-label">{label}</div>
      </div>
    </div>
  );
}
