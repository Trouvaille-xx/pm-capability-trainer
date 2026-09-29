"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/Modal";
import { DomainTags } from "@/components/DomainTags";
import { captureKindName, scenarioName } from "@/lib/catalog";
import { apiGet, apiSend } from "@/lib/client";
import type { Capture, MethodologyCard } from "@/lib/types";

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
  /** 同领域的其它词条：顺着一个概念逛下去用 */
  const [related, setRelated] = useState<MethodologyCard[]>([]);
  /** 这张卡引用的记录总结（用来把 sourceCaptureIds 显示成可点的标题） */
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [list, captureList] = await Promise.all([
        apiGet<MethodologyCard[]>("/api/methodology"),
        // 拉记录是为了把 sourceCaptureIds 显示成标题、并且能点进去
        apiGet<Capture[]>("/api/captures"),
      ]);
      setCaptures(captureList);
      const found = list.find((c) => c.id === id) ?? null;
      if (!found) {
        setError("没有找到这个知识点，它可能已经被删除了。");
      } else {
        setCard(found);
        /* 同领域的其它词条就是「相关方法」，顺手从这份列表里筛出来 ——
           不必再发一次请求。按标题排序，保证顺序稳定。
           上限 5 条：卡片涨到 60 张后，大领域（心理学）一张卡能带出 9 条，
           变成又一堵墙。这里要的是「顺路看两条」，不是把整个领域抄一遍。 */
        setRelated(
          list
            .filter((c) => c.domain === found.domain && c.id !== found.id)
            .sort((a, b) => a.title.localeCompare(b.title, "zh"))
            .slice(0, 5),
        );
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

  /* 这张卡引用到的记录总结。
     只显示「还存在」的记录 —— 来源被删掉后不该留一个死链接。 */
  const sourceCaptures = card
    ? card.sourceCaptureIds
        .map((cid) => captures.find((c) => c.id === cid))
        .filter((c): c is Capture => Boolean(c))
    : [];

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
            {/* 领域用统一的标签形态（朱砂竖线 + 编号 + 名称），
                和状态（[内置] / [自建]）区分开 */}
            <DomainTags domains={[card.domain]} />
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

          {/* 边界与常见误区：以前被写在 detail 的文字里
              （「…。边界：…。常见误区：…」），读起来是一坨连续段落。
              拆成独立小节后，「这个原理什么时候不成立」一眼就能找到。 */}
          {card.boundary ? (
            <div className="reader-sec">
              <span className="reader-sec-label">边界</span>
              <div className="reader-sec-body">{card.boundary}</div>
            </div>
          ) : null}

          {card.pitfalls ? (
            <div className="reader-sec">
              <span className="reader-sec-label">常见误区</span>
              <div className="reader-sec-body">{card.pitfalls}</div>
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

          {/* ---- 来源：可追溯到具体哪条记录 / 哪本书 ---- */}
          {card.sourceNote || sourceCaptures.length > 0 ? (
            <div className="reader-sec">
              <span className="reader-sec-label">来源</span>
              {card.sourceNote ? (
                <div className="reader-sec-body">{card.sourceNote}</div>
              ) : null}
              {sourceCaptures.length > 0 ? (
                <ul className="source-list">
                  {sourceCaptures.map((c) => (
                    <li key={c.id}>
                      <Link href={`/capture/${c.id}`}>{c.title}</Link>
                      <span className="source-kind">
                        {captureKindName(c.kind)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {/* ---- 相关方法：同领域的其它词条，可点进去 ---- */}
          {related.length > 0 ? (
            <div className="reader-sec">
              <span className="reader-sec-label">
                相关方法
                <span className="blk-hint">同属「{card.domain}」</span>
              </span>
              <ul className="related-list">
                {related.map((c) => (
                  <li key={c.id}>
                    <Link href={`/methodology/${c.id}`}>
                      <span className="related-title">{c.title}</span>
                      <span className="related-def">{c.oneLiner}</span>
                    </Link>
                  </li>
                ))}
              </ul>
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
