"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ConfirmDialog } from "@/components/Modal";
import { SCENARIOS, scenarioName } from "@/lib/catalog";
import { apiGet, apiSend } from "@/lib/client";
import {
  FIELD_LABELS,
  applyField,
  classifyProposal,
  draftFromCard,
  emptyDraft,
  type AiField,
  type DraftForm,
  type DraftProposal,
  type PendingChange,
} from "@/lib/methodology-draft";
import { readTextStream, splitInterrupt } from "@/lib/stream";
import type {
  MethodologyCard,
  PublicAISettings,
  TrainingScenario,
} from "@/lib/types";

/**
 * 知识点的编辑器。
 *
 * 两栏：左边表单、右边 AI 面板。面板**按需滑出**（默认满宽表单），
 * 滑出时左栏被挤窄 —— 不是盖在上面。所以左栏要有 `min-width: 0`，
 * 否则 flex 子项不肯缩，面板会把整行撑破。
 *
 * 这里也是「先澄清、再补空字段」的实现处：AI 只提议，用户点保存才落库；
 * 已有内容要改，必须逐条确认。
 */

type Phase = "idle" | "thinking" | "writing";
type Turn = { role: "user" | "assistant"; content: string };

/** 值的展示形态：scenarios 是数组，显示成场景名。 */
function showValue(value: string | TrainingScenario[]): string {
  return Array.isArray(value) ? value.map(scenarioName).join("、") : value;
}

/**
 * 一个字段外壳：标签（可带「AI 补入」标记）+ 控件 + 待确认的改动提议。
 *
 * 【必须在组件外定义】定义在渲染函数里的话，每次渲染都是一个新的组件类型，
 * React 会把整棵子树卸载重建 —— 表现是每敲一个字输入框就失焦。
 */
