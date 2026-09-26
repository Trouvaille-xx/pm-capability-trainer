"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { SCENARIOS, captureKindName, questionKindName, scenarioName } from "@/lib/catalog";
import { apiGet, formatDate } from "@/lib/client";
import { assignTilts, tiltStyle } from "@/lib/board";
import { IconPlus } from "@/components/icons";
import type {
  Capture,
  MethodologyCard,
  Question,
  TrainingSession,
} from "@/lib/types";

/**
 * 训练师最后一句「真话」。
 *
 * 中断标记是服务端落库时写进正文的协议痕迹，不是训练师说的话，
 * 拿去当便签摘要读起来像「AI 在跟我讲协议」。
 */
function lastTrainerLine(session: TrainingSession): string {
  const lines = session.transcript.filter(
    (t) => t.role === "assistant" && !t.content.includes("[生成中断]"),
  );
  const last = lines[lines.length - 1];
  if (!last) return "";
  return last.content
    .replace(/```[\s\S]*?```/g, " ") // 代码块
    .replace(/^\s*[-*+]\s+/gm, "") // 列表符号（按行）
    .replace(/^\s*\d+[.、]\s+/gm, "") // 有序列表
    .replace(/[#*`>_]/g, "") // 行内标记
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * 概览。
 *
 * 这一页要回答一个问题：「我现在该干什么」。
 * 所以第一屏是「正在进行的那次训练」+ 一行统计，
 * 下面是最近留下的东西 —— 不是四张等大的统计卡（那是后台的形状）。
 */
export default function DashboardPage() {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [cards, setCards] = useState<MethodologyCard[]>([]);
  const [sessions, setSessions] = useState<TrainingSession[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [c, m, s, q] = await Promise.all([
          apiGet<Capture[]>("/api/captures"),
          apiGet<MethodologyCard[]>("/api/methodology"),
          apiGet<TrainingSession[]>("/api/sessions"),
          apiGet<Question[]>("/api/questions"),
        ]);
        if (!alive) return;
        setCaptures(c);
        setCards(m);
        setSessions(s);
        setQuestions(q);
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

  /** 正在进行的那一次。有它就先说它 —— 这是打开页面最想知道的。 */
  const active = sessions.find((s) => s.status === "active") ?? null;

  /** 攒了还没答的题。题库最容易变成「只收藏不动脑」，所以这个数要摆出来。 */
  const openCount = questions.filter((q) => q.myAnswer.trim() === "").length;

  /* 最近留下的东西：训练和记录混在一块板上。
     它们本来就是一回事 —— 都是「我做过的事」，分成两个列表反而要多看一处。 */
  const recent = useMemo(() => {
    const items: {
      id: string;
      href: string;
      kind: string;
      title: string;
      sub: string;
      at: string;
      flagged: boolean;
    }[] = [];

    for (const s of sessions.slice(0, 6)) {
      items.push({
        id: `s-${s.id}`,
        href: `/trainer/${s.id}`,
        kind: scenarioName(s.scenario),
        title: s.topic,
        /* 便签正文放「训练师最后说了什么」——比回显状态有用得多。
           中断行要跳过，那不是训练师说的话。 */
        sub: lastTrainerLine(s) || "还没开始对话",
        at: s.updatedAt || s.createdAt,
        flagged: s.status === "active",
      });
    }

    for (const c of captures.slice(0, 6)) {
      items.push({
        id: `c-${c.id}`,
        href: `/capture/${c.id}`,
        kind: captureKindName(c.kind),
        title: c.title,
        sub: c.summary || c.thoughts || "还没写内容",
        at: c.updatedAt || c.createdAt,
        flagged: false,
      });
    }

    /* 题库里只捞「已经动过的」题 —— 刚记下来的空题放上来没有信息量，
       它只是待办，不是动态。答过或让 AI 答过的才算。 */
    for (const q of questions.slice(0, 6)) {
      const touched = q.myAnswer.trim() !== "" || q.aiAnswer.trim() !== "";
      if (!touched) continue;
      items.push({
        id: `q-${q.id}`,
        href: `/questions/${q.id}`,
        kind: questionKindName(q.kind),
        title: q.prompt,
        // 优先显示我自己写的，那是这一页最该被回顾的东西
        sub: q.myAnswer.trim() || q.aiAnswer.trim() || "",
        at: q.updatedAt || q.createdAt,
        flagged: false,
      });
    }

    return items
      .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
      .slice(0, 6);
  }, [sessions, captures, questions]);

  const TILTS = useMemo(
    () => assignTilts(recent.map((r) => ({ id: r.id }))),
    [recent],
  );

  /** 领域分布：让「我偏在哪」一眼可见。 */
  const byDomain = useMemo(() => {
    const map = new Map<string, number>();
    for (const c of cards) map.set(c.domain, (map.get(c.domain) ?? 0) + 1);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [cards]);

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>概览</h1>
          <p className="lede">
            {active
              ? "有一次训练还没走完。接着推，或者先去补点方法论。"
              : "记录、学方法论、找 AI 训练师。三个动作连起来，就是一轮训练。"}
          </p>
        </div>
        <div className="page-actions">
          <Link href="/trainer/new" className="btn btn-primary">
            <IconPlus width={15} height={15} />
            开始训练
          </Link>
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      {/* 正在进行的训练：整页唯一一处「现在」。做得比其他块都重。 */}
      {active ? (
        <Link href={`/trainer/${active.id}`} className="now">
          <span className="now-label">正在进行</span>
          <span className="now-topic">{active.topic}</span>
          <span className="now-path">
            {scenarioName(active.scenario)}
            {active.currentStep
              ? `　进行到第 ${active.currentStep} 步`
              : `　聊到第 ${active.transcript.length} 轮`}
          </span>
          <span className="now-go">继续</span>
        </Link>
      ) : null}

      {/* 一行统计，不是四张卡 */}
      <div className="statline">
        <div className="statline-item">
          <span className="statline-value">{captures.length}</span>
          <span className="statline-label">条记录总结</span>
        </div>
        <div className="statline-item">
          <span className="statline-value">{cards.length}</span>
          <span className="statline-label">
            个知识点{byDomain.length ? `，${byDomain.length} 个领域` : ""}
          </span>
        </div>
        <div className="statline-item">
          <span className="statline-value">{sessions.length}</span>
          <span className="statline-label">次训练</span>
        </div>
        <div className="statline-item">
          <span className="statline-value">{questions.length}</span>
          <span className="statline-label">
            道题{openCount ? `，${openCount} 道还没答` : questions.length ? "，都答过了" : ""}
          </span>
        </div>
        <div className="statline-item">
          <span className="statline-value">{average ?? "—"}</span>
          <span className="statline-label">
            {scored.length ? `平均得分，${scored.length} 次已生成报告` : "平均得分，还没有报告"}
          </span>
        </div>
      </div>

      {/* 最近留下的东西：一板便签，训练和记录混排 */}
      <div>
        <div className="section-label">
          <span>最近</span>
        </div>

        {loading ? (
          <div className="loading">加载中…</div>
        ) : recent.length === 0 ? (
          <div className="empty-board">
            <h3>板上还是空的</h3>
            <p>
              从一次训练开始，或者先把最近读到的记下来。做过的事会一张张贴上来。
            </p>
            <div className="hint-actions">
              <Link href="/trainer/new" className="go">
                开始第一次训练
              </Link>
              <Link href="/capture">记一条</Link>
            </div>
          </div>
        ) : (
          <div className="wall">
            {recent.map((item) => (
              <Link
                key={item.id}
                href={item.href}
                className={`note${item.flagged ? " flagged" : ""}`}
                style={tiltStyle(TILTS[item.id] ?? 0)}
              >
                <span className="note-pin" aria-hidden="true" />
                <div className="note-domain">
                  <span>{item.kind}</span>
                  {item.flagged ? (
                    <span className="state-mark">进行中</span>
                  ) : null}
                </div>
                <h2 className="note-title">{item.title}</h2>
                <p className="note-def clamp-2">{item.sub}</p>
                <div className="note-foot">
                  <span>{formatDate(item.at)}</span>
                  <span className="note-open">打开</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* 领域分布：知道自己偏在哪，才知道该补哪 */}
      {byDomain.length > 0 ? (
        <div>
          <div className="section-label">
            <span>知识点分布</span>
            <Link href="/methodology" className="section-more">
              全部
            </Link>
          </div>
          <div className="domain-row">
            {byDomain.map(([domain, count]) => (
              <Link
                key={domain}
                href={`/methodology?domain=${encodeURIComponent(domain)}`}
                className="domain-item"
              >
                <span className="domain-name">{domain}</span>
                <span className="domain-count">{count}</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {/* 三个入口：不在首屏抢戏，放在最后当「还可以去哪」 */}
      <div>
        <div className="section-label">
          <span>开始一次训练</span>
        </div>
        <div className="path-row">
          {SCENARIOS.map((scenario) => (
            <Link
              key={scenario.id}
              href={`/trainer/new?scenario=${scenario.id}`}
              className="path-item"
            >
              <span className="path-name">{scenario.name}</span>
              <span className="path-blurb">{scenario.blurb}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
