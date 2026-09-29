"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { CAPTURE_KINDS, DOMAINS, captureKindName } from "@/lib/catalog";
import { apiGet, apiSend, formatDate } from "@/lib/client";
import { ConfirmDialog, Modal } from "@/components/Modal";
import { DomainTags } from "@/components/DomainTags";
import type { Capture, CaptureKind } from "@/lib/types";

/* ------------------------------------------------------------------ *
 * 显示口径
 *
 * 状态一律写成方括号里的批注记号（[待整理]）——.state-mark 的 ::before/::after
 * 会自动补上方括号。不用彩色胶囊，也不把元信息用「·」串起来。
 * ------------------------------------------------------------------ */

const STATUS_TEXT: Record<Capture["status"], string> = {
  inbox: "待整理",
  doing: "整理中",
  done: "已消化",
};

const STATUSES: Capture["status"][] = ["inbox", "doing", "done"];

/** 筛选口径：全部 / 三种类型 / 待整理。 */
type Filter = "all" | CaptureKind | "inbox";

/* 详情页的「编辑」通过这个参数把用户带回来直接打开表单。 */
const EDIT_PARAM = "edit";

/**
 * 便签倾角。
 *
 * 参考稿要求「每个条目的角度都不一样，且同一条目每次都一样」：
 * 先按 id 哈希排定名次，再把一批互不相等的候选角度按名次分配。
 * 所以新增一条不会让已有的便签改变倾角（位置记得住）。
 */
function tiltPool(size: number): number[] {
  const min = 3.5;
  const max = 15;
  const steps = Math.max(1, Math.floor((size - 1) / 2));
  const out: number[] = [];
  for (let i = 0; i < size; i += 1) {
    const sign = i % 2 === 0 ? 1 : -1;
    const rank = Math.floor(i / 2);
    out.push(sign * (min + ((max - min) * rank) / steps));
  }
  return out.map((v) => Math.round(v * 10) / 10);
}

function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function assignTilts(items: Capture[]): Record<string, number> {
  if (items.length === 0) return {};
  const pool = tiltPool(items.length);
  const order = items
    .map((item, index) => ({ index, key: hashId(item.id) }))
    .sort((a, b) => a.key - b.key)
    .map((entry) => entry.index);

  const map: Record<string, number> = {};
  order.forEach((itemIndex, rank) => {
    map[items[itemIndex].id] = pool[rank];
  });
  return map;
}

/** 五格星级：实心 ★、空心 ☆。列表里不染色，朱砂留给「你在这里」。 */
function StarMark({ rating }: { rating: number }) {
  return (
    <span className="stars" title={rating > 0 ? `${rating} 星` : "未评分"}>
      {[1, 2, 3, 4, 5].map((n) =>
        n <= rating ? <b key={n}>★</b> : <span key={n}>☆</span>,
      )}
    </span>
  );
}

interface FormState {
  kind: CaptureKind;
  title: string;
  author: string;
  source: string;
  status: Capture["status"];
  tags: string;
  domains: string[];
  summary: string;
  keyPoints: string;
  thoughts: string;
  rating: number;
}

const EMPTY_FORM: FormState = {
  kind: "note",
  title: "",
  author: "",
  source: "",
  status: "inbox",
  tags: "",
  domains: [],
  summary: "",
  keyPoints: "",
  thoughts: "",
  rating: 0,
};

function toForm(capture: Capture): FormState {
  return {
    kind: capture.kind,
    title: capture.title,
    author: capture.author,
    source: capture.source,
    status: capture.status,
    tags: capture.tags.join("，"),
    domains: capture.domains,
    summary: capture.summary,
    keyPoints: capture.keyPoints.join("\n"),
    thoughts: capture.thoughts,
    rating: capture.rating,
  };
}

/**
 * 页面外壳。
 *
 * useSearchParams() 在静态预渲染时必须包在 Suspense 里，
 * 否则 `next build` 会直接失败（Missing Suspense with CSR bailout）。
 * 真正的页面逻辑放在 CapturePageInner。
 */
