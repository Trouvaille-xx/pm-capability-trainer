/**
 * 提示词装配。
 *
 * 训练时的系统提示词 = 场景块 + 当前步骤块 + 模式块 + 通用约束。
 * 每个块都取自「设置 → 提示词管理」里的模板，用户可以逐块修改；
 * 某一块被停用时就不参与拼装。
 *
 * 另外负责两件事：
 * 1. 变量替换 —— 模板里的 {company_name}、{product_name} 等占位符，
 *    在请求前替换成本次训练的真实值。
 * 2. 步骤与评分表注入 —— 有分步流程的场景（产品拆解）会注入
 *    「现在第几步、该交付什么」，报告生成时注入该场景的评分表。
 */

import {
  DEFAULT_COMPANY_NAME,
  MODES,
  SCENARIOS,
  scenarioRubric,
  scenarioSteps,
} from "./catalog";
import { readCollection, readSettings } from "./store";
import { seedPrompts } from "./seed";
import type {
  PromptScope,
  TrainingMode,
  TrainingScenario,
  TrainingSession,
} from "./types";

/** 读出「作用域 → 系统提示词」的映射，内置模板打底、用户配置覆盖。 */
async function scopeMap(): Promise<Map<PromptScope, string>> {
  const map = new Map<PromptScope, string>();
  for (const template of seedPrompts()) map.set(template.scope, template.system);

  const stored = await readCollection("prompts");
  for (const template of stored) {
    if (template.enabled) map.set(template.scope, template.system);
    else map.delete(template.scope);
  }
  return map;
}

/**
 * 把模板里的 {name} 占位符替换成实际值。
 *
 * 只替换我们已知的变量名，所以模板里其它花括号（比如报告提示词里的
 * JSON 结构、文档模板里的 {步骤名}）会原样保留，不会被误伤。
 * 用 split/join 而不是正则，避免值里出现 $& 之类的特殊序列。
 */
function applyVariables(text: string, vars: Record<string, string>): string {
  let out = text;
  for (const [key, value] of Object.entries(vars)) {
    out = out.split(`{${key}}`).join(value);
  }
  return out;
}

/** 今天日期，形如 2026-02-14。 */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 组装本次训练的模板变量。 */
async function buildVars(
  session: TrainingSession,
): Promise<Record<string, string>> {
  const settings = await readSettings();
  const steps = scenarioSteps(session.scenario);
  const step = session.currentStep ?? (steps.length > 0 ? 1 : 0);

  return {
    company_name: settings.companyName?.trim() || DEFAULT_COMPANY_NAME,
    product_name: session.topic,
    product_type: session.productType?.trim() || "未指定",
    analysis_goal: session.analysisGoal?.trim() || "未指定",
    current_step: steps.length > 0 ? String(step) : "无分步流程",
    current_date: today(),
  };
}

/** 生成「当前步骤」注入块；没有分步流程的场景返回空串。 */
function stepBlock(session: TrainingSession): string {
  const steps = scenarioSteps(session.scenario);
  if (steps.length === 0) return "";

  const current = session.currentStep ?? 1;
  const meta = steps.find((s) => s.id === current) ?? steps[0];
  const next = steps.find((s) => s.id === meta.id + 1);

  const lines = [
    "【当前步骤指引】",
    `现在是第 ${meta.id} 步（共 ${steps.length} 步）：${meta.name}`,
    `这一步的交付物：${meta.deliverable}`,
    `可以去哪里获取：${meta.whereToGet}`,
    "请只引导这一步。用户交出本步交付物之前，不要进入下一步。",
  ];
  if (next) {
    lines.push(`用户交出交付物后，下一步是第 ${next.id} 步：${next.name}`);
  } else {
    lines.push("这已经是最后一步，用户交出交付物后即可汇总评分。");
  }
  return lines.join("\n");
}

const COMMON_RULES = `通用要求：
- 全程使用中文
- 每轮回答保持紧凑，一般不超过 250 字；需要展开时用短列表而不是长段落
- 不要替用户完成训练任务，你的职责是引导、质询或批改
- 如果用户明显在敷衍或答非所问，直接指出`;

/**
 * 拼出一次训练对话的系统提示词。
 *
 * 传整个 session 而不只是 scenario/mode，是因为模板里要用到
 * 题目、产品类型、拆解目标、当前步骤这些会话级变量。
 */
