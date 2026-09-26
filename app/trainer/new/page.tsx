"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

import { MODES, SCENARIOS } from "@/lib/catalog";
import { apiGet, apiSend } from "@/lib/client";
import {
  IconArrowRight,
  IconBack,
  IconCheck,
  IconFlow,
  IconSearch,
  IconSpark,
  IconTarget,
  IconUser,
} from "@/components/icons";
import type {
  Capture,
  MethodologyCard,
  PublicAISettings,
  TrainingMode,
  TrainingScenario,
  TrainingSession,
} from "@/lib/types";

/** 场景 / 模式的图标，帮用户做选择。 */
const SCENARIO_ICONS = {
  "product-teardown": IconSearch,
  "requirement-research": IconUser,
  "process-design": IconFlow,
} as const;

const MODE_ICONS = {
  assistant: IconSpark,
  grill: IconTarget,
  socratic: IconSearch,
  solo: IconUser,
} as const;

/** 产品拆解要区分的产品类型，会作为 {product_type} 注入提示词。 */
const PRODUCT_TYPES = ["C端", "B端", "AI功能", "完整产品"];

const STEPS = [
  { id: 1, name: "选择场景", hint: "这次要练什么" },
  { id: 2, name: "选择模式", hint: "AI 怎么陪你练" },
  { id: 3, name: "写下题目", hint: "具体的训练对象" },
];

export default function NewTrainingPage() {
  return (
    <Suspense
      fallback={
        <div className="stack">
          <div className="loading">加载中…</div>
        </div>
      }
    >
      <NewTrainingInner />
    </Suspense>
  );
}

