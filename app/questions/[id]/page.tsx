"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Markdown } from "@/components/Markdown";
import { ConfirmDialog, Modal } from "@/components/Modal";
import {
  QUESTION_KINDS,
  QUESTION_STATUSES,
  questionKindName,
  questionStatusName,
} from "@/lib/catalog";
import { apiGet, apiSend, formatDate } from "@/lib/client";
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

  /* 重新归类 / 生成推荐阅读 */
  const [classifying, setClassifying] = useState(false);
  const [reading, setReading] = useState(false);

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
      await load();

      /* 【顺序】先 load 再报错。load() 成功时会 setError("")，
         反过来的话这条中断提示刚设上就被自己抹掉了 ——
         训练页踩过这个坑，错误被静默吞掉。 */
      if (alive.current) reportInterrupt(answer);
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

  async function classify() {
    setClassifying(true);
    setError("");
    try {
      /* 归类失败时服务端仍返回 200 + 记录（lastError 写明原因），
         所以这里拿到记录就等于拿到原因，不用另外判断。 */
      const updated = await apiSend<Question>(`/api/questions/${id}/classify`, "POST");
      if (alive.current) setQuestion(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "重新归类失败");
    } finally {
      if (alive.current) setClassifying(false);
    }
  }

  async function suggestReadings() {
    setReading(true);
    setError("");
    try {
      const updated = await apiSend<Question>(`/api/questions/${id}/readings`, "POST");
      if (alive.current) setQuestion(updated);
    } catch (e) {
      /* readings 失败返回 400 + { error }，apiSend 会抛，这里如实说。 */
      setError(e instanceof Error ? e.message : "生成推荐阅读失败");
    } finally {
      if (alive.current) setReading(false);
    }
  }

  async function archive() {
    setError("");
    try {
      const updated = await apiSend<Question>(`/api/questions/${id}`, "PATCH", {
        status: question?.status === "archived" ? "open" : "archived",
      });
      if (alive.current) setQuestion(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "归档失败");
    }
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
  const { body: shownBody, cut: shownCut } = splitInterrupt(shown);

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
      {/* 悬空目录：默认只有刻度，悬停才展开文字。
          做成 fixed 覆盖层而不是布局里的一列 —— 重新加一列会把
          刚去掉的「并排参差」问题带回来；覆盖层不占宽度。 */}
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

      <div className="q-shell">
        {/* ---------------- 题头 ---------------- */}
        <div className="q-head" id="q-topic">
          <div className="q-head-top">
            <span>{questionKindName(question.kind)}</span>
            <span className="state-mark">{questionStatusName(question.status)}</span>
            {question.source ? <span>出自 {question.source}</span> : null}
            {question.domains.map((d) => (
              <span key={d}>{d}</span>
            ))}
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
            onClick={classify}
            disabled={classifying}
          >
            {classifying ? "正在归类…" : "重新归类"}
          </button>
          <button
            type="button"
            className="board-bar-btn"
            onClick={suggestReadings}
            disabled={reading}
          >
            {reading ? "正在找…" : "找推荐阅读"}
          </button>
          <button type="button" className="board-bar-btn" onClick={archive}>
            {question.status === "archived" ? "取消归档" : "归档"}
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
                <div className="q-status">
                  <span>{PHASE_TEXT[phase] || "正在写回答"}</span>
                </div>
                {streaming !== "" ? (
                  <div className="q-body q-cursor">
                    <Markdown>{streaming}</Markdown>
                  </div>
                ) : (
                  <div className="q-empty">
                    <p>{PHASE_TEXT[phase] || "正在写回答"}…</p>
                  </div>
                )}
              </>
            ) : ai ? (
              <>
                {shownCut ? (
                  <div className="q-status">
                    <span>这一段没生成完</span>
                  </div>
                ) : null}
                {shownBody ? (
                  <div className="q-body">
                    <Markdown>{shownBody}</Markdown>
                  </div>
                ) : null}
                <div className="row" style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="board-bar-btn"
                    onClick={generate}
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
                  onClick={generate}
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
                  onClick={classify}
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
                  onClick={suggestReadings}
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
    </div>
  );
}
