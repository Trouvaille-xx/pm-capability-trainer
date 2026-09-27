"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  QUESTION_KINDS,
  questionKindName,
  questionProgress,
} from "@/lib/catalog";
import { apiGet, apiSend, formatDate } from "@/lib/client";
import { assignTilts, tiltStyle } from "@/lib/board";
import { IconPlus, IconSave } from "@/components/icons";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { DomainTags } from "@/components/DomainTags";
import type { Question, QuestionKind } from "@/lib/types";

/**
 * 题库 —— 题目墙。
 *
 * 一道题在板上占五个块：题目 / 我的回答 / AI 回答 / 相关知识 / 推荐阅读。
 * 但墙上不该把这些铺开 —— 墙只回答一件事：这道题走到哪一步了。
 * 所以每张纸上只有「题目 + 五格进度」，细节全在详情页。
 *
 * 点纸 = 直接进详情页。不做「点一下先在纸上长出一条菜单」：
 * 多一次点击换来的选项，悬停在纸上已经给了。
 */

/** 筛选口径。注意「待作答」是没写我的回答，跟 status 不是一个概念。 */
type Filter = "all" | QuestionKind | "open" | "archived";

/** 全站统一的状态口径，列表和详情页读同一句话。 */
function statusName(q: Question): string {
  if (q.status === "archived") return "已归档";
  if (q.myAnswer.trim() !== "") return "已完成";
  if (q.aiGenerating) return "AI 在答";
  if (q.aiAnswer.trim() !== "") return "差我的回答";
  return "待作答";
}

/** 空着的内容不写、不占位 —— 纸上的空行会读成「加载失败」。 */
function joined(parts: string[], sep = " "): string {
  return parts.filter((p) => p.trim() !== "").join(sep);
}

