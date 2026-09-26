"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { MODES, SCENARIOS } from "@/lib/catalog";
import { apiGet, apiSend } from "@/lib/client";
import type {
  AISettings,
  TrainingMode,
  TrainingScenario,
  TrainingSession,
} from "@/lib/types";

/**
 * 新建训练 —— 三步向导。
 *
 * 三步是训练里真实存在的三个决定：练什么、怎么陪练、练哪道题。
 * 所以步骤条摆在最上面，而且能点回去改：走错了不用一路重来。
 *
 * 呈现上用「一栏文字项」而不是三张等大等圆角的卡片：
 * 场景和模式加起来七个选项，铺成卡片网格就变成后台管理系统的形状。
 */

/** 产品拆解要区分的产品类型，会作为 {product_type} 注入提示词。 */
const PRODUCT_TYPES = ["C端", "B端", "AI功能", "完整产品"];

const STEPS = [
  { id: 1, name: "选择场景" },
  { id: 2, name: "选择模式" },
  { id: 3, name: "写下题目" },
];

const SAMPLE_TOPIC: Record<string, string> = {
  "product-teardown": "例如：拆解「小红书」的信息流推荐机制，并对比「抖音」的差异",
  "requirement-research":
    "例如：验证「企业客户愿意为批量导出付费」这一需求是否成立",
  "process-design": "例如：设计一个「新员工入职到首次产出」的端到端流程",
};