export async function trainingSystemPrompt(
  session: TrainingSession,
): Promise<string> {
  const map = await scopeMap();
  const scenarioMeta = SCENARIOS.find((s) => s.id === session.scenario);
  const modeMeta = MODES.find((m) => m.id === session.mode);
  const vars = await buildVars(session);

  const parts: string[] = [];

  parts.push(
    [
      "你正在主持一次「产品经理能力训练」。",
      `训练场景：${scenarioMeta?.name ?? session.scenario}`,
      `训练模式：${modeMeta?.name ?? session.mode}`,
      `本次题目：${session.topic}`,
    ].join("\n"),
  );

  const scenarioBlock = map.get(session.scenario);
  if (scenarioBlock) parts.push(applyVariables(scenarioBlock, vars));

  const step = stepBlock(session);
  if (step) parts.push(step);

  const modeBlock = map.get(session.mode);
  if (modeBlock) parts.push(applyVariables(modeBlock, vars));

  parts.push(COMMON_RULES);

  return parts.join("\n\n---\n\n");
}

/**
 * 取出报告生成用的系统提示词，并把该场景的评分表追加进去。
 *
 * 把评分表写进提示词，是为了让模型必须按既定维度打分，
 * 而不是每次自创一套维度，导致报告之间没法比较。
 */
export async function reportSystemPrompt(
  scenario: TrainingScenario,
): Promise<string> {
  const map = await scopeMap();
  const base =
    map.get("report") ??
    "你是一位严格且建设性的产品教练，请输出一个 JSON 格式的评估报告。";

  const rubric = scenarioRubric(scenario);
  if (rubric.length === 0) return base;

  const total = rubric.reduce((sum, item) => sum + item.max, 0);
  const table = rubric
    .map(
      (item, i) =>
        `${i + 1}. ${item.dimension}（满分 ${item.max}）：${item.criteria}`,
    )
    .join("\n");

  return [
    base,
    "",
    "本次必须严格使用下面这张评分表，不要增删维度、不要改维度名：",
    table,
    "",
    `总分满分 ${total} 分。等级判定：≥80% 优秀，≥60% 良好，≥40% 及格，其余需要重新拆解。`,
    "每个维度的 score 必须是 0 到该维度满分之间的数字（可以是小数，保留一位）。",
    "report 里的 overallMax 填 " +
      total +
      "，overall 填各维度 score 之和，grade 填等级名。",
  ].join("\n");
}

/**
 * 从模型的回答里解析出「第X步」，用于自动推进进度。
 *
 * 优先认【当前步骤】那一行的写法；认不到时退而求其次，
 * 取全文里出现过的最大步号（模型可能顺带提到后面的步骤）。
 */
export function parseStep(reply: string): number | null {
  const strict = reply.match(/【当前步骤】[^\n]*?第\s*(\d+)\s*步/);
  if (strict) return Number(strict[1]);

  const all = [...reply.matchAll(/第\s*(\d+)\s*步/g)].map((m) => Number(m[1]));
  if (all.length === 0) return null;
  return Math.max(...all);
}

/** 把一次训练的记录整理成给报告模型看的纯文本。 */
export function renderSessionForReport(session: TrainingSession): string {
  const scenarioMeta = SCENARIOS.find((s) => s.id === session.scenario);
  const modeMeta = MODES.find((m) => m.id === session.mode);
  const steps = scenarioSteps(session.scenario);

  const lines: string[] = [
    `训练场景：${scenarioMeta?.name ?? session.scenario}`,
    `训练模式：${modeMeta?.name ?? session.mode}`,
    `本次题目：${session.topic}`,
  ];

  if (session.productType) lines.push(`产品类型：${session.productType}`);
  if (session.analysisGoal) lines.push(`拆解目标：${session.analysisGoal}`);
  if (steps.length > 0) {
    lines.push(`进度：第 ${session.currentStep ?? 1} 步 / 共 ${steps.length} 步`);
  }
  lines.push("");

  if (session.mode === "solo") {
    lines.push("【学员独立完成的作答】", session.submission || "（未提交内容）");
  } else {
    lines.push("【训练对话记录】");
    if (session.transcript.length === 0) {
      lines.push("（没有对话记录）");
    }
    for (const entry of session.transcript) {
      lines.push(`${entry.role === "user" ? "学员" : "教练"}：${entry.content}`);
    }
  }

  return lines.join("\n");
}

/** 把会话压缩成模型上下文（限制轮数与长度，避免超长）。 */
export function toChatMessages(
  system: string,
  session: TrainingSession,
  maxTurns = 24,
): { role: "system" | "user" | "assistant"; content: string }[] {
  const recent = session.transcript.slice(-maxTurns);
  return [
    { role: "system", content: system },
    ...recent.map((entry) => ({
      role: entry.role,
      content: entry.content,
    })),
  ];
}
