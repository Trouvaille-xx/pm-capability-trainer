"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  IconBack,
  IconEdit,
  IconList,
  IconSpark,
  IconTag,
  IconTarget,
} from "@/components/icons";
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
          <div className="page-actions">
            <Link href="/methodology" className="btn">
              <IconBack width={14} height={14} />
              返回列表
            </Link>
          </div>
        </div>
        <div className="folder-pane">
          <div className="empty">{error || "没有找到这个知识点。"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="detail-head">
        <Link
          href="/methodology"
          className="btn btn-sm detail-back"
          title="返回知识点列表"
        >
          <IconBack width={14} height={14} />
          返回
        </Link>

        <div className="detail-title-wrap">
          <h1 className="detail-title">{card.title}</h1>
          <div className="detail-meta">
            <span className="detail-meta-item">
              <IconTag width={13} height={13} />
              {card.domain}
            </span>
            {card.scenarios.length > 0 ? (
              <span className="detail-meta-item">
                <IconTarget width={13} height={13} />
                {card.scenarios.map(scenarioName).join(" / ")}
              </span>
            ) : null}
            {card.builtin ? (
              <span className="detail-meta-item">内置知识点</span>
            ) : null}
          </div>
        </div>

        <div className="detail-actions">
          <Link
            href={`/methodology?edit=${card.id}`}
            className="btn btn-sm"
            title="编辑这个知识点"
          >
            <IconEdit width={13} height={13} />
            编辑
          </Link>
          <button
            className="btn btn-sm btn-danger"
            onClick={() => setConfirming(true)}
            title="删除这个知识点"
          >
            删除
          </button>
        </div>
      </div>

      <div className="folder-pane">
        <div className="detail-body">
          <div className="notice notice-info">{card.oneLiner}</div>

          {card.detail ? (
            <section>
              <div className="detail-section-head">
                <IconList width={15} height={15} />
                <h2>展开说明</h2>
              </div>
              <p>{card.detail}</p>
            </section>
          ) : null}

          {card.howToUse ? (
            <section>
              <div className="detail-section-head">
                <IconSpark width={15} height={15} />
                <h2>在产品工作里怎么用</h2>
              </div>
              <p>{card.howToUse}</p>
            </section>
          ) : null}

          {card.example ? (
            <section>
              <div className="detail-section-head">
                <IconList width={15} height={15} />
                <h2>具体例子</h2>
              </div>
              <div className="notice">{card.example}</div>
            </section>
          ) : null}
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
