"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Markdown } from "@/components/Markdown";
import { MarkedAnswer } from "@/components/MarkedAnswer";
import { ConfirmDialog, Modal } from "@/components/Modal";
import {
  QUESTION_KINDS,
  questionKindName,
  questionStage,
  questionStageName,
} from "@/lib/catalog";
import { apiGet, apiSend, formatDate } from "@/lib/client";
import { parseAnswer } from "@/lib/answer-format";
import { DomainTags } from "@/components/DomainTags";
import type { Question } from "@/lib/types";

/**
 * 题目详情页。
 *
 * 五个块：题目 · 我的回答 · AI 回答 · 相关知识 · 推荐阅读。
 * 两个回答上下排成一列：我的回答在上（白纸大字），AI 回答沉在下方（灰底小一号）。
 * 理由见 globals.css 的 .lead 注释：两个回答的长度天然不对称，
 * 并排时底边必然参差，而且侧栏窄、字号又小，长文读着更累。
 */

/** 流式协议的控制帧前缀，与 /api/sessions/{id}/message 共用一套约定。 */
const CTRL = "\u001e";

/**
 * 服务端流中途失败时追加的标记。
 *
 * 【关键】这条路径仍然返回 HTTP 200，只在正文尾部追加
 * `\n\n[生成中断] <原因>`。所以 response.ok 说明不了任何事 ——
 * 必须自己把它认出来，否则「生成失败」会被伪装成「生成成功」。
 */
const INTERRUPT = "[生成中断]";

/** AI 回答的生成阶段，用来给用户即时反馈。 */
type Phase = "idle" | "thinking" | "writing";

const PHASE_TEXT: Record<Phase, string> = {
  idle: "",
  thinking: "正在思考这道题",
  writing: "正在写回答",
};

/** 从正文里拆出「真正的回答」和「中断原因」。 */
function splitInterrupt(content: string): { body: string; cut: string } {
  const at = content.indexOf(INTERRUPT);
  if (at < 0) return { body: content, cut: "" };
  return {
    body: content.slice(0, at).trimEnd(),
    cut: content
      .slice(at + INTERRUPT.length)
      .trim()
      .replace(/^[：:]\s*/, ""),
  };
}

/**
 * 回答时间。
 *
 * 两个回答的时间含义不同：我的回答是「我什么时候答的」，
 * AI 回答是「AI 什么时候生成的」，所以这里只给时间本身，
 * 语义由标签那一侧的说明词承担（见 blk-hint 的用法）。
 * 直接复用列表页的 formatDate，保证两页的日期风格一致（今天 22:34 / 2026-09-26）。
 */
function when(iso: string): string {
  return formatDate(iso);
}

/**
 * 页面各块的锚点。
 *
 * 悬空目录与滚动高亮共用同一份顺序，免得两处各写一遍、对不上。
 */
const SECTIONS: { id: string; name: string }[] = [
  { id: "q-topic", name: "题目" },
  { id: "q-mine", name: "我的回答" },
  { id: "q-ai", name: "AI 回答" },
  { id: "q-related", name: "相关知识" },
  { id: "q-readings", name: "推荐阅读" },
];

/**
 * AI 回答里的一块。
 *
 * 四块各有各的用途，视觉上要能分清主次：
 * - 发言结构（tone=guide）：结构骨架，浅底 + 左边线，是「怎么讲」
 * - 面试回答原文（tone=main）：主角，白纸黑字，用朱砂标出得分点
 * - 扣分点（tone=warn）/ 回答建议（tone=plain）：辅助块，规规矩矩排着
 */
function AnswerBlock({
  label,
  text,
  tone,
  marked = false,
}: {
  label: string;
  text: string;
  tone: "guide" | "main" | "warn" | "plain";
  /** 是否把 <<>> 渲染成朱砂（只有「面试回答原文」需要） */
  marked?: boolean;
}) {
  return (
    <section className={`q-ans q-ans-${tone}`}>
      <div className="q-ans-label">{label}</div>
      {marked ? (
        <MarkedAnswer>{text}</MarkedAnswer>
      ) : (
        <div className="q-guide-body">
          <Markdown>{text}</Markdown>
        </div>
      )}
    </section>
  );
}

