"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DOMAINS, scenarioName } from "@/lib/catalog";
import { apiGet, apiSend } from "@/lib/client";
import { assignTilts, plainSummary, tiltStyle } from "@/lib/board";
import { IconPlus } from "@/components/icons";
import { ConfirmDialog } from "@/components/Modal";
import { DomainTags } from "@/components/DomainTags";
import type { MethodologyCard } from "@/lib/types";

/**
 * 方法论 —— 便签墙。
 *
 * 新建与编辑都搬到了独立页面（/methodology/new、/methodology/[id]/edit）：
 * 表单旁边要放一个 AI 对话面板，弹窗里塞不下多轮问答。
 */
export default function MethodologyPage() {
  const router = useRouter();

  const [cards, setCards] = useState<MethodologyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [domainFilter, setDomainFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<MethodologyCard | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    try {
      setCards(await apiGet<MethodologyCard[]>("/api/methodology"));
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

  const domainsPresent = useMemo(() => {
    const set = new Set<string>(DOMAINS);
    for (const card of cards) set.add(card.domain);
    return Array.from(set);
  }, [cards]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return cards.filter((card) => {
      if (domainFilter !== "all" && card.domain !== domainFilter) return false;
      if (q === "") return true;
      return [card.title, card.oneLiner, card.detail, card.howToUse, card.example]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [cards, domainFilter, query]);

  /* 便签角度按 id 定：每个条目都不撞，且每次打开都一样（便于位置记忆）。
     注意要按全部卡片算，不能按 filtered 算 —— 否则一筛选角度就全变了。 */
  const TILTS = useMemo(() => assignTilts(cards), [cards]);

  /* 点便签 = 直接进详情页。
     不再「点一下先在下面长出一条菜单」—— 多一次点击换来的选项，
     其实悬停在卡片上就已经给了，那一步是多余的。 */
  function openCard(card: MethodologyCard) {
    router.push(`/methodology/${card.id}`);
  }

  async function destroy() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await apiSend(`/api/methodology/${pendingDelete.id}`, "DELETE");
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
          <h1>方法论</h1>
          <p className="lede">
            跨领域的知识点，一张卡一个概念。定义要能用一句话说清，说不清就是还没懂。
          </p>
        </div>
        <div className="page-actions">
          <Link href="/methodology/new" className="btn btn-primary">
            <IconPlus width={15} height={15} />
            新增知识点
          </Link>
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      {/* 检索 + 领域筛选。接口没有查询参数，过滤全在前端。 */}
      <div className="controls">
        <label className="lookup">
          <input
            placeholder="搜索知识点…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="搜索知识点"
          />
          <span className="lookup-hint">
            {filtered.length === cards.length
              ? `${cards.length} 张中检索`
              : `显示 ${filtered.length} / ${cards.length}`}
          </span>
        </label>

        <div className="filters">
          <button
            className={domainFilter === "all" ? "on" : ""}
            onClick={() => setDomainFilter("all")}
          >
            全部 {cards.length}
          </button>
          {domainsPresent.map((domain) => (
            <button
              key={domain}
              className={domainFilter === domain ? "on" : ""}
              onClick={() => setDomainFilter(domain)}
            >
              {domain}{" "}
              {cards.filter((c) => c.domain === domain).length}
            </button>
          ))}
        </div>
      </div>

      {/* 便签直接摊在板面上，不套任何面板。
          之前这里有个 .folder-pane（白底 + 描边 + 圆角），是旧版档案标签
          的残留 —— 它把便签压在一块白板上，纸和板的关系就没了。 */}
      <div>
        {loading ? (
          <div className="loading">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="empty-board">
            <h3>{cards.length === 0 ? "还没有知识点" : "没有匹配的知识点"}</h3>
            <p>
              {cards.length === 0
                ? "读书、看文章时遇到的概念，随手记成一张卡。攒到十几张，训练时就有东西可引了。"
                : "换个关键词，或者把领域筛选切回全部。"}
            </p>
          </div>
        ) : (
          <div className="wall">
            {filtered.map((card) => (
              <article
                key={card.id}
                className="note"
                style={tiltStyle(TILTS[card.id] ?? 0)}
                onClick={() => openCard(card)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openCard(card);
                  }
                }}
                tabIndex={0}
                role="button"
                aria-label={`查看「${card.title}」`}
              >
                <span className="note-pin" aria-hidden="true" />

                <div className="note-domain">
                  {/* 领域用统一的标签形态，和状态（[内置]/[自建]）分开 ——
                      以前两个都是裸文字，看不出哪个是领域 */}
                  <DomainTags domains={[card.domain]} />
                  <span className="state-mark">
                    {card.builtin ? "内置" : "自建"}
                  </span>
                </div>

                <h2 className="note-title">{card.title}</h2>
                {/* 便签正文是纯文本节点，不渲染 markdown ——
                    标记会原样露出来（训练师便签上出现过字面 `**`）。
                    这里是同一类隐患，取摘要时一并剥掉。 */}
                <p className="note-def">{plainSummary(card.oneLiner, 180)}</p>
                {card.detail ? (
                  <p className="note-detail">{plainSummary(card.detail, 300)}</p>
                ) : null}

                {card.scenarios.length > 0 ? (
                  <div className="note-tags">
                    {card.scenarios.map((s) => (
                      <span key={s}>{scenarioName(s)}</span>
                    ))}
                  </div>
                ) : null}

                {/* 三个动作挂在页脚这一行的右侧，不单独占一行 ——
                    单独一行会让每张纸都长高 36px，整面墙跟着变稀。
                    用绝对定位贴在页脚右端：文字「有用法」在左，动作在右，
                    互不挤压；不悬停时整块透明且不接事件。 */}
                <div className="note-foot">
                  <span>{card.howToUse ? "有用法" : "只有定义"}</span>

                  <span className="note-ops">
                    <Link
                      href={`/methodology/${card.id}`}
                      className="note-op"
                      onClick={(e) => e.stopPropagation()}
                      tabIndex={-1}
                    >
                      打开
                    </Link>
                    <Link
                      href={`/methodology/${card.id}/edit`}
                      className="note-op"
                      onClick={(e) => e.stopPropagation()}
                      tabIndex={-1}
                    >
                      编辑
                    </Link>
                    <span
                      role="button"
                      tabIndex={-1}
                      className="note-op note-op-danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete(card);
                      }}
                    >
                      删除
                    </span>
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title="删除知识点"
        message={`确定删除「${pendingDelete?.title ?? ""}」？删除后无法恢复。内置知识点删掉后不会自动回来。`}
        busy={deleting}
        onConfirm={destroy}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
