"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { DOMAINS, SCENARIOS, scenarioName } from "@/lib/catalog";
import { apiGet, apiSend } from "@/lib/client";
import {
  IconArrowRight,
  IconEdit,
  IconPlus,
  IconSave,
  IconTrash,
} from "@/components/icons";
import { FolderTabs } from "@/components/FolderTabs";
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
          <h1>方法论 / 知识点</h1>
        </div>
        <div className="page-actions">
          <input
            className="input"
            placeholder="搜索知识点…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button className="btn btn-primary" onClick={startCreate}>
            <IconPlus width={15} height={15} />
            新增知识点
          </button>
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      <FolderTabs
        tabs={[
          { id: "all", label: "全部领域", count: cards.length },
          ...domainsPresent.map((domain) => ({
            id: domain,
            label: domain,
            count: cards.filter((c) => c.domain === domain).length,
          })),
        ]}
        active={domainFilter}
        onSelect={setDomainFilter}
      />

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
              className="input"
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
            <div className="row" style={{ gap: 6 }}>
              {SCENARIOS.map((scenario) => {
                const on = form.scenarios.includes(scenario.id);
                return (
                  <button
                    key={scenario.id}
                    type="button"
                    className={`tag${on ? " tag-brand" : ""}`}
                    style={{ cursor: "pointer" }}
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
            className="input"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder="例如：损失厌恶"
          />
        </div>

        <div className="field">
          <label>一句话定义</label>
          <input
            className="input"
            value={form.oneLiner}
            onChange={(e) => setForm({ ...form, oneLiner: e.target.value })}
            placeholder="能用一句话说清，才算真的理解"
          />
        </div>

        <div className="field">
          <label>展开说明</label>
          <textarea
            className="textarea"
            value={form.detail}
            onChange={(e) => setForm({ ...form, detail: e.target.value })}
            placeholder="原理、适用边界、常见误区"
          />
        </div>

        <div className="field">
          <label>在产品工作里怎么用</label>
          <textarea
            className="textarea"
            value={form.howToUse}
            onChange={(e) => setForm({ ...form, howToUse: e.target.value })}
          />
        </div>

        <div className="field">
          <label>具体例子</label>
          <textarea
            className="textarea"
            value={form.example}
            onChange={(e) => setForm({ ...form, example: e.target.value })}
          />
        </div>
      </Modal>

      <div className="folder-pane">
        {loading ? (
          <div className="loading">加载中…</div>
        ) : filtered.length === 0 ? (
          <div className="empty">没有匹配的知识点。</div>
        ) : (
          <div className="grid grid-2">
            {filtered.map((card) => (
              <div key={card.id} className="card card-tight">
                <div className="row" style={{ marginBottom: 6, gap: 6 }}>
                  <span className="tag tag-brand">{card.domain}</span>
                  {card.scenarios.map((s) => (
                    <span key={s} className="tag">
                      {scenarioName(s)}
                    </span>
                  ))}
                  {card.builtin ? <span className="tag">内置</span> : null}
                </div>

                <div className="list-title">{card.title}</div>
                <div className="list-sub">{card.oneLiner}</div>

                {/* 详情是「一个独立的东西」，所以给它一个独立页面：
                    有 URL、能新窗口打开、能后退、内容再长也不挤。
                    之前用侧边抽屉装详情，是层级设计上的偷懒。 */}
                <div className="card-actions">
                  <Link
                    href={`/methodology/${card.id}`}
                    className="btn btn-sm btn-ghost card-open"
                  >
                    查看详情
                    <IconArrowRight width={13} height={13} />
                  </Link>
                  <div className="spacer" />
                  <button
                    className="btn btn-sm"
                    onClick={() => startEdit(card)}
                    title="编辑"
                  >
                    <IconEdit width={13} height={13} />
                    编辑
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => setPendingDelete(card)}
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
        title="删除知识点"
        message={`确定删除「${pendingDelete?.title ?? ""}」？删除后无法恢复。内置知识点删掉后不会自动回来。`}
        busy={deleting}
        onConfirm={destroy}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
