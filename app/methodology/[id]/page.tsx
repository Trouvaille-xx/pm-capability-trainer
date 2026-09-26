"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/Modal";
import { scenarioName } from "@/lib/catalog";
import { apiGet, apiSend } from "@/lib/client";
import type { MethodologyCard } from "@/lib/types";

/**
 * 知识点详情页。
 *
 * 为什么是独立页面而不是弹窗/抽屉：这是一篇有结构的说明文，
 * 需要 URL（可分享、可刷新、可新窗口打开）、需要后退键、
 * 内容再长也不受容器高度限制。抽屉只是把长内容塞进一个窄条，是偷懒。
 */
export default function MethodologyDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [card, setCard] = useState<MethodologyCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await apiGet<MethodologyCard[]>("/api/methodology");
      const found = list.find((c) => c.id === id) ?? null;
      if (!found) {
        setError("没有找到这个知识点，它可能已经被删除了。");
      } else {
        setCard(found);
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
    if (!card) return;
    setDeleting(true);
    try {
      await apiSend(`/api/methodology/${card.id}`, "DELETE");
      router.push("/methodology");
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

  if (error || !card) {
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <h1>知识点</h1>
          </div>
        </div>
        <div className="empty-board">
          <h3>这张便签不在了</h3>
          <p>{error || "可能已经被删掉，或者链接里的编号不对。"}</p>
          <div className="hint-actions">
            <Link href="/methodology" className="go">
              回到便签墙
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>{card.title}</h1>
        </div>
        <div className="page-actions">
          <Link href={`/methodology?edit=${card.id}`} className="board-bar-btn">
            编辑
          </Link>
          <button
            type="button"
            className="board-bar-btn board-bar-btn-danger"
            onClick={() => setConfirming(true)}
          >
            删除
          </button>
        </div>
      </div>

      {/* 一条知识点的详情就是「把这张便签拿起来读」。
          所以用 .reader（单张纸），不用 .wall。 */}
      <div className="reader on">
        <div className="reader-card">
          <span className="note-pin" aria-hidden="true" />

          <div className="reader-domain">
            <span>{card.domain}</span>
            <span className="state-mark">{card.builtin ? "内置" : "自建"}</span>
          </div>

          {card.oneLiner ? (
            <p className="reader-def">{card.oneLiner}</p>
          ) : null}

          {card.detail ? (
            <div className="reader-sec">
              <span className="reader-sec-label">展开说明</span>
              <div className="reader-sec-body">{card.detail}</div>
            </div>
          ) : null}

          {card.howToUse ? (
            <div className="reader-sec">
              <span className="reader-sec-label">在产品工作里怎么用</span>
              <div className="reader-sec-body">{card.howToUse}</div>
            </div>
          ) : null}

          {card.example ? (
            <div className="reader-sec">
              <span className="reader-sec-label">具体例子</span>
              <div className="reader-example">{card.example}</div>
            </div>
          ) : null}

          {card.scenarios.length > 0 ? (
            <div className="reader-sec">
              <span className="reader-sec-label">适用训练场景</span>
              <div className="note-tags">
                {card.scenarios.map((s) => (
                  <span key={s}>{scenarioName(s)}</span>
                ))}
              </div>
            </div>
          ) : null}

          <div className="reader-actions">
            <Link href="/methodology" className="board-bar-btn">
              回到便签墙
            </Link>
            <Link
              href={`/methodology?edit=${card.id}`}
              className="board-bar-btn"
            >
              改写这一条
            </Link>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title="删除知识点"
        message={`确定删除「${card.title}」？删除后无法恢复。`}
        busy={deleting}
        onConfirm={destroy}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
