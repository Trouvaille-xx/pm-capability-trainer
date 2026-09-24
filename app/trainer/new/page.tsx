"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

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
  AISettings,
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

  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [aiReady, setAiReady] = useState<boolean | null>(null);

  // 概览页可以带 ?scenario=xxx 直接预选
  useEffect(() => {
    const preset = searchParams.get("scenario");
    if (preset && SCENARIOS.some((s) => s.id === preset)) {
      setScenario(preset as TrainingScenario);
    }
  }, [searchParams]);

  useEffect(() => {
    (async () => {
      try {
        const settings = await apiGet<AISettings>("/api/settings");
        setAiReady(settings.apiKey.trim() !== "");
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
