"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { MODES, SCENARIOS, modeName, scenarioName } from "@/lib/catalog";
import { apiGet, formatDate, scoreTone } from "@/lib/client";
import {
  IconArrowRight,
  IconPlus,
  IconReport,
  IconTrainer,
} from "@/components/icons";
import type { AISettings, TrainingSession } from "@/lib/types";

/**
 * 训练列表。
 *
 * 这里只做一件事：看历次训练。
 * 「配置一次新训练」是另一个职责（三步向导），放在 /trainer/new，
 * 不再和列表挤在同一页。以前把 01/02/03 三段塞在一张卡里、
 * 历史又叠在下面，页面又长又杂。
 */
export default function TrainerPage() {
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [filter, setFilter] = useState<string>("all");

  const load = useCallback(async () => {
    try {
      const [list, settings] = await Promise.all([
        apiGet<TrainingSession[]>("/api/sessions"),
        apiGet<AISettings>("/api/settings"),
      ]);
      setSessions(list);
      setAiReady(settings.apiKey.trim() !== "");
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const scored = sessions.filter((s) => s.report);
    const avg = scored.length
      ? Math.round(
          scored.reduce((sum, s) => sum + (s.report?.overall ?? 0), 0) /
            scored.length,
        )
      : null;
    return { total: sessions.length, scored: scored.length, avg };
  }, [sessions]);

  const filtered = useMemo(
    () =>
      filter === "all"
        ? sessions
        : sessions.filter((s) => s.scenario === filter),
    [sessions, filter],
  );

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>AI 训练师</h1>
        </div>
        <div className="page-actions">
          <Link href="/trainer/new" className="btn btn-primary">
            <IconPlus width={15} height={15} />
            新建训练
          </Link>
        </div>
      </div>

      {aiReady === false ? (
        <div className="notice notice-info">
          还没有配置模型密钥，训练无法调用 AI。
          <Link href="/settings" style={{ textDecoration: "underline", marginLeft: 4 }}>
            去设置 → AI 配置
          </Link>
          。
        </div>
      ) : null}

      {error ? <div className="notice notice-error">{error}</div> : null}

      {loading ? (
        <div className="folder-pane">
          <div className="loading">加载中…</div>
        </div>
      ) : sessions.length === 0 ? (
        <div className="folder-pane">
          <div className="empty-state">
            <span className="empty-icon">
              <IconTrainer width={26} height={26} />
            </span>
            <h2>还没有训练记录</h2>
            <p>
              挑一个场景，选一种模式。AI 会陪你拆解、质询或追问，
              结束后给你一份带评分的报告。
            </p>
            <Link href="/trainer/new" className="btn btn-primary">
              <IconPlus width={15} height={15} />
              开始第一次训练
            </Link>
          </div>
        </div>
      ) : (
        <>
          {/* 概览条：训练不是越多越好，平均分和已评分数更值得看 */}
          <div className="trainer-stats">
            <div className="trainer-stat">
              <div className="stat-value">{stats.total}</div>
              <div className="stat-label">次训练</div>
            </div>
            <div className="trainer-stat">
              <div className="stat-value">{stats.scored}</div>
              <div className="stat-label">次已出报告</div>
            </div>
            <div className="trainer-stat">
              <div className="stat-value">{stats.avg ?? "—"}</div>
              <div className="stat-label">平均得分</div>
            </div>
          </div>

          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            <button
              className={`tag${filter === "all" ? " tag-brand" : ""}`}
              style={{ cursor: "pointer" }}
              onClick={() => setFilter("all")}
            >
              全部 {sessions.length}
            </button>
            {SCENARIOS.map((s) => {
              const count = sessions.filter((x) => x.scenario === s.id).length;
              if (count === 0) return null;
              return (
                <button
                  key={s.id}
                  className={`tag${filter === s.id ? " tag-brand" : ""}`}
                  style={{ cursor: "pointer" }}
                  onClick={() => setFilter(s.id)}
                >
                  {s.name} {count}
                </button>
              );
            })}
          </div>

          <div className="folder-pane">
            <div className="stack" style={{ gap: 9 }}>
              {filtered.map((session) => {
                const tone = session.report
                  ? scoreTone(session.report.overall)
                  : null;
                return (
                  <Link
                    key={session.id}
                    href={`/trainer/${session.id}`}
                    className="list-item"
                  >
                    <div className="row" style={{ marginBottom: 5 }}>
                      <span className="tag tag-brand">
                        {scenarioName(session.scenario)}
                      </span>
                      <span className="tag">{modeName(session.mode)}</span>
                      {session.report && tone ? (
                        <span className={`tag tag-${tone}`}>
                          {session.report.overall} 分
                        </span>
                      ) : (
                        <span className="tag tag-warn">进行中</span>
                      )}
                      <div className="spacer" />
                      <span className="list-sub">
                        {formatDate(session.createdAt)}
                      </span>
                    </div>

                    <div className="list-title">{session.topic}</div>

                    {session.report ? (
                      <div className="list-sub clamp-2">
                        {session.report.summary}
                      </div>
                    ) : (
                      <div className="list-sub">
                        还没有报告。进去继续作答，或结束后生成。
                      </div>
                    )}

                    <div className="card-actions">
                      <span className="btn btn-sm btn-ghost card-open">
                        继续训练
                        <IconArrowRight width={13} height={13} />
                      </span>
                      {session.report ? (
                        <Link
                          href={`/trainer/${session.id}/report`}
                          className="btn btn-sm"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <IconReport width={13} height={13} />
                          看报告
                        </Link>
                      ) : null}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
