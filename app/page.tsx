"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { MODES, SCENARIOS, captureKindName, modeName, scenarioName } from "@/lib/catalog";
import { apiGet, formatDate } from "@/lib/client";
import {
  IconArrowRight,
  IconCalendar,
  IconCapture,
  IconFlow,
  IconMethodology,
  IconReport,
  IconSearch,
  IconTrainer,
  IconUser,
} from "@/components/icons";
import type { Capture, MethodologyCard, TrainingSession } from "@/lib/types";

/** 每个训练场景配一个图标，让入口一眼能区分开。 */
const SCENARIO_ICONS = {
  "product-teardown": IconSearch,
  "requirement-research": IconUser,
  "process-design": IconFlow,
} as const;

export default function DashboardPage() {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [cards, setCards] = useState<MethodologyCard[]>([]);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, m, s] = await Promise.all([
          apiGet<Capture[]>("/api/captures"),
          apiGet<MethodologyCard[]>("/api/methodology"),
          apiGet<TrainingSession[]>("/api/sessions"),
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

  const scored = sessions.filter((s) => s.report);
  const average = scored.length
    ? Math.round(
        scored.reduce((sum, s) => sum + (s.report?.overall ?? 0), 0) /
          scored.length,
      )
    : null;

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
            : average !== null
              ? `当前平均 ${average} 分。挑一个场景继续，或回到历史报告复看薄弱维度。`
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
            value={captures.length}
            label="条记录总结"
            Icon={IconCapture}
            tone="brand"
          />
          <StatCard
            value={cards.length}
            label="个知识点"
            Icon={IconMethodology}
            tone="good"
          />
          <StatCard
            value={sessions.length}
            label="次训练"
            Icon={IconTrainer}
            tone="warn"
          />
          <StatCard
            value={average ?? "—"}
            label="平均得分"
            Icon={IconReport}
            tone="brand"
          />
        </div>
      </div>

      <div>
        <div className="section-label">开始一次训练</div>
        <div className="grid grid-3">
          {SCENARIOS.map((scenario) => {
            const Icon = SCENARIO_ICONS[scenario.id] ?? IconSearch;
            return (
              <Link
                key={scenario.id}
                href={`/trainer?scenario=${scenario.id}`}
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
