"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { captureKindName } from "@/lib/catalog";
import { apiGet, apiSend, formatDate } from "@/lib/client";
import { ConfirmDialog } from "@/components/Modal";
import { DomainTags } from "@/components/DomainTags";
import type { Capture } from "@/lib/types";

/* 状态写成方括号里的批注记号，.state-mark 会自动补上 [ ]。 */
const STATUS_TEXT: Record<Capture["status"], string> = {
  inbox: "待整理",
  doing: "整理中",
  done: "已消化",
};

const STATUSES: Capture["status"][] = ["inbox", "doing", "done"];

/** 五格星级：实心 ★、空心 ☆。 */
function StarMark({ rating }: { rating: number }) {
  return (
    <span className="stars" style={{ marginTop: 0 }}>
      {[1, 2, 3, 4, 5].map((n) =>
        n <= rating ? <b key={n}>★</b> : <span key={n}>☆</span>,
      )}
    </span>
  );
}

/**
 * 记录详情。
 *
 * 和便签墙是同一块板的两种读法：墙上是一次看一片，这里是抽出一张摊平了看。
 * 所以长内容（总结 / 要点 / 思考）值得一个独立页面 —— 有 URL、能后退、能分享。
 */
export default function CaptureDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [capture, setCapture] = useState<Capture | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await apiGet<Capture[]>("/api/captures");
      const found = list.find((item) => item.id === id) ?? null;
      if (!found) {
        setCapture(null);
        setError("没有找到这条记录，它可能已经被删掉了。");
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

  /** 改状态或评分。就地更新，失败就把服务端的话摆出来。 */
  async function patchCapture(
    current: Capture,
    changes: Partial<Pick<Capture, "status" | "rating">>,
  ) {
    setBusy(true);
    try {
      await apiSend<Capture>(`/api/captures/${current.id}`, "PATCH", changes);
      setCapture((prev) => (prev ? { ...prev, ...changes } : prev));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "改动没保存上");
    } finally {
      setBusy(false);
    }
  }

  async function destroy() {
    if (!capture) return;
    setDeleting(true);
    try {
      await apiSend(`/api/captures/${capture.id}`, "DELETE");
      router.push("/capture");
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
      setDeleting(false);
      setPendingDelete(false);
    }
  }

  if (loading) {
    return <div className="loading">正在读这条记录…</div>;
  }

  if (!capture) {
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <h1>记录</h1>
          </div>
        </div>
        <div className="wall">
          <div className="empty-board">
            <h3>这张便签不在了</h3>
            <p>{error || "它可能已经被删掉，或者这个链接不太对。"}</p>
            <div className="hint-actions">
              <Link href="/capture" className="go">
                回到便签墙
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const hasBody =
    capture.summary !== "" ||
    capture.keyPoints.length > 0 ||
    capture.thoughts !== "";

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>记录</h1>
          <div className="lede">
            写在 {formatDate(capture.createdAt)}
            {capture.updatedAt !== capture.createdAt
              ? `，最后改动于 ${formatDate(capture.updatedAt)}`
              : ""}
            。
          </div>
        </div>
        <div className="page-actions">
          <div className="hint-actions" style={{ marginTop: 0 }}>
            {/* 这条记录最自然的下一步：直接拿它当素材开一次训练 */}
            <Link href={`/trainer/new?capture=${capture.id}`}>用它训练</Link>
            <Link href="/capture">回到便签墙</Link>
          </div>
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      <div className="reader on">
        <article className="reader-card">
          <span className="note-pin" aria-hidden="true" />

          <div className="reader-domain">
            <span>{captureKindName(capture.kind)}</span>
            <span className="state-mark">{STATUS_TEXT[capture.status]}</span>
            {capture.rating > 0 ? <StarMark rating={capture.rating} /> : null}
          </div>

          <h2 className="reader-title">{capture.title}</h2>

          {capture.summary ? (
            <p className="reader-def">{capture.summary}</p>
          ) : null}

          {capture.keyPoints.length > 0 ? (
            <section className="reader-sec">
              <span className="reader-sec-label">关键要点</span>
              <ul className="note-points" style={{ marginTop: 0, gap: 9 }}>
                {capture.keyPoints.map((point, index) => (
                  <li key={index} style={{ fontSize: 14.5, lineHeight: 1.85 }}>
                    {point}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {capture.thoughts ? (
            <section className="reader-sec">
              <span className="reader-sec-label">我的思考</span>
              <p
                className="reader-sec-body"
                style={{ whiteSpace: "pre-wrap" }}
              >
                {capture.thoughts}
              </p>
            </section>
          ) : null}

          {capture.author || capture.source ? (
            <section className="reader-sec">
              <span className="reader-sec-label">出处</span>
              <div className="reader-sec-body">
                {capture.author ? <div>作者：{capture.author}</div> : null}
                {capture.source ? <div>来源：{capture.source}</div> : null}
              </div>
            </section>
          ) : null}

          {capture.tags.length > 0 || capture.domains.length > 0 ? (
            <section className="reader-sec">
              <span className="reader-sec-label">标签</span>
              {/* 领域和自由标签分两行：它们不是一类东西，
                  挤在一行里以前都长一个样，分不出哪个是领域。 */}
              <DomainTags domains={capture.domains} />
              {capture.tags.length > 0 ? (
                <div className="note-tags" style={{ marginTop: 10 }}>
                  {capture.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {!hasBody ? (
            <p className="reader-sec-body" style={{ fontStyle: "italic" }}>
              这张便签只有标题，还没有正文。点下面的「编辑」补上。
            </p>
          ) : null}

          <div className="reader-actions">
            <Link href={`/capture?edit=${capture.id}`}>编辑</Link>
            <button
              type="button"
              className="reader-danger"
              onClick={() => setPendingDelete(true)}
              title="删除这条记录"
            >
              删除
            </button>
          </div>
        </article>

        {/* 就地改状态与评分：看完一条就能顺手归档、打分，不用先回列表 */}
        <div className="reader-actions" style={{ borderTop: 0, marginTop: 14 }}>
          <span className="reader-sec-label" style={{ marginBottom: 0 }}>
            状态
          </span>
          {STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={capture.status === status ? "reader-on" : ""}
              disabled={busy}
              aria-pressed={capture.status === status}
              onClick={() => void patchCapture(capture, { status })}
            >
              {STATUS_TEXT[status]}
            </button>
          ))}

          <span
            className="reader-sec-label"
            style={{ marginBottom: 0, marginLeft: 12 }}
          >
            评分
          </span>
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              className={capture.rating >= n ? "reader-on" : ""}
              disabled={busy}
              aria-label={`评 ${n} 星`}
              aria-pressed={capture.rating === n}
              title={capture.rating === n ? "再点一次取消评分" : `评 ${n} 星`}
              /* 点当前那一颗 = 取消评分，和便签墙的操作条一致 */
              onClick={() =>
                void patchCapture(capture, {
                  rating: capture.rating === n ? 0 : n,
                })
              }
            >
              {capture.rating >= n ? <b>★</b> : "☆"}
            </button>
          ))}
        </div>

        <div className="pager">
          <button type="button" onClick={() => router.push("/capture")}>
            回到便签墙
          </button>
          <span className="pager-num">{captureKindName(capture.kind)}</span>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete}
        title="撕掉这张便签"
        message={`确定删掉「${capture.title}」？删了就找不回来了。`}
        busy={deleting}
        onConfirm={destroy}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  );
}
