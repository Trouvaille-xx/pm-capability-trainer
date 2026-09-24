"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { CAPTURE_KINDS, DOMAINS, captureKindName } from "@/lib/catalog";
import { apiGet, apiSend, formatDate } from "@/lib/client";
import {
  IconArrowRight,
  IconEdit,
  IconPlus,
  IconSave,
  IconTrash,
} from "@/components/icons";
import { FolderTabs } from "@/components/FolderTabs";
import { ConfirmDialog, Modal } from "@/components/Modal";
import type { Capture, CaptureKind } from "@/lib/types";

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
    tags: capture.tags.join(", "),
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
    <Suspense fallback={<div className="stack"><div className="loading">加载中…</div></div>}>
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
  const [kindFilter, setKindFilter] = useState<CaptureKind | "all">("all");
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Capture | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [showForm, setShowForm] = useState(false);

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

  // 支持从详情页「编辑」跳过来：/capture?edit=<id> 直接打开编辑弹窗
  const editParam = searchParams.get("edit");
  useEffect(() => {
    if (!editParam || items.length === 0) return;
    const target = items.find((item) => item.id === editParam);
    if (target) {
      setEditingId(target.id);
      setForm(toForm(target));
      setShowForm(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, items]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (kindFilter !== "all" && item.kind !== kindFilter) return false;
      if (q === "") return true;
      const haystack = [
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
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [items, kindFilter, query]);

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setShowForm(true);
  }

  function startEdit(capture: Capture) {
    setEditingId(capture.id);
    setForm(toForm(capture));
    setFormError("");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setFormError("");
    setEditingId(null);
    setForm(EMPTY_FORM);
    // 从详情页带 ?edit=xxx 进来时，关掉弹窗要把参数清掉
    if (searchParams.get("edit")) router.replace("/capture");
  }

  async function save() {
    if (form.title.trim() === "") {
      setFormError("标题不能为空");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      const payload = {
        kind: form.kind,
        title: form.title,
        author: form.author,
        source: form.source,
        status: form.status,
        tags: form.tags
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean),
        domains: form.domains,
        summary: form.summary,
        keyPoints: form.keyPoints
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean),
        thoughts: form.thoughts,
        rating: form.rating,
      };

      if (editingId) {
        await apiSend<Capture>(`/api/captures/${editingId}`, "PATCH", payload);
      } else {
        await apiSend<Capture>("/api/captures", "POST", payload);
      }
      closeForm();
      await load();
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
      await apiSend(`/api/captures/${pendingDelete.id}`, "DELETE");
      setPendingDelete(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>记录总结</h1>
        </div>
        <div className="page-actions">
          <input
            className="input"
            placeholder="搜索标题 / 标签 / 正文…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn btn-primary" onClick={startCreate}>
            <IconPlus width={15} height={15} />
            新建记录
          </button>
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      <FolderTabs
        tabs={[
          { id: "all", label: "全部", count: items.length },
          ...CAPTURE_KINDS.map((kind) => ({
            id: kind.id,
            label: kind.name,
            count: items.filter((i) => i.kind === kind.id).length,
          })),
        ]}
        active={kindFilter}
        onSelect={(id) => setKindFilter(id as CaptureKind | "all")}
      />

      <Modal
        open={showForm}
        title={editingId ? "编辑记录" : "新建记录"}
        subtitle="「内容总结」用自己的话写，「笔记思考」写它跟你的具体问题有什么关系。"
        onClose={closeForm}
        width={720}
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

        <div className="grid grid-3">
          <div className="field">
            <label>类型</label>
            <select
              className="select"
              value={form.kind}
              onChange={(e) =>
                setForm({ ...form, kind: e.target.value as CaptureKind })
              }
            >
              {CAPTURE_KINDS.map((kind) => (
                <option key={kind.id} value={kind.id}>
                  {kind.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>状态</label>
            <select
              className="select"
              value={form.status}
              onChange={(e) =>
                setForm({ ...form, status: e.target.value as Capture["status"] })
              }
            >
              <option value="inbox">待处理</option>
              <option value="doing">进行中</option>
              <option value="done">已完成</option>
            </select>
          </div>
          <div className="field">
            <label>评分</label>
            <select
              className="select"
              value={form.rating}
              onChange={(e) => setForm({ ...form, rating: Number(e.target.value) })}
            >
              <option value={0}>未评分</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {"★".repeat(n)}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label>标题</label>
          <input
            className="input"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="书名 / 文章标题 / 一句话概括这个想法"
          />
        </div>

        <div className="grid grid-2">
          <div className="field">
            <label>作者</label>
            <input
              className="input"
              value={form.author}
              onChange={(e) => setForm({ ...form, author: e.target.value })}
              placeholder="选填"
            />
          </div>
          <div className="field">
            <label>来源</label>
            <input
              className="input"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
              placeholder="链接 / 出版社 / 出处"
            />
          </div>
        </div>

        <div className="field">
          <label>内容总结</label>
          <textarea
            className="textarea"
            value={form.summary}
            onChange={(e) => setForm({ ...form, summary: e.target.value })}
            placeholder="用自己的话概括：它到底在说什么、论证链条是什么"
          />
        </div>

        <div className="field">
          <label>关键要点</label>
          <textarea
            className="textarea"
            value={form.keyPoints}
            onChange={(e) => setForm({ ...form, keyPoints: e.target.value })}
            placeholder="一行一条，便于之后直接抽成方法论卡片"
          />
          <div className="hint">一行一条</div>
        </div>

        <div className="field">
          <label>笔记思考</label>
          <textarea
            className="textarea"
            value={form.thoughts}
            onChange={(e) => setForm({ ...form, thoughts: e.target.value })}
            placeholder="我从中想到了什么？它能解释我遇到的哪个具体问题？"
          />
        </div>

        <div className="field">
          <label>标签</label>
          <input
            className="input"
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
            placeholder="用逗号分隔，例如：留存, 定价"
          />
        </div>

        <div className="field">
          <label>关联领域</label>
          <div className="row" style={{ gap: 6 }}>
            {DOMAINS.map((domain) => {
              const on = form.domains.includes(domain);
              return (
                <button
                  key={domain}
                  type="button"
                  className={`tag${on ? " tag-brand" : ""}`}
                  style={{ cursor: "pointer" }}
                  onClick={() =>
                    setForm({
                      ...form,
                      domains: on
                        ? form.domains.filter((d) => d !== domain)
                        : [...form.domains, domain],
                    })
                  }
                >
                  {domain}
                </button>
              );
            })}
          </div>
        </div>
      </Modal>

      <div className="folder-pane">
        {loading ? (
          <div className="loading">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="empty">
            {items.length === 0
              ? "还没有记录。点右上角「新建记录」开始，读书笔记、文章总结、随手想法都可以。"
              : "没有匹配的记录。"}
          </div>
        ) : (
          <div className="stack" style={{ gap: 10 }}>
            {filtered.map((capture) => (
            <div key={capture.id} className="card card-tight">
              <div className="row" style={{ marginBottom: 6 }}>
                <span className="tag">{captureKindName(capture.kind)}</span>
                {capture.rating > 0 ? (
                  <span className="tag tag-warn">{"★".repeat(capture.rating)}</span>
                ) : null}
                {capture.status === "done" ? (
                  <span className="tag tag-good">已完成</span>
                ) : capture.status === "doing" ? (
                  <span className="tag">进行中</span>
                ) : null}
                <div className="spacer" />
                <span className="list-sub">{formatDate(capture.createdAt)}</span>
              </div>

              <div className="list-title">{capture.title}</div>
              {capture.author || capture.source ? (
                <div className="list-sub" style={{ marginBottom: 6 }}>
                  {[capture.author, capture.source].filter(Boolean).join(" · ")}
                </div>
              ) : null}

              {capture.summary ? (
                <p className="clamp-3" style={{ margin: "8px 0 6px" }}>
                  {capture.summary}
                </p>
              ) : null}

              {capture.keyPoints.length > 0 ? (
                <ul style={{ margin: "6px 0", paddingLeft: 18 }}>
                  {capture.keyPoints.slice(0, 3).map((point, index) => (
                    <li key={index} className="list-sub">
                      {point}
                    </li>
                  ))}
                </ul>
              ) : null}

              {capture.thoughts ? (
                <div
                  className="notice"
                  style={{ marginTop: 8, whiteSpace: "pre-wrap" }}
                >
                  {capture.thoughts}
                </div>
              ) : null}

              {capture.tags.length > 0 || capture.domains.length > 0 ? (
                <div className="row" style={{ marginTop: 9, gap: 6 }}>
                  {capture.tags.map((tag) => (
                    <span key={tag} className="tag">
                      #{tag}
                    </span>
                  ))}
                  {capture.domains.map((domain) => (
                    <span key={domain} className="tag tag-brand">
                      {domain}
                    </span>
                  ))}
                </div>
              ) : null}

              <div className="card-actions">
                <Link
                  href={`/capture/${capture.id}`}
                  className="btn btn-sm btn-ghost card-open"
                >
                  查看详情
                  <IconArrowRight width={13} height={13} />
                </Link>
                <div className="spacer" />
                <button
                  className="btn btn-sm"
                  onClick={() => startEdit(capture)}
                  title="编辑"
                >
                  <IconEdit width={13} height={13} />
                  编辑
                </button>
                <button
                  className="btn btn-sm btn-danger"
                  onClick={() => setPendingDelete(capture)}
                  title="删除"
                >
                  <IconTrash width={13} height={13} />
                  删除
                </button>
              </div>
            </div>
          ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除记录"
        message={`确定删除「${pendingDelete?.title ?? ""}」？删除后无法恢复。`}
        busy={deleting}
        onConfirm={destroy}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

/** 记录详情抽屉：完整展示总结、要点与笔记思考，列表里只留摘要。 */
