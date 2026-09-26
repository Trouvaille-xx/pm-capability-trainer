"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { SCENARIOS, scenarioName, scenarioSteps } from "@/lib/catalog";
import { apiGet, formatDate } from "@/lib/client";
import { plainSummary } from "@/lib/board";
import type {
  PublicAISettings,
  TrainingScenario,
  TrainingSession,
} from "@/lib/types";

/**
 * AI 训练师 —— 训练场次列表。
 *
 * 这一页只回答一个问题：我之前练了些什么、练到哪了。
 * 「配置一次新训练」是另一件事，放在 /trainer/new。
 *
 * 呈现方式是线索板上的便签：完整对话在 .design-preview/10-trainer.html 里
 * 是逐条读的，所以列表不再重复对话内容，只留一句够判断要不要进去的提要。
 */

type View = "all" | "active" | "completed";

/** 便签轻微旋转：一样的角度会让整面墙读成表格。 */
const TILTS = ["-0.7deg", "0.5deg", "-0.3deg", "0.8deg", "-0.55deg", "0.35deg"];

export default function TrainerPage() {
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [scenario, setScenario] = useState<TrainingScenario | null>(null);
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");

  const load = useCallback(async () => {
    try {
      const [list, settings] = await Promise.all([
        /* 便签上的提要取自最后一轮回答，所以这里要完整对象，
           不能用 ?view=list 的轻量投影（投影里没有 transcript）。 */
        apiGet<TrainingSession[]>("/api/sessions"),
        apiGet<PublicAISettings>("/api/settings"),
      ]);
      setSessions(list);
      setAiReady(settings.apiKeySet);
      setError("");
    } catch (e) {
      /* apiGet 在非 2xx 时直接抛，这里把服务端的话原样端出来。 */
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const done = sessions.filter((s) => s.report);
  const running = sessions.filter((s) => !s.report);

  /* 最近动过的一场排最前面：进来的人十有八九是要接着上次练。 */
  const recentFirst = (a: TrainingSession, b: TrainingSession) =>
    Date.parse(b.updatedAt || b.createdAt) - Date.parse(a.updatedAt || a.createdAt);
  const ongoing = [...running].sort(recentFirst);
  const finished = [...done].sort(recentFirst);

  let shown = ongoing;
  if (view === "all") shown = [...ongoing, ...finished];
  else if (view === "completed") shown = finished;
  if (scenario) shown = shown.filter((s) => s.scenario === scenario);

  /* 关键词过滤叠在筛选之上：题目、报告摘要、标签、改进项都能搜到，
     翻旧账时不用一场场点开。 */
  const keyword = query.trim().toLowerCase();
  if (keyword !== "") {
    shown = shown.filter((session) => {
      const haystack = [
        session.topic,
        session.report?.summary ?? "",
        ...(session.report?.tags ?? []),
        ...(session.report?.improvements ?? []),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });
  }

  const counts = SCENARIOS.map((s) => ({
    id: s.id,
    name: s.name,
    count: sessions.filter((x) => x.scenario === s.id).length,
  })).filter((c) => c.count > 0);

  /* 训练师自己开场的那一轮，内容可能是「生成中断」的提示，
     拿它当提要会读成这页坏了。 */
  function lead(session: TrainingSession): string {
    const last = [...session.transcript]
      .reverse()
      .find((entry) => entry.role === "assistant" && entry.content.trim() !== "");
    if (!last) return "还没有开始，进去让训练师先开场。";
    const line = last.content
      .split("\n")
      .map((text) => text.trim())
      .find((text) => text !== "" && !text.startsWith("[生成中断]"));
    if (!line) return "还没有开始，进去让训练师先开场。";
    /* 便签正文不渲染 markdown，标记会原样露出来（实测出现过
       `把范围砍到一刻**`）。取摘要时统一剥掉，而不是只剥行首。 */
    return plainSummary(line, 96);
  }

  function footnote(session: TrainingSession): string {
    if (session.report) {
      const max = session.report.overallMax > 0 ? session.report.overallMax : 100;
      return `已出报告 ${session.report.overall} 分（满分 ${max}）`;
    }
    const steps = scenarioSteps(session.scenario);
    if (steps.length > 0) {
      const at = Math.min(Math.max(session.currentStep ?? 1, 1), steps.length);
      return `进行到第 ${at} 步`;
    }
    return "自由对话，没有固定步骤";
  }

  function note(session: TrainingSession, index: number) {
    const steps = scenarioSteps(session.scenario);
    const answered = session.transcript.filter((t) => t.role === "user").length;
    const at = Math.min(Math.max(session.currentStep ?? 1, 1), Math.max(steps.length, 1));
    const step = steps.length > 0 ? steps[at - 1] : undefined;

    return (
      <Link
        key={session.id}
        href={`/trainer/${session.id}`}
        className={`note${session.status === "completed" ? "" : " flagged"}`}
        style={{ "--tilt": TILTS[index % TILTS.length] } as React.CSSProperties}
      >
        <span className="note-pin" />
        <div className="note-domain">
          <span>{scenarioName(session.scenario)}</span>
          <span className="state-mark">
            {session.status === "completed" ? "已出报告" : "进行中"}
          </span>
        </div>

        <h2 className="note-title">{session.topic}</h2>

        <p className="note-def">{lead(session)}</p>

        {step ? (
          <p className="note-detail">
            这一步要交的是{step.name}的交付物：{step.deliverable}
          </p>
        ) : (
          <p className="note-detail">
            训练师会追问你抛出的假设，逼你把模糊的说法换成具体的行为和指标。
          </p>
        )}

        <div className="note-foot">
          <span>{footnote(session)}</span>
          <span className="flag">已答 {answered} 轮</span>
          <span className="note-open">进去接着练</span>
        </div>
      </Link>
    );
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>AI 训练师</h1>
          <p className="lede">
            一场一场地练。训练师的提问会引用你方法论库里的词条，练完给你一份评分。
          </p>
        </div>
        <div className="page-actions">
          <Link href="/trainer/new" className="vs-btn on">
            新建训练
          </Link>
        </div>
      </div>

      {aiReady === false ? (
        <div className="notice notice-info">
          还没有配置模型密钥，训练师不会开口。
          <Link href="/settings" style={{ textDecoration: "underline", marginLeft: 4 }}>
            去辅助系统填 AI 配置
          </Link>
        </div>
      ) : null}

      {error ? <div className="notice notice-error">{error}</div> : null}

      {loading ? (
        <div className="loading">加载中…</div>
      ) : sessions.length === 0 ? (
        <div className="empty-board">
          <h3>板上还没有训练记录</h3>
          <p>
            挑一个场景，选一种练法。产品拆解会走 8 步固定流程，
            另外两个是自由对话，结束后训练师给一份带评分的报告。
          </p>
          <div className="hint-actions">
            <Link href="/trainer/new" className="go">
              新建训练
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="board">
            <div className="controls">
              <div className="filters">
                <button
                  className={view === "all" && scenario === null ? "on" : ""}
                  onClick={() => {
                    setView("all");
                    setScenario(null);
                  }}
                >
                  全部
                  <span className="count">{sessions.length}</span>
                </button>
                <button
                  className={view === "active" && scenario === null ? "on" : ""}
                  onClick={() => {
                    setView("active");
                    setScenario(null);
                  }}
                >
                  进行中
                  <span className="count">{ongoing.length}</span>
                </button>
                <button
                  className={view === "completed" && scenario === null ? "on" : ""}
                  onClick={() => {
                    setView("completed");
                    setScenario(null);
                  }}
                >
                  已出报告
                  <span className="count">{finished.length}</span>
                </button>
                {counts.map((item) => (
                  <button
                    key={item.id}
                    className={scenario === item.id ? "on" : ""}
                    onClick={() => setScenario(scenario === item.id ? null : item.id)}
                  >
                    {item.name}
                    <span className="count">{item.count}</span>
                  </button>
                ))}

                {/* 关键词搜索：与上面的筛选是叠加关系，不互斥 */}
                <input
                  className="input"
                  style={{ maxWidth: 220 }}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜题目、摘要或标签…"
                  aria-label="搜索训练记录"
                />
              </div>
            </div>
          </div>

          <div className="board">
            <div className="wall wide">
              {shown.length === 0 ? (
                <div className="empty-board">
                  <h3>这个条件下没有训练</h3>
                  <p>换个筛选或关键词，也可以直接新建一场。</p>
                  <div className="hint-actions">
                    <button
                      onClick={() => {
                        setView("all");
                        setScenario(null);
                        setQuery("");
                      }}
                    >
                      看全部
                    </button>
                    <Link href="/trainer/new" className="go">
                      新建训练
                    </Link>
                  </div>
                </div>
              ) : (
                shown.map(note)
              )}
            </div>
          </div>

          {/* 页脚是一句真总览 + 一组分类计数，两者是「两层信息」。
              之前这段是三个裸 span 挤在一个容器里，又都不是 flex 子项，
              于是连读成「朱砂图钉表示这场还没结束产品拆解 2」——
              而且那句还是在给用户讲解设计意图，界面里不该有。
              现在：讲解句删掉，剩下两段各自成独立子元素。
              两端对齐由全局 .colophon 负责，页面里不再写 inline style。 */}
          <div className="colophon">
            <span>
              <b>共 {sessions.length} 场</b>
              ，{ongoing.length} 场进行中，{finished.length} 场已出报告
            </span>
            <span>
              {counts.map((c, i) => (
                <span key={c.id}>
                  {i > 0 ? "　" : ""}
                  {c.name} {c.count}
                </span>
              ))}
              <br />
              最近一次修改{" "}
              {formatDate(
                [...sessions].sort(recentFirst)[0]?.updatedAt ??
                  [...sessions].sort(recentFirst)[0]?.createdAt ??
                  "",
              )}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