/**
 * 生成中的加载动画。
 *
 * 用三根朱砂短竖线依次起伏 —— 直接取全站记号语言里的那根竖线来做动效，
 * 而不是放一个转圈的 spinner。这样「加载」和「标记重点」是同一套视觉母题，
 * 用户不会觉得这里突然换了套东西。
 *
 * 竖线的宽度、颜色都用现有的 --mark-thick / --mark，只有高度是动画量。
 * 尊重系统的「减少动态效果」：那种情况下不闪，静态显示三根线。
 */
function AnswerLoading({ label }: { label: string }) {
  return (
    <div className="q-loading" role="status" aria-live="polite">
      <span className="q-loading-marks" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="q-loading-text">{label}</span>
    </div>
  );
}

export default function QuestionDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [question, setQuestion] = useState<Question | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  /* 我的回答：默认只读展示 markdown，点「编辑」才切成 textarea。 */
  const [editingMine, setEditingMine] = useState(false);
  const [mineDraft, setMineDraft] = useState("");
  const [savingMine, setSavingMine] = useState(false);

  /* AI 回答的流式状态 */
  const [streaming, setStreaming] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [generating, setGenerating] = useState(false);
  /** 点「AI 生成」时先弹一个提醒，确认后才真的跑 —— 两道文案见 genNotice */
  const [genConfirm, setGenConfirm] = useState(false);

  /* 重新归类 / 生成推荐阅读 */
  const [classifying, setClassifying] = useState(false);
  const [reading, setReading] = useState(false);

  /* AI 评分：评的是「我的回答」，评完把维度明细默认折起来 */
  const [reviewing, setReviewing] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);

  /* 编辑题目 / 删除 */
  const [editing, setEditing] = useState(false);
  const [draftPrompt, setDraftPrompt] = useState("");
  const [draftSource, setDraftSource] = useState("");
  const [draftKind, setDraftKind] = useState<Question["kind"]>("other");
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  /** 悬空目录里当前高亮的那一节。 */
  const [activeSection, setActiveSection] = useState("q-topic");

  /* 目录高亮跟着滚动走。只观察真实存在的块——
     「相关知识」「推荐阅读」在没内容时不会渲染，getElementById 会拿到 null。 */
  useEffect(() => {
    const nodes = SECTIONS.map((section) =>
      document.getElementById(section.id),
    ).filter((el): el is HTMLElement => el !== null);
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id);
        }
      },
      { rootMargin: "-90px 0px -70% 0px" },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [question]);

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<Question>(`/api/questions/${id}`);
      if (!alive.current) return null;
      setQuestion(data);
      setError("");
      return data;
    } catch (e) {
      if (!alive.current) return null;
      setError(e instanceof Error ? e.message : "加载失败");
      return null;
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const busy = phase !== "idle";

  /**
   * 让 AI 答一遍。
   *
   * 用裸 fetch（apiSend 会把整个响应当 JSON 解析，流式内容拿不到），
   * 解析器照 app/trainer/[id]/page.tsx 的既有实现写：控制帧总是完整的
   * 单行，摘出去；剩下的字节才是正文，边收边上屏。
   */
  const generate = useCallback(async () => {
    setGenerating(true);
    setStreaming("");
    setPhase("thinking");
    setError("");

    let answer = "";

    /** 把这一轮的失败如实报出来 —— 流中断时服务端已经把原因写进正文了。 */
    const reportInterrupt = (text: string): boolean => {
      if (!text.includes(INTERRUPT)) return false;
      const { cut } = splitInterrupt(text);
      setError(cut ? `AI 回答没生成完：${cut}` : "AI 回答没生成完，请重试一次。");
      return true;
    };

    try {
      const response = await fetch(`/api/questions/${id}/answer`, {
        method: "POST",
      });

      /* 这里的 !ok 只覆盖「请求根本没起来」这一类（404 / 500）。
         生成中途失败走的是 HTTP 200 + [生成中断]，下面单独认。 */
      if (!response.ok || !response.body) {
        const text = await response.text();
        let message = `请求失败（HTTP ${response.status}）`;
        try {
          message = (JSON.parse(text) as { error?: string }).error ?? message;
        } catch {
          // 保留默认错误信息
        }
        throw new Error(message);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        /* 先把控制帧摘出来（它们总是完整的单行）。帧没接收完就先留着，
           等下一个分片；坏帧直接丢，不影响正文。 */
        while (buffer.startsWith(CTRL)) {
          const newline = buffer.indexOf("\n");
          if (newline === -1) break;
          const line = buffer.slice(1, newline);
          buffer = buffer.slice(newline + 1);
          try {
            const frame = JSON.parse(line) as { type?: string; phase?: Phase };
            if (frame.type === "status" && frame.phase) setPhase(frame.phase);
          } catch {
            // 坏帧直接丢，不影响正文
          }
        }

        if (buffer !== "" && !buffer.startsWith(CTRL)) {
          answer += buffer;
          buffer = "";
          if (alive.current) setStreaming(answer);
        }
      }

      if (alive.current) {
        setStreaming("");
        setPhase("idle");
      }

      /* 服务端在流结束后整段落盘，所以拿最新的记录就行，
         不要自己把流拼起来 PATCH 回去（两边会不一致）。 */
      const fresh = await load();

      /* 【顺序】先 load 再报错。load() 成功时会 setError("")，
         反过来的话这条中断提示刚设上就被自己抹掉了 ——
         训练页踩过这个坑，错误被静默吞掉。 */
      const cut = alive.current ? reportInterrupt(answer) : true;

      /* 答完之后顺手把「相关知识 + 推荐阅读」补齐 —— 用户要的是一整块参考，
         不是先给回答、再让他自己点两次。中断的那次不补：
         回答本身都没写完，先让他把回答拿到手。 */
      if (alive.current && fresh && !cut) void fillCompanions(fresh);
    } catch (e) {
      if (!alive.current) return;
      setStreaming("");
      setPhase("idle");
      setError(e instanceof Error ? e.message : "生成 AI 回答失败");
      /* 流断在写盘之前时记录没变，但断在之后就有内容了，拉回来看看。 */
      await load();
    } finally {
      if (alive.current) {
        setGenerating(false);
        setStreaming("");
        setPhase("idle");
      }
    }
  }, [id, load]);

  async function saveMine() {
    setSavingMine(true);
    try {
      await apiSend<Question>(`/api/questions/${id}`, "PATCH", {
        myAnswer: mineDraft,
      });
      await load();
      setEditingMine(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存我的回答失败");
    } finally {
      setSavingMine(false);
    }
  }

  /**
   * 归类。
   *
   * `quiet` 给「生成回答后顺带补上」用：那种场景下失败不该在页面上喊 ——
   * 手动按钮还在，用户想重试随时可以，没必要为一次后台补全弹一条红字。
   */
  async function classify(quiet = false) {
    setClassifying(true);
    if (!quiet) setError("");
    try {
      /* 归类失败时服务端仍返回 200 + 记录（lastError 写明原因），
         所以这里拿到记录就等于拿到原因，不用另外判断。 */
      const updated = await apiSend<Question>(`/api/questions/${id}/classify`, "POST");
      if (alive.current) setQuestion(updated);
    } catch (e) {
      if (!quiet) setError(e instanceof Error ? e.message : "重新归类失败");
    } finally {
      if (alive.current) setClassifying(false);
    }
  }

  /** 让 AI 批改「我的回答」。评完打开明细（用户刚点了按钮，就是要看它）。 */
  async function reviewMine() {
    setReviewing(true);
    setError("");
    try {
      const updated = await apiSend<Question>(`/api/questions/${id}/review`, "POST");
      if (alive.current) {
        setQuestion(updated);
        setReviewOpen(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "评分失败");
    } finally {
      if (alive.current) setReviewing(false);
    }
  }

  async function suggestReadings(quiet = false) {
    setReading(true);
    if (!quiet) setError("");
    try {
      const updated = await apiSend<Question>(`/api/questions/${id}/readings`, "POST");
      if (alive.current) setQuestion(updated);
    } catch (e) {
      /* readings 失败返回 400 + { error }，apiSend 会抛。
         quiet 时（生成回答后顺带补）不报，否则「没配搜索」会在每次答完都弹一次。 */
      if (!quiet) setError(e instanceof Error ? e.message : "生成推荐阅读失败");
    } finally {
      if (alive.current) setReading(false);
    }
  }

  /**
   * 答完之后，把它旁边那两块也补齐：相关知识、推荐阅读。
   *
   * 这两块本来各要手点一次按钮，但「答完就想看到它们」才是真实需求，
   * 所以顺手带上。两块各自独立（推荐阅读还要联网），并发发、失败互不牵连；
   * 都走 quiet —— 补不齐不该影响已经拿到的回答。
   */
  async function fillCompanions(fresh: Question) {
    const jobs: Promise<void>[] = [];
    if (fresh.related.length === 0) jobs.push(classify(true));
    if (fresh.readings.length === 0) jobs.push(suggestReadings(true));
    if (jobs.length === 0) return;
    await Promise.allSettled(jobs);
    await load();
  }

  function openEdit() {
    if (!question) return;
    setDraftPrompt(question.prompt);
    setDraftSource(question.source);
    setDraftKind(question.kind);
    setEditing(true);
  }

  async function saveEdit() {
    setSaving(true);
    try {
      await apiSend<Question>(`/api/questions/${id}`, "PATCH", {
        prompt: draftPrompt,
        source: draftSource,
        kind: draftKind,
      });
      await load();
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function destroy() {
    setDeleting(true);
    try {
      await apiSend(`/api/questions/${id}`, "DELETE");
      router.push("/questions");
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
      setDeleting(false);
      setConfirming(false);
    }
  }

  if (loading) {
    return (
      <div className="stack">
        <div className="loading">加载中…</div>
      </div>
    );
  }

  if (!question) {
    return (
      <div className="stack">
        <div className="empty-board">
          <h3>这道题不在了</h3>
          <p>{error || "可能已经被删掉，或者链接里的编号不对。"}</p>
          <div className="hint-actions">
            <Link href="/questions" className="go">
              回到题库
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const mine = question.myAnswer.trim();
  const ai = question.aiAnswer.trim();
  const shown = streaming !== "" ? streaming : ai;
  const { body: shownBodyRaw, cut: shownCut } = splitInterrupt(shown);
  /* AI 回答分四块：发言结构 / 面试回答原文 / 扣分点 / 建议。
     流式期间也走同一条解析，所以生成到一半时前面的块会先出来。 */
  const shownAnswer = parseAnswer(shownBodyRaw);
  const review = question.review;
  /* 三态由内容推出来（我的回答 + 另外三块），与列表页同一个函数 */
  const myStage = questionStage(question);

  /** 目录只列真实存在的块 */
  const visibleSections = SECTIONS.filter((section) => {
    if (section.id === "q-related") return question.related.length > 0;
    if (section.id === "q-readings") return question.readings.length > 0;
    return true;
  });

  /** 跳转用平滑滚动，但尊重系统的「减少动态效果」。 */
  function jumpTo(sectionId: string) {
    setActiveSection(sectionId);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    document.getElementById(sectionId)?.scrollIntoView({
      behavior: reduce ? "auto" : "smooth",
      block: "start",
    });
  }

  return (
    <div className="stack">
      <div className="q-shell">
        {/* 目录：贴着正文左缘的一条窄轨，纵跨整页、随滚动停在视口里。
            放在布局里由 grid 定位（而不是 fixed 覆盖层），才能自动贴住正文，
            不必拿视口宽度去算侧栏和内边距。 */}
        <nav className="qtoc" aria-label="页面目录">
          <span className="qtoc-label">目录</span>
          {visibleSections.map((section) => (
            <a
              key={section.id}
              href={`#${section.id}`}
              className={activeSection === section.id ? "on" : undefined}
              aria-current={activeSection === section.id ? "true" : undefined}
              onClick={(event) => {
                event.preventDefault();
                jumpTo(section.id);
              }}
            >
              <span className="qtoc-tick" aria-hidden="true" />
              <span className="qtoc-name">{section.name}</span>
            </a>
          ))}
        </nav>

        {/* ---------------- 题头 ---------------- */}
        <div className="q-head" id="q-topic">
          <div className="q-head-top">
            <span>
              {questionKindName(question.kind)}
              {"　"}
              <span className="state-mark">{questionStageName(myStage)}</span>
            </span>
            {question.source ? <span>出自 {question.source}</span> : null}
            <DomainTags domains={question.domains} />
            <span>记于 {when(question.createdAt)}</span>
          </div>
          <h1>{question.prompt}</h1>
        </div>

        {/* ---------------- 操作条 ---------------- */}
        <div className="q-actions">
          <button type="button" className="board-bar-btn" onClick={openEdit}>
            编辑题目
          </button>
          <button
            type="button"
            className="board-bar-btn"
            onClick={() => void classify()}
            disabled={classifying}
          >
            {classifying ? "正在归类…" : "重新归类"}
          </button>
          <button
            type="button"
            className="board-bar-btn"
            onClick={() => void suggestReadings()}
            disabled={reading}
          >
            {reading ? "正在找…" : "找推荐阅读"}
          </button>

          <span className="q-spacer" />

          {/* 用中性链接色而不是 .board-bar-btn-danger：这个 class 的 --bad
              跟 --mark 是同一个色值（#b33a2b），会占掉全页唯一的朱砂额度。
              删除是破坏性操作，不该是全页最显眼的那个东西。 */}
          <button
            type="button"
            className="board-bar-btn"
            onClick={() => setConfirming(true)}
            title="删除这道题"
          >
            删除
          </button>
        </div>

        {/* AI 出错时如实说明原因，不假装没事 */}
        {question.lastError || error ? (
          <div className="q-error">
            <b>提示</b>
            <span>{error || question.lastError}</span>
          </div>
        ) : null}

        {/* ---------------- 两个回答：主次式 ---------------- */}
        <div className="lead">
          <div className="lead-main" id="q-mine">
            <div className="blk-label">
              我的回答
              {/* 分数直接写在标题旁边：手写体红字，一眼看到自己得了多少 */}
              {review ? (
                <span className="score-mark" title={`五维度各 20 分，共 ${review.overall} 分`}>
                  {review.overall}
                  <span className="score-mark-max">/100</span>
                </span>
              ) : null}
              <span className="blk-hint">
                {question.myAnsweredAt ? `我答的 ${when(question.myAnsweredAt)}` : "还没写"}
              </span>
            </div>

            {editingMine ? (
              <>
                <textarea
                  className="textarea textarea-lg"
                  value={mineDraft}
                  onChange={(e) => setMineDraft(e.target.value)}
                  placeholder="先自己答一遍，再去看 AI 怎么答 —— 这样才知道差在哪。"
                  disabled={savingMine}
                />
                <div className="row" style={{ marginTop: 14 }}>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={saveMine}
                    disabled={savingMine}
                  >
                    {savingMine ? "保存中…" : "保存"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setEditingMine(false)}
                    disabled={savingMine}
                  >
                    取消
                  </button>
                </div>
              </>
            ) : mine ? (
              <div className="q-body">
                <Markdown>{question.myAnswer}</Markdown>

                {/* 评分明细默认折起来：分数已经露在上面了，
                    想看「为什么是这个分」再展开，不占着视线。 */}
                {review ? (
                  <>
                    <button
                      type="button"
                      className="review-toggle"
                      aria-expanded={reviewOpen}
                      onClick={() => setReviewOpen((v) => !v)}
                    >
                      <span className="review-toggle-arrow" aria-hidden="true">
                        {reviewOpen ? "▾" : "▸"}
                      </span>
                      AI 评分明细
                      <span className="blk-hint">{when(review.at)}</span>
                    </button>
                    {reviewOpen ? (
                      <div className="review-box">
                        {review.summary ? (
                          <p className="review-summary">{review.summary}</p>
                        ) : null}
                        <div className="review-dims">
                          {review.scores.map((s) => (
                            <div className="review-dim" key={s.dimension}>
                              <div className="review-dim-top">
                                <span className="review-dim-name">{s.dimension}</span>
                                <span className="review-dim-score">
                                  {s.score}
                                  <span className="review-dim-max">/{s.max}</span>
                                </span>
                              </div>
                              <div className="review-bar" aria-hidden="true">
                                <span
                                  className="review-bar-fill"
                                  style={{ width: `${(s.score / s.max) * 100}%` }}
                                />
                              </div>
                              {s.comment ? (
                                <p className="review-dim-comment">{s.comment}</p>
                              ) : null}
                            </div>
                          ))}
                        </div>
                        {review.suggestions.length > 0 ? (
                          <div className="review-sug">
                            <div className="review-sug-label">怎么改</div>
                            <ul>
                              {review.suggestions.map((s, i) => (
                                <li key={i}>{s}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : null}

                <div className="row" style={{ marginTop: 18 }}>
                  <button
                    type="button"
                    className="board-bar-btn"
                    onClick={() => {
                      setMineDraft(question.myAnswer);
                      setEditingMine(true);
                    }}
                  >
                    修改我的回答
                  </button>
                  {/* 评分按钮就放在回答旁边 —— 它是「对我这份回答」的动作，
                      放到页面顶部的操作条会离上下文太远。 */}
                  <button
                    type="button"
                    className="board-bar-btn board-bar-btn-go"
                    onClick={reviewMine}
                    disabled={reviewing}
                  >
                    {reviewing ? "正在评分…" : review ? "重新评分" : "AI 评分"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="q-empty">
                <p>还没写。先自己答一遍再看 AI 的 —— 顺序反过来就没有练的意义了。</p>
                <button
                  type="button"
                  className="q-empty-action"
                  onClick={() => {
                    setMineDraft("");
                    setEditingMine(true);
                  }}
                >
                  写下我的回答
                </button>
              </div>
            )}
          </div>

          <aside className="lead-side" id="q-ai">
            <div className="blk-label">
              AI 回答
              <span className="blk-hint">
                {question.aiAnsweredAt
                  ? `AI 答的 ${when(question.aiAnsweredAt)}`
                  : mine
                    ? "参考"
                    : "还没生成"}
              </span>
            </div>

            {busy || streaming !== "" ? (
              <>
                <AnswerLoading label={PHASE_TEXT[phase] || "正在写回答"} />
                {streaming !== "" ? (
                  <>
                    {/* 生成过程中前几块会先出来 —— 先给结构，再给作答 */}
                    {shownAnswer.guide ? (
                      <AnswerBlock label="面试回答结构" text={shownAnswer.guide} tone="guide" />
                    ) : null}
                    {shownAnswer.body ? (
                      <div className="q-cursor">
                        <AnswerBlock
                          label="面试回答原文"
                          text={shownAnswer.body}
                          tone="main"
                          marked
                        />
                      </div>
                    ) : null}
                    {shownAnswer.pitfalls ? (
                      <AnswerBlock
                        label="警惕容易被扣分点"
                        text={shownAnswer.pitfalls}
                        tone="warn"
                      />
                    ) : null}
                    {shownAnswer.suggestions ? (
                      <AnswerBlock
                        label="回答建议"
                        text={shownAnswer.suggestions}
                        tone="plain"
                      />
                    ) : null}
                  </>
                ) : null}
              </>
            ) : ai ? (
              <>
                {shownCut ? (
                  <div className="q-status">
                    <span>这一段没生成完</span>
                  </div>
                ) : null}
                {shownAnswer.guide ? (
                  <AnswerBlock label="面试回答结构" text={shownAnswer.guide} tone="guide" />
                ) : null}
                {shownAnswer.body ? (
                  <AnswerBlock
                    label="面试回答原文"
                    text={shownAnswer.body}
                    tone="main"
                    marked
                  />
                ) : null}
                {shownAnswer.pitfalls ? (
                  <AnswerBlock
                    label="警惕容易被扣分点"
                    text={shownAnswer.pitfalls}
                    tone="warn"
                  />
                ) : null}
                {shownAnswer.suggestions ? (
                  <AnswerBlock
                    label="回答建议"
                    text={shownAnswer.suggestions}
                    tone="plain"
                  />
                ) : null}
                <div className="row" style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="board-bar-btn"
                    onClick={() => setGenConfirm(true)}
                    disabled={generating}
                  >
                    {shownCut ? "重答一遍" : "重新生成"}
                  </button>
                </div>
              </>
            ) : (
              <div className="q-empty">
                <p>
                  {mine
                    ? "已经有你的回答了。可以让 AI 也答一遍，回头对着比。"
                    : "还没有 AI 的回答。"}
                </p>
                <button
                  type="button"
                  className="q-empty-action"
                  onClick={() => setGenConfirm(true)}
                  disabled={generating}
                >
                  让 AI 答一遍
                </button>
              </div>
            )}
          </aside>
        </div>

        {/* ---------------- 相关知识 + 推荐阅读 ---------------- */}
        <div className="lead-foot">
          <div id="q-related">
            <div className="blk-label">
              相关知识
              <span className="blk-hint">
                {question.related.length > 0 ? `${question.related.length} 条` : ""}
              </span>
            </div>

            {question.related.length > 0 ? (
              <div className="rel-list">
                {question.related.map((r, i) => (
                  <div className="rel-item" key={`${r.term}-${i}`}>
                    <h3 className="rel-term">{r.term}</h3>
                    {r.gloss ? <p className="rel-gloss">{r.gloss}</p> : null}
                    {r.cardId ? (
                      <Link className="rel-link" href={`/methodology/${r.cardId}`}>
                        去方法论看这条
                      </Link>
                    ) : (
                      <span className="rel-none">知识库里还没有这条</span>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="q-empty">
                <p>还没找出这道题涉及的概念。归类一次就有了。</p>
                <button
                  type="button"
                  className="q-empty-action"
                  onClick={() => void classify()}
                  disabled={classifying}
                >
                  {classifying ? "正在归类…" : "让 AI 归类"}
                </button>
              </div>
            )}
          </div>

          <div id="q-readings">
            <div className="blk-label">
              推荐阅读
              <span className="blk-hint">
                {question.readings.length > 0 ? `${question.readings.length} 条` : ""}
              </span>
            </div>

            {question.readings.length > 0 ? (
              <div className="read-list">
                {question.readings.map((r, i) => (
                  <div className="read-item" key={`${r.title}-${i}`}>
                    <div className="read-body">
                      {r.url ? (
                        <a
                          className="read-title"
                          href={r.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {r.title}
                        </a>
                      ) : (
                        <span className="read-title">{r.title}</span>
                      )}
                      {r.source ? <div className="read-meta">{r.source}</div> : null}
                      {r.why ? <p className="read-why">{r.why}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="q-empty">
                <p>还没有推荐。可以联网找一轮看看。</p>
                <button
                  type="button"
                  className="q-empty-action"
                  onClick={() => void suggestReadings()}
                  disabled={reading}
                >
                  {reading ? "正在找…" : "找几条推荐阅读"}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ---------------- 编辑题目 ---------------- */}
      <Modal
        open={editing}
        title="编辑这道题"
        onClose={() => setEditing(false)}
        footer={
          <>
            <div className="spacer" />
            <button
              type="button"
              className="btn"
              onClick={() => setEditing(false)}
              disabled={saving}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveEdit}
              disabled={saving || draftPrompt.trim() === ""}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </>
        }
      >
        <div className="stack">
          <label>
            <div className="blk-label">题目</div>
            <textarea
              className="textarea"
              value={draftPrompt}
              onChange={(e) => setDraftPrompt(e.target.value)}
              placeholder="面试里被问到的原话，或者自己想到的问题。"
              disabled={saving}
            />
          </label>

          <label>
            <div className="blk-label">出处</div>
            <input
              className="input"
              value={draftSource}
              onChange={(e) => setDraftSource(e.target.value)}
              placeholder="哪家公司 / 谁问的 / 自己想的"
              disabled={saving}
            />
          </label>

          <label>
            <div className="blk-label">类型</div>
            <select
              className="select"
              value={draftKind}
              onChange={(e) => setDraftKind(e.target.value as Question["kind"])}
              disabled={saving}
            >
              {QUESTION_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </Modal>

      <ConfirmDialog
        open={confirming}
        title="删除这道题"
        message="确定删除？我的回答、AI 回答、相关知识和推荐阅读都会一起删掉，无法恢复。"
        busy={deleting}
        onConfirm={destroy}
        onCancel={() => setConfirming(false)}
      />

      {/* 点「AI 生成」先拦一道。
          两道文案是同一个弹窗的两种情形：没写就劝他先自己写（这个顺序才有练的意义），
          写了就提醒别全信 AI（它没你的项目上下文）。确认后才真的调模型。 */}
      <ConfirmDialog
        open={genConfirm}
        title={mine ? "参考 AI 的回答" : "建议先自己答一遍"}
        message={
          mine
            ? "AI 回答结果可能存在一定的偏差，请结合自己的项目回答。"
            : "建议优先自己回答之后再参考 AI 结果。"
        }
        confirmText="开始生成"
        cancelText="再想想"
        danger={false}
        busy={generating}
        onConfirm={() => {
          setGenConfirm(false);
          void generate();
        }}
        onCancel={() => setGenConfirm(false)}
      />
    </div>
  );
}