export default function QuestionsPage() {
  const router = useRouter();

  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const [pendingDelete, setPendingDelete] = useState<Question | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [source, setSource] = useState("");
  const [kind, setKind] = useState<QuestionKind>("other");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  const searchRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      setQuestions(await apiGet<Question[]>("/api/questions"));
      setError("");
    } catch (e) {
      /* apiGet 非 2xx 直接抛，把服务端的话原样端出来。 */
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const by = (fn: (q: Question) => boolean) => questions.filter(fn).length;
    return {
      all: questions.length,
      interview: by((q) => q.kind === "interview"),
      thinking: by((q) => q.kind === "thinking"),
      open: by((q) => q.status !== "archived" && q.myAnswer.trim() === ""),
      archived: by((q) => q.status === "archived"),
    };
  }, [questions]);

  /** 筛完之后还空着几道 —— 页脚那句总览要按当前筛选说，才是真话。 */
  const shownOpen = useMemo(
    () =>
      questions.filter((q) => q.status !== "archived" && q.myAnswer.trim() === "")
        .length,
    [questions],
  );

  const answered = counts.all - shownOpen;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return questions.filter((item) => {
      if (filter === "interview" || filter === "thinking" || filter === "other") {
        if (item.kind !== filter) return false;
      } else if (filter === "open") {
        if (item.status === "archived" || item.myAnswer.trim() !== "") return false;
      } else if (filter === "archived") {
        if (item.status !== "archived") return false;
      }
      if (q === "") return true;
      return [item.prompt, item.source, item.myAnswer, item.tags.join(" ")]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [questions, filter, query]);

  /* 角度按全量列表算，不能按 filtered 算 ——
     否则一筛选，同一张纸就换个角度贴，位置记忆全废。 */
  const TILTS = useMemo(() => assignTilts(questions), [questions]);

  /* `/` 聚焦搜索框，Escape 清空。
     弹窗自己处理 Escape，所以只在没有弹窗时才接管。 */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);

      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && !showForm && !pendingDelete) {
        setQuery("");
        searchRef.current?.blur();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [showForm, pendingDelete]);

  function openQuestion(item: Question) {
    router.push(`/questions/${item.id}`);
  }

  function startCreate() {
    setEditingId(null);
    setPrompt("");
    setSource("");
    setKind("other");
    setFormError("");
    setShowForm(true);
  }

  function startEdit(item: Question) {
    setEditingId(item.id);
    setPrompt(item.prompt);
    setSource(item.source);
    setKind(item.kind);
    setFormError("");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setFormError("");
  }

  async function save() {
    if (prompt.trim() === "") {
      setFormError("题目不能空着");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      if (editingId) {
        await apiSend<Question>(`/api/questions/${editingId}`, "PATCH", {
          prompt: prompt.trim(),
          source,
          kind,
        });
        closeForm();
        await load();
      } else {
        /* 手动建题不触发 AI 归类：归类是详情页的动作，记一道题应当立刻落地。
           归类失败也不会阻塞保存，详情页里再补。 */
        const created = await apiSend<Question>("/api/questions", "POST", {
          prompt: prompt.trim(),
          source,
          kind,
          classify: false,
        });
        closeForm();
        router.push(`/questions/${created.id}`);
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function destroy() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await apiSend(`/api/questions/${pendingDelete.id}`, "DELETE");
      setPendingDelete(null);
      await load();
    } catch (e) {
      /* 先收起弹窗再报错：load() 成功会把 error 清掉，
         顺序反了这条提示就永远看不见。 */
      setPendingDelete(null);
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>题库</h1>
          <p className="lede">
            面试真题、别人抛来的问题、自己想的思考题。先自己答一遍，再看 AI 怎么答。
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={startCreate}>
            <IconPlus width={15} height={15} />
            记一道题
          </button>
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      <Modal
        open={showForm}
        title={editingId ? "改这道题" : "记一道题"}
        subtitle={
          editingId
            ? "题目、出处、类型都可以改；两个回答在详情页里写。"
            : "先把题记下来。回答和归类都不急，回头看的时候再补。"
        }
        onClose={closeForm}
        width={620}
        footer={
          <>
            <div className="spacer" />
            <button className="btn" onClick={closeForm} disabled={saving}>
              取消
            </button>
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              <IconSave width={14} height={14} />
              {saving ? "保存中…" : "保存"}
            </button>
          </>
        }
      >
        {formError ? (
          <div className="notice notice-error" style={{ marginBottom: 12 }}>
            {formError}
          </div>
        ) : null}

        <div className="field">
          <label>题目</label>
          <textarea
            className="form-textarea"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="例如：一个已经有 500 万 DAU 的工具类产品，让你把次日留存从 32% 提到 40%，你第一步做什么？"
          />
        </div>

        <div className="grid grid-2">
          <div className="field">
            <label>出处</label>
            <input
              className="form-input"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="公司名、面试官，或者「自己想的」"
            />
          </div>
          <div className="field">
            <label>类型</label>
            <select
              className="form-input"
              value={kind}
              onChange={(e) => setKind(e.target.value as QuestionKind)}
            >
              {QUESTION_KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </Modal>

      {/* 检索 + 筛选。接口没有查询参数，过滤全在前端。 */}
      <div className="controls">
        <label className="lookup">
          <input
            ref={searchRef}
            placeholder="搜索题目、关键词…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索题目"
          />
          <span className="lookup-hint">
            {query.trim() === ""
              ? `${questions.length} 道中检索`
              : `显示 ${filtered.length} / ${questions.length}`}
          </span>
        </label>

        <div className="filters">
          <button
            className={filter === "all" ? "on" : ""}
            onClick={() => setFilter("all")}
          >
            全部 {counts.all}
          </button>
          <button
            className={filter === "interview" ? "on" : ""}
            onClick={() => setFilter("interview")}
          >
            面试真题 {counts.interview}
          </button>
          <button
            className={filter === "thinking" ? "on" : ""}
            onClick={() => setFilter("thinking")}
          >
            思考题 {counts.thinking}
          </button>
          <button
            className={filter === "open" ? "on" : ""}
            onClick={() => setFilter("open")}
          >
            待作答 {counts.open}
          </button>
          <button
            className={filter === "archived" ? "on" : ""}
            onClick={() => setFilter("archived")}
          >
            已归档 {counts.archived}
          </button>
        </div>
      </div>

      {/* 纸直接摊在板上，不套面板：便签跟板底的关系要留着。 */}
      <div className="board">
        {loading ? (
          <div className="loading">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-board">
            <h3>{questions.length === 0 ? "题库还是空的" : "没有匹配的题"}</h3>
            <p>
              {questions.length === 0
                ? "这里放面试真题和思考题。一道题占五个块：题目、我的回答、AI 回答、相关知识、推荐阅读 —— 先自己答一遍，再看 AI 怎么答。"
                : "换个关键词，或者把筛选切回全部。"}
            </p>
            <div className="hint-actions">
              {questions.length === 0 ? (
                <button className="go" onClick={startCreate}>
                  记一道题
                </button>
              ) : (
                <button
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                  }}
                >
                  看全部
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="wall">
            {filtered.map((item) => {
              const progress = questionProgress(item);
              const done = progress.filter((p) => p.done).length;
              const head = joined([questionKindName(item.kind), item.source], "　");

              return (
                <article
                  key={item.id}
                  className="note"
                  style={tiltStyle(TILTS[item.id] ?? 0)}
                  onClick={() => openQuestion(item)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openQuestion(item);
                    }
                  }}
                  tabIndex={0}
                  role="button"
                  aria-label={`查看「${item.prompt.slice(0, 40)}」`}
                >
                  <span className="note-pin" aria-hidden="true" />

                  <div className="note-domain">
                    <span>{head}</span>
                    <span className="state-mark">{statusName(item)}</span>
                  </div>

                  <h2 className="q-title">{item.prompt}</h2>

                  {/* 领域：原来便签上不显示，得点进去才知道归到哪一类 */}
                  <DomainTags domains={item.domains} />

                  {/* 五格进度。整张纸上只有第二格是朱砂 ——
                      它标记「我自己动手写过」，跟 AI 生成的部分分得开。 */}
                  <div className="q-steps">
                    {progress.map((step) => (
                      <span
                        key={step.key}
                        className={step.mine ? "q-step is-mine" : "q-step"}
                        data-on={step.done ? "true" : "false"}
                      />
                    ))}
                  </div>

                  {/* 动作挂在页脚这一行的右侧，不单独占一行。
                      每个动作都要 stopPropagation，否则点「删除」会先冒泡进详情页。 */}
                  <div className="q-foot">
                    <span>{formatDate(item.createdAt)}</span>
                    <span className="q-count">{done}/5</span>

                    <span className="note-ops">
                      <Link
                        href={`/questions/${item.id}`}
                        className="note-op"
                        onClick={(e) => e.stopPropagation()}
                        tabIndex={-1}
                      >
                        打开
                      </Link>
                      <span
                        role="button"
                        tabIndex={-1}
                        className="note-op"
                        onClick={(e) => {
                          e.stopPropagation();
                          startEdit(item);
                        }}
                      >
                        编辑
                      </span>
                      <span
                        role="button"
                        tabIndex={-1}
                        className="note-op note-op-danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingDelete(item);
                        }}
                      >
                        删除
                      </span>
                    </span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>

      {/* 页脚只留一句真总览。数字全是按真实数据算出来的，不写死。
          分类计数是「另一层」信息，靠 flex 推到右端独立成项 ——
          三段文字挤成一行连读，读起来像乱码。 */}
      {!loading && counts.all > 0 ? (
        <div className="colophon">
          <span>
            一共 {counts.all} 道题，答过 {answered} 道，还有 {shownOpen} 道空着
          </span>
          <span>
            面试真题 {counts.interview}
            {"　"}
            思考题 {counts.thinking}
            {counts.archived > 0 ? <>{"　"}已归档 {counts.archived}</> : null}
          </span>
        </div>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除题目"
        message={`确定删除「${(pendingDelete?.prompt ?? "").slice(0, 40)}${
          (pendingDelete?.prompt ?? "").length > 40 ? "…" : ""
        }」？写过的回答和 AI 生成的内容会一起删掉，无法恢复。`}
        busy={deleting}
        onConfirm={destroy}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