export default function NewTrainingPage() {
  return (
    <Suspense fallback={<div className="loading">加载中…</div>}>
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

  /* 概览页可以带 ?scenario=xxx 直接预选。 */
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
        setAiReady(true); // 拿不到配置就不拦人，训练时再报错
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
      /* 实时对话模式进去后立刻让训练师开场。 */
      const auto = MODES.find((m) => m.id === mode)?.live ? "?kickoff=1" : "";
      router.push(`/trainer/${session.id}${auto}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "创建训练失败");
      setCreating(false);
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>新建训练</h1>
          <p className="lede">
            三步：练什么、训练师怎么陪你、具体练哪道题。
          </p>
        </div>
        <div className="page-actions">
          <Link href="/trainer" className="vs-btn">
            回到全部训练
          </Link>
        </div>
      </div>

      {aiReady === false ? (
        <div className="notice notice-info">
          还没有配置模型密钥，训练师不会开口。
          <Link href="/settings" style={{ textDecoration: "underline", marginLeft: 4 }}>
            去辅助系统填 AI 配置
          </Link>
          （「完全独立训练」不需要 AI 参与对话，但仍需要 AI 批改出报告。）
        </div>
      ) : null}

      {error ? <div className="notice notice-error">{error}</div> : null}

      {/* 步骤条和下面的表单用同一条阅读栏，否则步骤条铺满、表单居中，两者会错位。 */}
      <div
        className="wizard-steps"
        style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}
      >
        {STEPS.map((s, index) => {
          const done = step > s.id;
          const active = step === s.id;
          return (
            <div key={s.id} style={{ display: "contents" }}>
              <button
                className={`wizard-step${active ? " active" : ""}${done ? " done" : ""}`}
                onClick={() => setStep(s.id)}
                /* 当前步是「导航状态」，不是强调。用墨底白字表达，
                   实心朱砂会被读成警告标签，而且和页面里真正的强调抢注意力。 */
                style={
                  active
                    ? { background: "var(--ink)", color: "#fff", boxShadow: "none" }
                    : undefined
                }
                /* 前进要按顺序走；回退永远允许。 */
                disabled={s.id > step}
              >
                <span
                  className="wizard-step-num"
                  style={
                    active
                      ? { background: "rgba(255,255,255,.22)", color: "#fff" }
                      : undefined
                  }
                >
                  {done ? "✓" : s.id}
                </span>
                {s.name}
              </button>
              {index < STEPS.length - 1 ? <div className="wizard-sep" /> : null}
            </div>
          );
        })}
      </div>

      {step > 1 ? (
        <div
          className="wizard-summary"
          style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}
        >
          <span className="wizard-summary-label">已选</span>
          <span style={{ fontSize: 13, color: "var(--ink)" }}>
            {selectedScenario?.name}
          </span>
          <span style={{ fontSize: 13, color: "var(--ink)" }}>
            {selectedMode?.name}
          </span>
          <button
            className="vs-btn"
            style={{ marginLeft: "auto" }}
            onClick={() => setStep(1)}
          >
            回去改
          </button>
        </div>
      ) : null}

      {/* ---- 第一步 ---- */}
      {step === 1 ? (
        <div className="form" style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}>
          {SCENARIOS.map((item) => {
            const on = scenario === item.id;
            const count = item.steps?.length ?? 0;
            return (
              <button
                key={item.id}
                className="form-row"
                onClick={() => setScenario(item.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  borderTop: 0,
                  borderRight: 0,
                  /* 选中态不用朱砂：朱砂是「你在这里」，一屏一次；
                     一行选项被选中是局部状态，用墨色竖线 + 底色 + 缩进表达就够了。 */
                  borderLeft: on ? "2px solid var(--ink)" : "2px solid transparent",
                  background: on ? "var(--paper-2)" : "none",
                  cursor: "pointer",
                  paddingLeft: on ? 14 : 0,
                  transition: "padding .2s var(--ease), background .2s var(--ease)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--serif)",
                      fontSize: 19,
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}
                  >
                    {item.name}
                  </span>
                  <span className="state-mark">
                    {count > 0 ? `${count} 步流程` : "自由对话"}
                  </span>
                </div>
                <p
                  style={{
                    fontSize: 13.5,
                    color: "var(--ink-2)",
                    lineHeight: 1.8,
                    marginTop: 5,
                  }}
                >
                  {item.blurb}
                </p>
                <p style={{ fontSize: 12.5, color: "var(--ink-3)", marginTop: 4 }}>
                  要交出的是：{item.deliverable}
                </p>
              </button>
            );
          })}

          <div className="wizard-nav">
            <button className="vs-btn on" onClick={() => setStep(2)}>
              下一步
            </button>
          </div>
        </div>
      ) : null}

      {/* ---- 第二步 ---- */}
      {step === 2 ? (
        <div className="form" style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}>
          {MODES.map((item) => {
            const on = mode === item.id;
            return (
              <button
                key={item.id}
                className="form-row"
                onClick={() => setMode(item.id)}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  borderTop: 0,
                  borderRight: 0,
                  /* 同第一步：选中靠墨色竖线，不用朱砂。 */
                  borderLeft: on ? "2px solid var(--ink)" : "2px solid transparent",
                  background: on ? "var(--paper-2)" : "none",
                  cursor: "pointer",
                  paddingLeft: on ? 14 : 0,
                  transition: "padding .2s var(--ease), background .2s var(--ease)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontFamily: "var(--serif)",
                      fontSize: 19,
                      fontWeight: 600,
                      color: "var(--ink)",
                    }}
                  >
                    {item.name}
                  </span>
                  {item.live ? null : <span className="state-mark">AI 不参与对话</span>}
                </div>
                <p
                  style={{
                    fontSize: 13.5,
                    color: "var(--ink-2)",
                    lineHeight: 1.8,
                    marginTop: 5,
                  }}
                >
                  {item.blurb}
                </p>
              </button>
            );
          })}

          <div className="wizard-nav">
            <button className="vs-btn" onClick={() => setStep(1)}>
              上一步
            </button>
            <div className="spacer" />
            <button className="vs-btn on" onClick={() => setStep(3)}>
              下一步
            </button>
          </div>
        </div>
      ) : null}

      {/* ---- 第三步 ---- */}
      {step === 3 ? (
        <div className="form" style={{ maxWidth: 720, margin: "0 auto", width: "100%" }}>
          <div className="field">
            <label>{isTeardown ? "拆解对象与目的" : "训练题目"}</label>
            <textarea
              className="textarea textarea-lg"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder={SAMPLE_TOPIC[scenario]}
              autoFocus
            />
            <div className="form-hint">
              题目写得越具体，训练师的追问越有落点。
            </div>
          </div>

          {/* 产品拆解的提示词里要用到产品类型和拆解目标，在这里收集。 */}
          {isTeardown ? (
            <>
              <div className="field">
                <label>产品类型</label>
                <div className="filters">
                  {PRODUCT_TYPES.map((type) => (
                    <button
                      key={type}
                      className={productType === type ? "on" : ""}
                      onClick={() => setProductType(type)}
                    >
                      {type}
                    </button>
                  ))}
                </div>
                <div className="form-hint">
                  产品类型会影响第 3 步「诊断匮乏感」是否启用。
                </div>
              </div>

              <div className="field">
                <label>这次为了什么拆</label>
                <input
                  className="input"
                  value={analysisGoal}
                  onChange={(e) => setAnalysisGoal(e.target.value)}
                  placeholder="例如：为我们的新功能找差异化空位"
                />
              </div>
            </>
          ) : null}

          {/* 分步场景先把流程摊开，让用户知道接下来会走哪几步。 */}
          {scenarioStepList.length > 0 ? (
            <div className="field">
              <label>这次会走完这 {scenarioStepList.length} 步</label>
              <ol
                style={{
                  margin: 0,
                  paddingLeft: 0,
                  listStyle: "none",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                }}
              >
                {scenarioStepList.map((s) => (
                  <li
                    key={s.id}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "baseline",
                      fontSize: 13.5,
                      lineHeight: 1.7,
                      color: "var(--ink-2)",
                    }}
                  >
                    <span
                      style={{
                        flex: "0 0 auto",
                        minWidth: 46,
                        color: "var(--ink-4)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    >
                      第 {s.id} 步
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
                        {s.name}
                      </strong>
                      <span style={{ color: "var(--ink-3)" }}>
                        {" "}
                        —— {s.deliverable}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          <div className="wizard-nav">
            <button className="vs-btn" onClick={() => setStep(2)}>
              上一步
            </button>
            <div className="spacer" />
            <button
              className="vs-btn on"
              onClick={start}
              disabled={creating || topic.trim() === ""}
              style={{
                opacity: creating || topic.trim() === "" ? 0.4 : 1,
                cursor: creating || topic.trim() === "" ? "not-allowed" : "pointer",
              }}
            >
              {creating ? "创建中…" : `开始「${selectedMode?.name}」`}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
