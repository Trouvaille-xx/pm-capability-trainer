"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { DOMAINS, SCENARIOS, scenarioName } from "@/lib/catalog";
import { apiGet, apiSend } from "@/lib/client";
import { assignTilts, plainSummary, tiltStyle } from "@/lib/board";
import { IconPlus, IconSave } from "@/components/icons";
import { ConfirmDialog, Modal } from "@/components/Modal";
import type { MethodologyCard, TrainingScenario } from "@/lib/types";

interface FormState {
  domain: string;
  title: string;
  oneLiner: string;
  detail: string;
  howToUse: string;
  example: string;
  scenarios: TrainingScenario[];
}

const EMPTY_FORM: FormState = {
  domain: DOMAINS[0],
  title: "",
  oneLiner: "",
  detail: "",
  howToUse: "",
  example: "",
  scenarios: [],
};

/**
 * 页面外壳。
 *
 * useSearchParams() 在静态预渲染时必须包在 Suspense 里，
 * 否则 `next build` 会直接失败（Missing Suspense with CSR bailout）。
 */
export default function MethodologyPage() {
  return (
    <Suspense
      fallback={
        <div className="stack">
          <div className="loading">加载中…</div>
        </div>
      }
    >
      <MethodologyPageInner />
    </Suspense>
  );
}

function MethodologyPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [cards, setCards] = useState<MethodologyCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [domainFilter, setDomainFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [pendingDelete, setPendingDelete] = useState<MethodologyCard | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

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

  function startCreate() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
    setShowForm(true);
  }

  function startEdit(card: MethodologyCard) {
    setEditingId(card.id);
    setForm({
      domain: card.domain,
      title: card.title,
      oneLiner: card.oneLiner,
      detail: card.detail,
      howToUse: card.howToUse,
      example: card.example,
      scenarios: card.scenarios,
    });
    setFormError("");
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError("");
    // 从详情页带 ?edit=xxx 进来时，关掉弹窗要把参数清掉，
    // 否则刷新会又弹一次。
    if (searchParams.get("edit")) router.replace("/methodology");
  }

  // 支持从详情页「编辑」跳过来：/methodology?edit=<id> 直接打开编辑弹窗
  const editParam = searchParams.get("edit");
  useEffect(() => {
    if (!editParam || cards.length === 0) return;
    const target = cards.find((c) => c.id === editParam);
    if (target) startEdit(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editParam, cards]);

  async function save() {
    if (form.title.trim() === "" || form.oneLiner.trim() === "") {
      setFormError("「知识点名称」和「一句话定义」都要填");
      return;
    }
    setSaving(true);
    setFormError("");
    try {
      if (editingId) {
        await apiSend<MethodologyCard>(
          `/api/methodology/${editingId}`,
          "PATCH",
          form,
        );
      } else {
        await apiSend<MethodologyCard>("/api/methodology", "POST", form);
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
          <button className="btn btn-primary" onClick={startCreate}>
            <IconPlus width={15} height={15} />
            新增知识点
          </button>
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

      <Modal
        open={showForm}
        title={editingId ? "编辑知识点" : "新增知识点"}
        subtitle={
          editingId
            ? "改完保存即可生效，已有的训练会话不受影响。"
            : "一句话定义尽量用你自己的话，别抄书上的原句。"
        }
        onClose={closeForm}
        width={680}
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

        <div className="grid grid-2">
          <div className="field">
            <label>领域</label>
            <input
              className="form-input"
              list="domain-options"
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
            />
            <datalist id="domain-options">
              {domainsPresent.map((domain) => (
                <option key={domain} value={domain} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label>适用训练场景</label>
            <div className="form-choice">
              {SCENARIOS.map((scenario) => {
                const on = form.scenarios.includes(scenario.id);
                return (
                  <button
                    key={scenario.id}
                    type="button"
                    className="form-choice-chip"
                    data-on={on ? "true" : "false"}
                    onClick={() =>
                      setForm({
                        ...form,
                        scenarios: on
                          ? form.scenarios.filter((s) => s !== scenario.id)
                          : [...form.scenarios, scenario.id],
                      })
                    }
                  >
                    {scenario.name}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="field">
          <label>知识点名称</label>
          <input
            className="form-input"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="例如：损失厌恶"
          />
        </div>

        <div className="field">
          <label>一句话定义</label>
          <input
            className="form-input"
            value={form.oneLiner}
            onChange={(e) => setForm({ ...form, oneLiner: e.target.value })}
            placeholder="能用一句话说清，才算真的理解"
          />
        </div>

        <div className="field">
          <label>展开说明</label>
          <textarea
            className="form-textarea"
            value={form.detail}
            onChange={(e) => setForm({ ...form, detail: e.target.value })}
            placeholder="原理、适用边界、常见误区"
          />
        </div>

        <div className="field">
          <label>在产品工作里怎么用</label>
          <textarea
            className="form-textarea"
            value={form.howToUse}
            onChange={(e) => setForm({ ...form, howToUse: e.target.value })}
          />
        </div>

        <div className="field">
          <label>具体例子</label>
          <textarea
            className="form-textarea"
            value={form.example}
            onChange={(e) => setForm({ ...form, example: e.target.value })}
          />
        </div>
      </Modal>

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
                  <span>{card.domain}</span>
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
                    <span
                      role="button"
                      tabIndex={-1}
                      className="note-op"
                      onClick={(e) => {
                        e.stopPropagation();
                        startEdit(card);
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