export default function CapturePage() {
  return (
    <Suspense fallback={<div className="loading">加载中…</div>}>
      <CapturePageInner />
    </Suspense>
  );
}

function CapturePageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [items, setItems] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  /** 正在改状态 / 评分的便签 id，避免连点。 */
  const [busyId, setBusyId] = useState<string | null>(null);
  /**
   * 拿起来的那张便签。
   *
   * 便签是纸，纸不长按钮 —— 先点一张「拿起来」，操作集中出现在板下方。
   * 再点同一张就放回去，点另一张就换手。
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Capture | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await apiGet<Capture[]>("/api/captures"));
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

  const editParam = searchParams.get(EDIT_PARAM);
  useEffect(() => {
    if (!editParam || items.length === 0) return;
    const target = items.find((item) => item.id === editParam);
    if (target) {
      setEditingId(target.id);
      setForm(toForm(target));
      setFormError("");
      setShowForm(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, items]);

  const counts = useMemo(
    () =>
      ({
        all: items.length,
        book: items.filter((i) => i.kind === "book").length,
        article: items.filter((i) => i.kind === "article").length,
        note: items.filter((i) => i.kind === "note").length,
        inbox: items.filter((i) => i.status === "inbox").length,
      }) satisfies Record<Filter, number>,
    [items],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (filter === "inbox" && item.status !== "inbox") return false;
      if (filter !== "all" && filter !== "inbox" && item.kind !== filter) {
        return false;
      }
      if (q === "") return true;
      return [
        item.title,
        item.author,
        item.source,
        item.summary,
        item.thoughts,
        item.keyPoints.join(" "),
        item.tags.join(" "),
        item.domains.join(" "),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [items, filter, query]);

  const tilts = useMemo(() => assignTilts(items), [items]);

  /** 选中的那张。它被筛掉或删掉之后，操作条要自己收起来。 */
  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  function toggleSelect(id: string) {
    setSelectedId((prev) => (prev === id ? null : id));
  }

  /**
   * Esc 把拿起来的那张放回去。
   * 搜索框里按 Esc 是在清检索词（用户的意图更具体），所以输入框内不抢。
   */
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      const t = document.activeElement as HTMLElement | null;
      if (t && typeof t.closest === "function" && t.closest("input,textarea,select")) {
        return;
      }
      setSelectedId(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setShowForm(true);
  }

  /* 编辑不再走弹窗 —— 那个流程要贴长原文、等 AI 读、逐项改，
     弹窗里做会很挤，而且关掉就丢。统一去独立编辑页。 */
  function startEdit(capture: Capture) {
    router.push(`/capture/${capture.id}/edit`);
  }

  function closeForm() {
    setShowForm(false);
    setFormError("");
    setEditingId(null);
    setForm(EMPTY_FORM);
    // 从详情页带 ?edit=xxx 进来时，关掉表单要把参数清掉
    if (searchParams.get(EDIT_PARAM)) router.replace("/capture");
  }

  /**
   * 新建。弹窗只收「标题 + 类型」，建完直接进编辑页 ——
   * 总结 / 要点 / 标签 / 思考都在那边做，没必要让人先在弹窗里对着空字段发呆。
   */
  async function save() {
    const title = form.title.trim();
    if (title === "") {
      setFormError("先给它起个标题。");
      return;
    }

    setSaving(true);
    setFormError("");
    try {
      const created = await apiSend<Capture>("/api/captures", "POST", {
        kind: form.kind,
        title,
      });
      closeForm();
      router.push(`/capture/${created.id}/edit`);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "保存失败");
      setSaving(false);
    }
  }

  /** 就地改状态或评分。失败就把服务端的话原样摆在墙上。 */
  async function patchCapture(
    capture: Capture,
    changes: Partial<Pick<Capture, "status" | "rating">>,
  ) {
    setBusyId(capture.id);
    try {
      await apiSend<Capture>(`/api/captures/${capture.id}`, "PATCH", changes);
      setItems((prev) =>
        prev.map((item) =>
          item.id === capture.id ? { ...item, ...changes } : item,
        ),
      );
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "改动没保存上");
    } finally {
      setBusyId(null);
    }
  }

  /** 撕掉一张。确认之后才真的删，删完把选中态也放掉。 */
  async function destroy() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await apiSend(`/api/captures/${pendingDelete.id}`, "DELETE");
      if (selectedId === pendingDelete.id) setSelectedId(null);
      setPendingDelete(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  const total = items.length;
  const titleReady = form.title.trim() !== "";

  return (
    <div className="stack">
      <header>
        <div className="page-head">
          <div>
            <h1>记录总结</h1>
            <div className="lede">
              板上 {total} 张，还有 {counts.inbox} 张没整理。
            </div>
          </div>
          <div className="viewswitch">
            <button
              type="button"
              className="vs-btn on"
              onClick={startCreate}
              title="新建一条记录"
            >
              钉一张便签
            </button>
          </div>
        </div>

        <div className="controls">
          <div className="lookup">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="在便签里查…"
              aria-label="在便签里查"
            />
            <span className="lookup-hint">
              {query.trim() === ""
                ? `${total} 张中检索`
                : `显示 ${filtered.length} / ${total}`}
            </span>
          </div>

          <div className="filters">
            {(
              [
                ["all", "全部"],
                ["book", "图书"],
                ["article", "文章"],
                ["note", "笔记"],
                ["inbox", "待整理"],
              ] as [Filter, string][]
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={filter === id ? "on" : ""}
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
                <span className="count">{counts[id]}</span>
              </button>
            ))}
          </div>
        </div>
      </header>

      {error ? (
        <div className="board-error">
          <span className="notice notice-error">{error}</span>
          <button type="button" onClick={() => void load()}>
            重新读取
          </button>
        </div>
      ) : null}

      <section className="board">
        {loading ? (
          <div className="loading">正在读 data/captures.json…</div>
        ) : total === 0 ? (
          /* 真实空态：data/captures.json 还不存在，这块板本来就是空的。
             所以这不是占位符，是它现在的样子。 */
          <div className="wall">
            <div className="empty-board">
              <h3>这块板还是空的</h3>
              <p>
                读到一段话、看到一个例子、脑子里闪过一个念头，都可以钉在这里。
                <br />
                定好标题，写下原文，再写一句「我从中想到了什么」。
                <br />
                攒够几张之后，可以把它们提炼成方法论词条。
              </p>
              <div className="hint-actions">
                <button type="button" className="go" onClick={startCreate}>
                  记第一条
                </button>
              </div>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <div className="wall">
            <div className="empty-board">
              <h3>没有对上的便签</h3>
              <p>换个词再查，或者把筛选调回全部。</p>
              <div className="hint-actions">
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setFilter("all");
                  }}
                >
                  清掉筛选
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="wall">
            {filtered.map((capture) => {
              const lifted = selectedId === capture.id;
              const foot =
                [capture.author, capture.source].filter(Boolean).join("，") ||
                formatDate(capture.createdAt);
              return (
                <article
                  key={capture.id}
                  className="note"
                  data-lifted={lifted}
                  style={
                    {
                      "--tilt": `${tilts[capture.id] ?? 0}deg`,
                    } as React.CSSProperties
                  }
                  tabIndex={0}
                  role="button"
                  aria-pressed={lifted}
                  aria-label={`${capture.title}（选中后可在板下方操作）`}
                  onClick={() => toggleSelect(capture.id)}
                  onDoubleClick={() => router.push(`/capture/${capture.id}`)}
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleSelect(capture.id);
                    }
                  }}
                >
                  <span className="note-pin" aria-hidden="true" />

                  <div className="note-domain">
                    <span>{captureKindName(capture.kind)}</span>
                    <span className="state-mark">
                      {STATUS_TEXT[capture.status]}
                    </span>
                  </div>

                  <h2 className="note-title">{capture.title}</h2>

                  {/* 领域：便签上一眼看出归到哪一类，不用点进去 */}
                  <DomainTags domains={capture.domains} />

                  {capture.summary ? (
                    <p className="note-detail">{capture.summary}</p>
                  ) : null}

                  {capture.keyPoints.length > 0 ? (
                    <ul className="note-points">
                      {capture.keyPoints.slice(0, 3).map((point, index) => (
                        <li key={index}>{point}</li>
                      ))}
                    </ul>
                  ) : null}

                  {capture.rating > 0 ? <StarMark rating={capture.rating} /> : null}

                  {capture.tags.length > 0 ? (
                    <div className="note-tags">
                      {capture.tags.slice(0, 4).map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  ) : null}

                  <div className="note-foot">
                    <span>{foot}</span>
                    <span className="spacer" />
                    <span className="note-open">打开</span>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 板下操作条：纸不长按钮，拿起一张之后操作才出现。
          它常驻在板底（sticky），所以不会随选中项的位置跳动。 */}
      {selected ? (
        <div className="board-bar">
          <span className="board-bar-title">{selected.title}</span>

          <button
            type="button"
            className="board-bar-btn"
            onClick={() => router.push(`/capture/${selected.id}`)}
          >
            打开
          </button>

          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={`board-bar-btn${
                selected.status === status ? " on" : ""
              }`}
              disabled={busyId === selected.id}
              aria-pressed={selected.status === status}
              onClick={() => void patchCapture(selected, { status })}
            >
              {STATUS_TEXT[status]}
            </button>
          ))}

          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={`board-bar-btn${selected.rating >= n ? " on" : ""}`}
              disabled={busyId === selected.id}
              aria-label={`评 ${n} 星`}
              title={selected.rating === n ? "再点一次取消评分" : `评 ${n} 星`}
              aria-pressed={selected.rating === n}
              /* 点当前那一颗 = 取消评分，所以不用再单放一个「清掉评分」 */
              onClick={() =>
                void patchCapture(selected, {
                  rating: selected.rating === n ? 0 : n,
                })
              }
            >
              {selected.rating >= n ? "★" : "☆"}
            </button>
          ))}

          <button
            type="button"
            className="board-bar-btn"
            onClick={() => startEdit(selected)}
          >
            编辑
          </button>

          <button
            type="button"
            className="board-bar-btn board-bar-btn-danger"
            onClick={() => setPendingDelete(selected)}
          >
            删除
          </button>

          <button
            type="button"
            className="board-bar-btn"
            onClick={() => setSelectedId(null)}
            title="放回去（Esc）"
          >
            放回去
          </button>
        </div>
      ) : null}

      <Modal
        open={showForm}
        title="钉一张便签"
        subtitle="先起个标题、选个类型。总结与思考在下一步的编辑页里写。"
        onClose={closeForm}
        width={680}
        footer={
          <>
            <span className="modal-hint">
              {titleReady ? "可以保存" : "还差标题"}
            </span>
            <span className="spacer" />
            <button
              type="button"
              className="btn"
              onClick={closeForm}
              disabled={saving}
            >
              取消
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? "保存中…" : "保存"}
            </button>
          </>
        }
      >
        {formError ? (
          <div className="notice notice-error" style={{ marginBottom: 16 }}>
            {formError}
          </div>
        ) : null}

        {/* 印刷品的填表方式：一条下划线，没有描边输入框 */}
        <div className="note-form">
          <div className="field">
            <label htmlFor="cap-title">标题</label>
            <input
              id="cap-title"
              className="form-input"
              value={form.title}
              maxLength={200}
              placeholder="书名 / 文章标题 / 一句话把这个念头说完"
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
            <div className="hint">200 字以内。写不下就换个更短的说法。</div>
          </div>

          <div className="field">
            <label>类型</label>
            <div className="form-choice">
              {CAPTURE_KINDS.map((kind) => (
                <button
                  key={kind.id}
                  type="button"
                  className="form-choice-chip"
                  data-on={form.kind === kind.id}
                  title={kind.blurb}
                  onClick={() => setForm({ ...form, kind: kind.id })}
                >
                  {kind.name}
                </button>
              ))}
            </div>
          </div>

        </div>
      </Modal>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="撕掉这张便签"
        message={`确定删掉「${pendingDelete?.title ?? ""}」？删了就找不回来了。`}
        busy={deleting}
        onConfirm={destroy}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