function Field({
  label,
  aiFilled = false,
  change,
  onAccept,
  onReject,
  children,
}: {
  label: string;
  aiFilled?: boolean;
  change?: PendingChange;
  onAccept?: (change: PendingChange) => void;
  onReject?: (change: PendingChange) => void;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>
        {label}
        {aiFilled ? <span className="mth-ai-tag">AI 补入</span> : null}
      </label>
      {children}
      {change && onAccept && onReject ? (
        <div className="mth-proposal">
          <div className="mth-proposal-head">AI 想改成</div>
          <div className="mth-proposal-value">{showValue(change.value)}</div>
          {change.why ? (
            <div className="mth-proposal-why">{change.why}</div>
          ) : null}
          <div className="row" style={{ marginTop: 10 }}>
            <button
              type="button"
              className="board-bar-btn go"
              onClick={() => onAccept(change)}
            >
              采用
            </button>
            <button
              type="button"
              className="board-bar-btn"
              onClick={() => onReject(change)}
            >
              忽略
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function MethodologyComposer({
  mode,
  cardId,
}: {
  mode: "create" | "edit";
  cardId?: string;
}) {
  const router = useRouter();

  /* ---------------- 表单 ---------------- */
  const [form, setForm] = useState<DraftForm>(emptyDraft);
  const [initial, setInitial] = useState<DraftForm>(emptyDraft);
  const [domains, setDomains] = useState<string[]>([]);
  const [loading, setLoading] = useState(mode === "edit");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [confirmLeave, setConfirmLeave] = useState(false);

  /* ---------------- AI ---------------- */
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [streaming, setStreaming] = useState("");
  const [convoError, setConvoError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState("");
  const [pending, setPending] = useState<PendingChange[]>([]);
  const [aiFilled, setAiFilled] = useState<Set<AiField>>(new Set());
  const [fillNote, setFillNote] = useState("");

  /* 会话标识：只给网关当 x-opencode-session 用，不落库 */
  const draftId = useRef(`mthdraft_${Math.random().toString(36).slice(2, 10)}`);
  const abort = useRef<AbortController | null>(null);
  const alive = useRef(true);

  const busy = phase !== "idle";
  const aiUsable = aiReady !== false;
  const canAsk = form.title.trim() !== "" && aiUsable && !busy && !generating;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      abort.current?.abort();
    };
  }, []);

  /* 读配置：没配密钥就把 AI 入口拦掉（和训练页一个口径） */
  useEffect(() => {
    (async () => {
      try {
        const settings = await apiGet<PublicAISettings>("/api/settings");
        if (alive.current) setAiReady(settings.apiKeySet);
      } catch {
        // 读不到就当未知，不拦人
      }
    })();
  }, []);

  /* 读卡片列表：建模式攒领域建议，编辑模式还要把这张卡灌进表单 */
  useEffect(() => {
    (async () => {
      try {
        const list = await apiGet<MethodologyCard[]>("/api/methodology");
        if (!alive.current) return;
        setDomains(
          Array.from(new Set(list.map((c) => c.domain)))
            .filter(Boolean)
            .sort((a, b) => a.localeCompare(b, "zh")),
        );
        if (mode === "edit" && cardId) {
          const found = list.find((c) => c.id === cardId);
          if (!found) {
            setError("没有找到这个知识点，它可能已经被删除了。");
          } else {
            const draft = draftFromCard(found);
            setForm(draft);
            setInitial(draft);
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        if (alive.current) setLoading(false);
      }
    })();
  }, [mode, cardId]);

  const dirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initial),
    [form, initial],
  );

  /* 有未保存的改动时，关标签页给一句提醒 */
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  /** 改表单。手改优先：一动某个字段，针对它的待确认提议就作废。 */
  const patchForm = useCallback((patch: Partial<DraftForm>) => {
    setForm((prev) => ({ ...prev, ...patch }));
    const keys = Object.keys(patch) as AiField[];
    setPending((prev) => prev.filter((c) => !keys.includes(c.field)));
    setAiFilled((prev) => {
      if (!keys.some((k) => prev.has(k))) return prev;
      const next = new Set(prev);
      for (const k of keys) next.delete(k);
      return next;
    });
  }, []);

  /** 跑一轮澄清（首轮与后续追问走同一条路）。 */
  const runClarify = useCallback(
    async (history: Turn[]) => {
      setConvoError("");
      setStreaming("");
      setPhase("thinking");
      abort.current?.abort();
      const controller = new AbortController();
      abort.current = controller;

      try {
        const res = await fetch("/api/methodology/clarify", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            draftId: draftId.current,
            fields: form,
            turns: history,
          }),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const text = await res.text();
          let message = `请求失败（HTTP ${res.status}）`;
          try {
            message = (JSON.parse(text) as { error?: string }).error ?? message;
          } catch {
            // 保留默认
          }
          throw new Error(message);
        }

        const full = await readTextStream(res, {
          onPhase: (p) => {
            if (alive.current) setPhase(p as Phase);
          },
          onDelta: (t) => {
            if (alive.current) setStreaming(t);
          },
        });

        if (!alive.current) return;
        const { body, cut } = splitInterrupt(full);
        if (body.trim() !== "") {
          setTurns((prev) => [...prev, { role: "assistant", content: body }]);
        }
        setStreaming("");
        setPhase("idle");
        if (cut) setConvoError(`这一轮没说完：${cut}`);
      } catch (e) {
        if (!alive.current) return;
        setStreaming("");
        setPhase("idle");
        // 主动 abort 不算错（通常是又点了一次）
        if (e instanceof DOMException && e.name === "AbortError") return;
        setConvoError(e instanceof Error ? e.message : "澄清失败");
      }
    },
    [form],
  );

  /** 打开面板：让 AI 先开口问。 */
  function openPanel() {
    setPanelOpen(true);
    if (turns.length === 0 && !busy) void runClarify([]);
  }

  async function send() {
    const text = input.trim();
    if (text === "" || !canAsk) return;
    const next: Turn[] = [...turns, { role: "user", content: text }];
    setTurns(next);
    setInput("");
    await runClarify(next);
  }

  /** 生成：只补空字段；已填的要改会变成待确认。 */
  async function generate() {
    setGenerating(true);
    setGenError("");
    setFillNote("");
    try {
      const proposal = await apiSend<DraftProposal>(
        "/api/methodology/generate",
        "POST",
        { draftId: draftId.current, fields: form, turns },
      );
      const { fills, changes } = classifyProposal(form, proposal);
      const keys = Object.keys(fills) as AiField[];

      if (keys.length > 0) {
        setForm((prev) =>
          keys.reduce(
            (acc, k) => applyField(acc, k, fills[k] as string | TrainingScenario[]),
            prev,
          ),
        );
        setAiFilled(new Set(keys));
      }
      setPending(changes);

      const parts: string[] = [];
      if (keys.length > 0) parts.push(`AI 补了 ${keys.length} 个空字段`);
      if (changes.length > 0) {
        parts.push(`有 ${changes.length} 处想改动你已写的内容，逐条看看`);
      }
      setFillNote(parts.join(" · ") || "AI 这次没补出东西。");
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "补全失败");
    } finally {
      setGenerating(false);
    }
  }

  function acceptChange(change: PendingChange) {
    setForm((prev) => applyField(prev, change.field, change.value));
    setPending((prev) => prev.filter((c) => c !== change));
  }

  function rejectChange(change: PendingChange) {
    setPending((prev) => prev.filter((c) => c !== change));
  }

  const pendingFor = (key: AiField) => pending.find((c) => c.field === key);

  async function save() {
    setFormError("");
    if (form.title.trim() === "" || form.oneLiner.trim() === "") {
      setFormError("「知识点名称」和「一句话定义」都要填。");
      return;
    }
    setSaving(true);
    try {
      if (mode === "edit" && cardId) {
        await apiSend(`/api/methodology/${cardId}`, "PATCH", form);
        router.push(`/methodology/${cardId}`);
      } else {
        const created = await apiSend<MethodologyCard>(
          "/api/methodology",
          "POST",
          form,
        );
        router.push(`/methodology/${created.id}`);
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "保存失败");
      setSaving(false);
    }
  }

  function cancel() {
    if (dirty) {
      setConfirmLeave(true);
      return;
    }
    router.push("/methodology");
  }

  if (loading) {
    return (
      <div className="stack">
        <div className="loading">加载中…</div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>{mode === "edit" ? "改写知识点" : "新增知识点"}</h1>
        </div>
        <div className="page-actions">
          <button type="button" className="board-bar-btn" onClick={cancel}>
            取消
          </button>
          <button
            type="button"
            className="board-bar-btn go"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}
      {formError ? <div className="notice notice-error">{formError}</div> : null}
      {fillNote ? (
        <div className="notice notice-info">
          {fillNote}
          {pending.length > 0 ? (
            <>
              {" "}
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setForm((prev) =>
                    pending.reduce(
                      (acc, c) => applyField(acc, c.field, c.value),
                      prev,
                    ),
                  );
                  setPending([]);
                }}
              >
                全部采用
              </button>
              <button
                type="button"
                className="link-btn"
                onClick={() => setPending([])}
              >
                全部忽略
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      <div className={`mth-compose${panelOpen ? " has-panel" : ""}`}>
        {/* ---------------- 左：表单 ---------------- */}
        <div className="mth-form-col">
          <div className="grid grid-2">
            <Field label={FIELD_LABELS.domain}>
              <input
                className="form-input"
                list="mth-domain-options"
                value={form.domain}
                onChange={(e) => patchForm({ domain: e.target.value })}
              />
              <datalist id="mth-domain-options">
                {domains.map((domain) => (
                  <option key={domain} value={domain} />
                ))}
              </datalist>
            </Field>

            <Field
              label={FIELD_LABELS.scenarios}
              aiFilled={aiFilled.has("scenarios")}
              change={pendingFor("scenarios")}
              onAccept={acceptChange}
              onReject={rejectChange}
            >
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
                        patchForm({
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
            </Field>
          </div>

          <Field label={FIELD_LABELS.title}>
            <input
              className="form-input"
              value={form.title}
              onChange={(e) => patchForm({ title: e.target.value })}
              placeholder="例如：损失厌恶"
            />
          </Field>

          <Field
            label={FIELD_LABELS.oneLiner}
            aiFilled={aiFilled.has("oneLiner")}
            change={pendingFor("oneLiner")}
            onAccept={acceptChange}
            onReject={rejectChange}
          >
            <input
              className="form-input"
              value={form.oneLiner}
              onChange={(e) => patchForm({ oneLiner: e.target.value })}
              placeholder="能用一句话说清，才算真的理解"
            />
          </Field>

          <Field
            label={FIELD_LABELS.detail}
            aiFilled={aiFilled.has("detail")}
            change={pendingFor("detail")}
            onAccept={acceptChange}
            onReject={rejectChange}
          >
            <textarea
              className="form-textarea"
              value={form.detail}
              onChange={(e) => patchForm({ detail: e.target.value })}
              placeholder="原理：它为什么成立"
            />
          </Field>

          <Field
            label={FIELD_LABELS.boundary}
            aiFilled={aiFilled.has("boundary")}
            change={pendingFor("boundary")}
            onAccept={acceptChange}
            onReject={rejectChange}
          >
            <textarea
              className="form-textarea"
              value={form.boundary}
              onChange={(e) => patchForm({ boundary: e.target.value })}
              placeholder="什么条件下它不成立、或会明显减弱"
            />
          </Field>

          <Field
            label={FIELD_LABELS.pitfalls}
            aiFilled={aiFilled.has("pitfalls")}
            change={pendingFor("pitfalls")}
            onAccept={acceptChange}
            onReject={rejectChange}
          >
            <textarea
              className="form-textarea"
              value={form.pitfalls}
              onChange={(e) => patchForm({ pitfalls: e.target.value })}
              placeholder="最容易用错的地方，说清「错成什么样」"
            />
          </Field>

          <Field
            label={FIELD_LABELS.howToUse}
            aiFilled={aiFilled.has("howToUse")}
            change={pendingFor("howToUse")}
            onAccept={acceptChange}
            onReject={rejectChange}
          >
            <textarea
              className="form-textarea"
              value={form.howToUse}
              onChange={(e) => patchForm({ howToUse: e.target.value })}
              placeholder="在产品工作里怎么用，写成可执行的动作"
            />
          </Field>

          <Field
            label={FIELD_LABELS.example}
            aiFilled={aiFilled.has("example")}
            change={pendingFor("example")}
            onAccept={acceptChange}
            onReject={rejectChange}
          >
            <textarea
              className="form-textarea"
              value={form.example}
              onChange={(e) => patchForm({ example: e.target.value })}
              placeholder="一个具体场景"
            />
          </Field>

          <Field
            label={FIELD_LABELS.sourceNote}
            aiFilled={aiFilled.has("sourceNote")}
            change={pendingFor("sourceNote")}
            onAccept={acceptChange}
            onReject={rejectChange}
          >
            <input
              className="form-input"
              value={form.sourceNote}
              onChange={(e) => patchForm({ sourceNote: e.target.value })}
              placeholder="提出者 / 书名 / 论文，没把握就留空"
            />
          </Field>

          {!panelOpen ? (
            <div className="mth-ai-entry">
              <button
                type="button"
                className="board-bar-btn"
                onClick={openPanel}
                disabled={form.title.trim() === "" || aiReady === false}
                title={
                  form.title.trim() === ""
                    ? "先写个标题，AI 才知道该问什么"
                    : undefined
                }
              >
                和 AI 一起写
              </button>
              <span className="blk-hint">
                先写标题，再让它提问澄清，最后补空字段
              </span>
            </div>
          ) : null}
        </div>

        {/* ---------------- 右：AI 面板 ---------------- */}
        {panelOpen ? (
          <aside className="mth-ai-col">
            <div className="mth-ai-head">
              AI 助手
              <button
                type="button"
                className="link-btn"
                onClick={() => setPanelOpen(false)}
              >
                收起
              </button>
            </div>

            {aiReady === false ? (
              <div className="notice notice-info">
                还没有配置模型密钥，AI 不会开口。
                <Link href="/settings" style={{ textDecoration: "underline" }}>
                  去辅助系统填 AI 配置
                </Link>
              </div>
            ) : null}

            <div className="mth-chat">
              {turns.length === 0 && !busy ? (
                <p className="mth-chat-empty">
                  它会先就你写的内容提几个问题，问清楚了再补空字段 ——
                  免得补出来跟你想要的正好相反。
                </p>
              ) : null}

              {turns.map((turn, i) => (
                <div className={`mth-turn mth-turn-${turn.role}`} key={i}>
                  <div className="mth-turn-who">
                    {turn.role === "user" ? "你" : "AI"}
                  </div>
                  <div className="mth-turn-text">{turn.content}</div>
                </div>
              ))}

              {busy || streaming !== "" ? (
                <>
                  <div className="q-loading">
                    <span className="q-loading-marks" aria-hidden="true">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span className="q-loading-text">
                      {phase === "writing" ? "正在说" : "正在读你写的内容"}
                    </span>
                  </div>
                  {streaming !== "" ? (
                    <div className="mth-turn mth-turn-assistant">
                      <div className="mth-turn-who">AI</div>
                      <div className="mth-turn-text">{streaming}</div>
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>

            {convoError ? (
              <div className="notice notice-error">{convoError}</div>
            ) : null}
            {genError ? <div className="notice notice-error">{genError}</div> : null}

            <div className="mth-ask">
              <textarea
                className="form-textarea"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="回答它的问题……"
                rows={2}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void send();
                  }
                }}
              />
              <div className="row">
                <button
                  type="button"
                  className="board-bar-btn"
                  onClick={() => void send()}
                  disabled={!canAsk || input.trim() === ""}
                >
                  发送
                </button>
                <button
                  type="button"
                  className="board-bar-btn go"
                  onClick={() => void generate()}
                  disabled={!canAsk}
                >
                  {generating ? "正在补…" : "补全空字段"}
                </button>
              </div>
            </div>
          </aside>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmLeave}
        title="还没保存"
        message="刚填的内容还没保存，走了就没了。确定离开？"
        confirmText="离开"
        cancelText="继续编辑"
        onConfirm={() => {
          setConfirmLeave(false);
          router.push("/methodology");
        }}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}
