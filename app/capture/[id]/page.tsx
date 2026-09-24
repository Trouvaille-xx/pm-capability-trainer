"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  IconArticle,
  IconBack,
  IconBook,
  IconCalendar,
  IconEdit,
  IconList,
  IconNote,
  IconSpark,
  IconTag,
  IconUser,
} from "@/components/icons";
import { ConfirmDialog } from "@/components/Modal";
import { apiGet, apiSend } from "@/lib/client";
import type { Capture, CaptureKind } from "@/lib/types";

const KIND_META: Record<
  CaptureKind,
  { name: string; Icon: typeof IconBook }
> = {
  book: { name: "图书", Icon: IconBook },
  article: { name: "文章", Icon: IconArticle },
  note: { name: "笔记思考", Icon: IconNote },
};

function formatDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * 记录详情页。和知识点详情同理：
 * 长内容值得一个独立页面，而不是塞进抽屉。
 */
export default function CaptureDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [capture, setCapture] = useState<Capture | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await apiGet<Capture[]>("/api/captures");
      const found = list.find((c) => c.id === id) ?? null;
      if (!found) {
        setError("没有找到这条记录，它可能已经被删除了。");
      } else {
        setCapture(found);
        setError("");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function destroy() {
    if (!capture) return;
    setDeleting(true);
    try {
      await apiSend(`/api/captures/${capture.id}`, "DELETE");
      router.push("/capture");
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="stack">
        <div className="loading">加载中…</div>
      </div>
    );
  }

  if (error || !capture) {
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <h1>记录</h1>
          </div>
          <div className="page-actions">
            <Link href="/capture" className="btn">
              <IconBack width={14} height={14} />
              返回列表
            </Link>
          </div>
        </div>
        <div className="folder-pane">
          <div className="empty">{error || "没有找到这条记录。"}</div>
        </div>
      </div>
    );
  }

  const meta = KIND_META[capture.kind] ?? KIND_META.note;
  const KindIcon = meta.Icon;

  return (
    <div className="stack">
      <div className="detail-head">
        <Link
          href="/capture"
          className="btn btn-sm detail-back"
          title="返回记录列表"
        >
          <IconBack width={14} height={14} />
          返回
        </Link>

        <div className="detail-title-wrap">
          <h1 className="detail-title">{capture.title}</h1>
          <div className="detail-meta">
            <span className="detail-meta-item">
              <KindIcon width={13} height={13} />
              {meta.name}
            </span>
            {capture.author ? (
              <span className="detail-meta-item">
                <IconUser width={13} height={13} />
                {capture.author}
              </span>
            ) : null}
            {capture.source ? (
              <span className="detail-meta-item">
                <IconTag width={13} height={13} />
                {capture.source}
              </span>
            ) : null}
            <span className="detail-meta-item">
              <IconCalendar width={13} height={13} />
              {formatDate(capture.createdAt)}
            </span>
            {capture.rating > 0 ? (
              <span className="detail-meta-item">
                {"★".repeat(capture.rating)}
              </span>
            ) : null}
            {capture.status === "done" ? (
              <span className="tag tag-good">已完成</span>
            ) : capture.status === "doing" ? (
              <span className="tag">进行中</span>
            ) : (
              <span className="tag">待处理</span>
            )}
          </div>
        </div>

        <div className="detail-actions">
          <Link
            href={`/capture?edit=${capture.id}`}
            className="btn btn-sm"
            title="编辑这条记录"
          >
            <IconEdit width={13} height={13} />
            编辑
          </Link>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => setConfirming(true)}
            title="删除这条记录"
          >
            删除
          </button>
        </div>
      </div>

      <div className="folder-pane">
        <div className="detail-body">
          {capture.summary ? (
            <section>
              <div className="detail-section-head">
                <IconList width={15} height={15} />
                <h2>内容总结</h2>
              </div>
              <p>{capture.summary}</p>
            </section>
          ) : null}

          {capture.keyPoints.length > 0 ? (
            <section>
              <div className="detail-section-head">
                <IconList width={15} height={15} />
                <h2>关键要点</h2>
              </div>
              <ul className="detail-list">
                {capture.keyPoints.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {capture.thoughts ? (
            <section>
              <div className="detail-section-head">
                <IconSpark width={15} height={15} />
                <h2>笔记思考</h2>
              </div>
              <p>{capture.thoughts}</p>
            </section>
          ) : null}

          {capture.tags.length > 0 || capture.domains.length > 0 ? (
            <section>
              <div className="detail-section-head">
                <IconTag width={15} height={15} />
                <h2>标签与领域</h2>
              </div>
              <div className="row" style={{ gap: 6 }}>
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
            </section>
          ) : null}

          {!capture.summary &&
          capture.keyPoints.length === 0 &&
          !capture.thoughts ? (
            <div className="empty">
              这条记录还没有填写内容。点右上的「编辑」补充。
            </div>
          ) : null}
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title="删除记录"
        message={`确定删除「${capture.title}」？删除后无法恢复。`}
        busy={deleting}
        onConfirm={destroy}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