function NewTrainingInner() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [step, setStep] = useState(1);
  const [scenario, setScenario] = useState<TrainingScenario>("product-teardown");
  const [mode, setMode] = useState<TrainingMode>("assistant");
  const [topic, setTopic] = useState("");
  const [productType, setProductType] = useState("C端");
  const [analysisGoal, setAnalysisGoal] = useState("");

  /* 与「记录总结」「方法论」的联动 */
  const [capture, setCapture] = useState<Capture | null>(null);
  const [cards, setCards] = useState<MethodologyCard[]>([]);
  const [cardIds, setCardIds] = useState<string[]>([]);
  /** 用户手动改过卡片选择之后，就不再自动预选 */
  const [cardsTouched, setCardsTouched] = useState(false);
  const retryOf = searchParams.get("retryOf") ?? "";

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [aiReady, setAiReady] = useState<boolean | null>(null);

  // 概览页 / 报告页可以带 ?scenario= ?mode= ?topic= 直接预选
  useEffect(() => {
    const preset = searchParams.get("scenario");
    if (preset && SCENARIOS.some((s) => s.id === preset)) {
      setScenario(preset as TrainingScenario);
    }
    const presetMode = searchParams.get("mode");
    if (presetMode && MODES.some((m) => m.id === presetMode)) {
      setMode(presetMode as TrainingMode);
    }
    const presetTopic = searchParams.get("topic");
    if (presetTopic) setTopic(presetTopic.slice(0, 500));
  }, [searchParams]);

  /* ?capture=<id>：从一条记录总结直接开一次训练。
     题目用记录标题预填，并把这条记录作为本次训练的输入素材。 */
  useEffect(() => {
    const captureId = searchParams.get("capture");
    if (!captureId) return;
    let alive = true;
    (async () => {
      try {
        const found = await apiGet<Capture>(`/api/captures/${captureId}`);
        if (!alive) return;
        setCapture(found);
        setTopic((prev) => (prev === "" ? found.title.slice(0, 500) : prev));
      } catch {
        // 记录可能已被删除：静默忽略，用户仍然可以手写题目
      }
    })();
    return () => {
      alive = false;
    };
  }, [searchParams]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await apiGet<MethodologyCard[]>("/api/methodology");
        if (alive) setCards(list);
      } catch {
        // 方法论拉不到不影响训练，只是少了个推荐块
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  /* 当前场景适合用的卡片：scenarios 为空的卡片视为通用 */
  const suggestedCards = useMemo(() => {
    const matched = cards.filter(
      (card) => card.scenarios.length === 0 || card.scenarios.includes(scenario),
    );
    return matched.slice(0, 8);
  }, [cards, scenario]);

  /* 没手动选过就自动带上本场景推荐的卡片 */
  useEffect(() => {
    if (cardsTouched) return;
    setCardIds(suggestedCards.map((card) => card.id));
  }, [suggestedCards, cardsTouched]);

  useEffect(() => {
    (async () => {
      try {
        const settings = await apiGet<PublicAISettings>("/api/settings");
        setAiReady(settings.apiKeySet);
      } catch {
        setAiReady(true); // 拿不到配置就不拦人，交给训练时再报错
      }
    })();
  }, []);

  const selectedScenario = SCENARIOS.find((s) => s.id === scenario);
  const selectedMode = MODES.find((m) => m.id === mode);
  const scenarioStepList = selectedScenario?.steps ?? [];
  const isTeardown = scenario === "product-teardown";

  async function start() {
    if (topic.trim() === "") {
      setError("先写下这次要训练的题目");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const session = await apiSend<TrainingSession>("/api/sessions", "POST", {
        scenario,
        mode,
        topic,
        ...(isTeardown ? { productType, analysisGoal } : {}),
        ...(capture ? { captureId: capture.id } : {}),
        ...(cardIds.length > 0 ? { methodologyCardIds: cardIds } : {}),
        ...(retryOf !== "" ? { retryOf } : {}),
      });
      // 实时对话模式进去后立刻让 AI 开场
      const auto = MODES.find((m) => m.id === mode)?.live ? "?kickoff=1" : "";
      router.push(`/trainer/${session.id}${auto}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建训练失败");
      setCreating(false);
    }
  }

  return (
    <div className="stack">
      <div className="detail-head">
        <Link
          href="/trainer"
          className="btn btn-sm detail-back"
          title="返回训练列表"
        >
          <IconBack width={14} height={14} />
          返回
        </Link>
        <div className="detail-title-wrap">
          <h1 className="detail-title">新建训练</h1>
        </div>
      </div>

      {aiReady === false ? (
        <div className="notice notice-info">
          还没有配置模型密钥，训练无法调用 AI。
          <Link
            href="/settings"
            style={{ textDecoration: "underline", marginLeft: 4 }}
          >
            去设置 → AI 配置
          </Link>
          。（「完全独立训练」不需要 AI 参与对话，但仍需要 AI 生成报告。）
        </div>
      ) : null}

      {error ? <div className="notice notice-error">{error}</div> : null}

      {/* 步骤条：可以点回退，走错了不用重来 */}
      <div className="wizard-steps">
        {STEPS.map((s, index) => {
          const done = step > s.id;
          const active = step === s.id;
          return (
            <div key={s.id} style={{ display: "contents" }}>
              <button
                className={`wizard-step${active ? " active" : ""}${
                  done ? " done" : ""
                }`}
                onClick={() => setStep(s.id)}
                // 前进要按顺序走；回退永远允许
                disabled={s.id > step}
                title={s.hint}
              >
                <span className="wizard-step-num">
                  {done ? <IconCheck width={11} height={11} /> : s.id}
                </span>
                {s.name}
              </button>
              {index < STEPS.length - 1 ? <div className="wizard-sep" /> : null}
            </div>
          );
        })}
      </div>

      {/* 第 3 步时把前两步的选择显示出来，省得用户往回翻 */}
      {step === 3 ? (
        <div className="wizard-summary">
          <span className="wizard-summary-label">已选：</span>
          <span className="tag tag-brand">{selectedScenario?.name}</span>
          <span className="tag tag-brand">{selectedMode?.name}</span>
          <button
            className="btn btn-sm btn-ghost"
            style={{ marginLeft: "auto" }}
            onClick={() => setStep(1)}
          >
            改一改
          </button>
        </div>
      ) : null}

      <div className="folder-pane">
        {step === 1 ? (
          <>
            <div className="grid grid-3">
              {SCENARIOS.map((item) => {
                const Icon = SCENARIO_ICONS[item.id] ?? IconSearch;
                const on = scenario === item.id;
                return (
                  <button
                    key={item.id}
                    className={`option${on ? " selected" : ""}`}
                    onClick={() => setScenario(item.id)}
                  >
                    <span className="option-icon">
                      <Icon width={17} height={17} />
                    </span>
                    <div className="option-title">{item.name}</div>
                    <div className="option-blurb">{item.blurb}</div>
                  </button>
                );
              })}
            </div>
            <div className="wizard-nav">
              <div className="spacer" />
              <button className="btn btn-primary" onClick={() => setStep(2)}>
                下一步
                <IconArrowRight width={14} height={14} />
              </button>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <div className="grid grid-4">
              {MODES.map((item) => {
                const Icon = MODE_ICONS[item.id] ?? IconSpark;
                const on = mode === item.id;
                return (
                  <button
                    key={item.id}
                    className={`option${on ? " selected" : ""}`}
                    onClick={() => setMode(item.id)}
                  >
                    <span className="option-icon">
                      <Icon width={17} height={17} />
                    </span>
                    <div className="option-title">{item.name}</div>
                    <div className="option-blurb">{item.blurb}</div>
                  </button>
                );
              })}
            </div>
            <div className="wizard-nav">
              <button className="btn" onClick={() => setStep(1)}>
                <IconBack width={14} height={14} />
                上一步
              </button>
              <div className="spacer" />
              <button className="btn btn-primary" onClick={() => setStep(3)}>
                下一步
                <IconArrowRight width={14} height={14} />
              </button>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <div className="field">
              <label>训练题目</label>
              <textarea
                className="textarea textarea-lg"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder={
                  isTeardown
                    ? "例如：拆解「小红书」的信息流推荐机制，并对比「抖音」的差异"
                    : scenario === "requirement-research"
                      ? "例如：验证「企业客户愿意为批量导出付费」这一需求是否成立"
                      : "例如：设计一个「新员工入职到首次产出」的端到端流程"
                }
                autoFocus
              />
            </div>

            {/* 关联的记录总结：这次训练就基于它展开 */}
            {capture ? (
              <div className="field">
                <label>输入素材</label>
                <div className="card card-tight">
                  <div className="row" style={{ marginBottom: 4 }}>
                    <div className="list-title" style={{ flex: 1 }}>
                      {capture.title}
                    </div>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setCapture(null)}
                    >
                      取消关联
                    </button>
                  </div>
                  <div className="list-sub clamp-2">
                    {capture.summary || capture.thoughts || "（这条记录没有摘要）"}
                  </div>
                </div>
                <div className="hint">
                  训练时会把这条记录的总结、要点与你的思考一并交给 AI 作为依据。
                </div>
              </div>
            ) : null}

            {/* 方法论卡片：让卡片真的参与训练，而不是只躺在库里 */}
            {suggestedCards.length > 0 ? (
              <div className="field">
                <div className="row" style={{ marginBottom: 6 }}>
                  <label style={{ margin: 0, flex: 1 }}>
                    本次可用的方法论（已选 {cardIds.length}）
                  </label>
                  {cardsTouched ? (
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setCardsTouched(false)}
                    >
                      恢复推荐
                    </button>
                  ) : null}
                </div>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {suggestedCards.map((card) => {
                    const on = cardIds.includes(card.id);
                    return (
                      <button
                        key={card.id}
                        className={`tag${on ? " tag-brand" : ""}`}
                        style={{ cursor: "pointer" }}
                        title={card.oneLiner}
                        onClick={() => {
                          setCardsTouched(true);
                          setCardIds((prev) =>
                            prev.includes(card.id)
                              ? prev.filter((id) => id !== card.id)
                              : [...prev, card.id],
                          );
                        }}
                      >
                        {card.title}
                      </button>
                    );
                  })}
                </div>
                <div className="hint">
                  选中的卡片会作为「可用方法论」注入提示词，AI 的引导与质询会落到这些框架上。
                </div>
              </div>
            ) : null}

            {/* 产品拆解的提示词里要用到产品类型和拆解目标，在这里收集 */}
            {isTeardown ? (
              <>
                <div className="field">
                  <label>产品类型</label>
                  <div className="row" style={{ gap: 7, flexWrap: "wrap" }}>
                    {PRODUCT_TYPES.map((type) => (
                      <button
                        key={type}
                        className={`tag${
                          productType === type ? " tag-brand" : ""
                        }`}
                        style={{ cursor: "pointer" }}
                        onClick={() => setProductType(type)}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <label>拆解目标</label>
                  <input
                    className="input"
                    value={analysisGoal}
                    onChange={(e) => setAnalysisGoal(e.target.value)}
                    placeholder="你为了什么做这次拆解？例如：为我们的新功能找差异化空位"
                  />
                </div>
              </>
            ) : null}

            {/* 分步场景先把流程摊开，让用户知道接下来会走哪几步 */}
            {scenarioStepList.length > 0 ? (
              <div className="field">
                <label>训练流程（共 {scenarioStepList.length} 步）</label>
                <div className="step-preview">
                  {scenarioStepList.map((s) => (
                    <span key={s.id} className="step-preview-item">
                      <span className="step-preview-num">{s.id}</span>
                      {s.name}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="wizard-nav">
              <button className="btn" onClick={() => setStep(2)}>
                <IconBack width={14} height={14} />
                上一步
              </button>
              <div className="spacer" />
              <button
                className="btn btn-primary"
                onClick={start}
                disabled={creating || topic.trim() === ""}
              >
                <IconSpark width={14} height={14} />
                {creating ? "创建中…" : `开始「${selectedMode?.name}」训练`}
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
