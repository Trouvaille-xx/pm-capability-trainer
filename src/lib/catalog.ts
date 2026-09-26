/**
 * 场景 / 模式 / 领域的静态目录。
 * 这里是"训练有哪些玩法"的唯一事实来源，前端选择器与后端提示词都读它。
 */

import type {
  CaptureKind,
  PromptScope,
  ScenarioRubricItem,
  ScenarioStep,
  TrainingMode,
  TrainingScenario,
} from "./types";

/** 提示词里 {company_name} 的默认取值。用户可在设置里改。 */
export const DEFAULT_COMPANY_NAME = "本公司";

/* ------------------------------------------------------------------ *
 * 产品拆解的 8 步流程
 *
 * 这套流程是训练师推进的骨架：每一步都有明确的交付物，
 * 用户交完这一步才允许进入下一步。提示词里的 {current_step}
 * 会告诉模型现在该引导哪一步。
 * ------------------------------------------------------------------ */

export const TEARDOWN_STEPS: ScenarioStep[] = [
  {
    id: 1,
    name: "确认拆解目标",
    deliverable: "《产品拆解目标确认卡》：一句话描述、拆解目标、目标用户",
    whereToGet: "产品官网、应用商店介绍页、你自己的使用动机",
  },
  {
    id: 2,
    name: "场景与用户画像",
    deliverable: "场景描述卡（时间 / 地点 / 状态 / 当前替代方案）",
    whereToGet: "用户访谈记录、行业报告里的用户画像数据",
  },
  {
    id: 3,
    name: "诊断匮乏感（仅 C 端）",
    deliverable: "匮乏感评分表 + 匹配的产品方向",
    whereToGet: "用户访谈记录、竞品评论区、知乎 / 小红书相关话题",
  },
  {
    id: 4,
    name: "五层架构拆解",
    deliverable: "五层架构分析表（用户层 / 应用层 / 模型层 / 数据层 / 算法算力层）",
    whereToGet: "亲自体验产品、竞品截图、官方文档",
  },
  {
    id: 5,
    name: "Agent 四要素",
    deliverable: "Agent 四要素卡片（目标 / 能力 / 知识 / 边界）",
    whereToGet: "产品官网、PRD、竞品分析报告",
  },
  {
    id: 6,
    name: "竞品分析与差异化",
    deliverable: "竞品功能矩阵（直接 / 间接 / 替代）+ 差异化定位一句话",
    whereToGet: "直接体验竞品、天眼查 / 企查查、行业报告",
  },
  {
    id: 7,
    name: "MoSCoW 划定 MVP",
    deliverable: "MVP 范围定义表（Must / Should / Could / Won't）",
    whereToGet: "用户反馈优先级、技术可行性评估、资源约束",
  },
  {
    id: 8,
    name: "Aha Moment",
    deliverable: "Aha Moment 描述卡",
    whereToGet: "用户测试反馈、原型验证",
  },
];

/* ------------------------------------------------------------------ *
 * 产品拆解的评分表：10 个维度，每项 5 分，总分 50
 * ------------------------------------------------------------------ */

export const TEARDOWN_RUBRIC: ScenarioRubricItem[] = [
  {
    dimension: "场景理解深度",
    max: 5,
    criteria: "用户画像是否清晰？场景是否具体？替代方案是否明确？",
  },
  {
    dimension: "匮乏感判断准确性",
    max: 5,
    criteria: "是否准确找到用户核心匮乏感？方向匹配是否合理？",
  },
  {
    dimension: "五层架构完整性",
    max: 5,
    criteria: "是否覆盖了所有必要的层次？是否有遗漏？",
  },
  {
    dimension: "Agent 四要素清晰度",
    max: 5,
    criteria: "目标是否量化？能力是否具体？边界是否明确？",
  },
  {
    dimension: "竞品分析深度",
    max: 5,
    criteria: "是否找到了三层竞品？四维对比是否有实质性差异？",
  },
  {
    dimension: "差异化定位独特性",
    max: 5,
    criteria: "定位是否独特？是否避免「抄功能」而是「找空位」？",
  },
  {
    dimension: "MVP 范围合理性",
    max: 5,
    criteria: "Must 有控制在合理范围内吗？有明确的不做列表吗？",
  },
  {
    dimension: "Aha Moment 吸引力",
    max: 5,
    criteria: "是否能让用户有「Wow」的瞬间？",
  },
  {
    dimension: "信息来源可靠性",
    max: 5,
    criteria: "是否引用了可信的信息来源？而不是主观臆测？",
  },
  {
    dimension: "拆解逻辑连贯性",
    max: 5,
    criteria: "从场景到 MVP 的推导是否顺畅？逻辑是否自洽？",
  },
];

/** 总分等级线（按满分比例换算，所以百分制场景也适用） */
export function gradeFor(overall: number, max: number): string {
  const ratio = max > 0 ? overall / max : 0;
  if (ratio >= 0.8) return "优秀";
  if (ratio >= 0.6) return "良好";
  if (ratio >= 0.4) return "及格";
  return "需要重新拆解";
}

export const SCENARIOS: {
  id: TrainingScenario;
  name: string;
  blurb: string;
  /** 训练时 AI 期望你产出的东西 */
  deliverable: string;
  /** 有固定推进顺序的场景在这里定义步骤 */
  steps?: ScenarioStep[];
  /** 该场景的评分表；没有则用默认百分制 */
  rubric?: ScenarioRubricItem[];
}[] = [
  {
    id: "product-teardown",
    name: "产品拆解",
    blurb: "拆一款产品的定位、结构、机制与商业化；竞品分析属于这一场景。",
    deliverable: "按 8 步流程走完，产出结构化的产品拆解文档",
    steps: TEARDOWN_STEPS,
    rubric: TEARDOWN_RUBRIC,
  },
  {
    id: "requirement-research",
    name: "需求调研",
    blurb: "把一句模糊诉求，拆成可验证的假设与调研方案。",
    deliverable: "需求假设清单 + 访谈/问卷提纲 + 验证方案 + 判定标准",
  },
  {
    id: "process-design",
    name: "流程设计",
    blurb: "设计端到端业务流程、角色分工、异常分支与衡量指标。",
    deliverable: "主流程 + 异常分支 + 角色职责 + 关键指标 + 落地风险",
  },
];

/** 取某个场景的步骤；没有分步流程时返回空数组。 */
export function scenarioSteps(id: TrainingScenario): ScenarioStep[] {
  return SCENARIOS.find((s) => s.id === id)?.steps ?? [];
}

/** 取某个场景的评分表；没有自定义评分表时返回空数组（用默认百分制）。 */
export function scenarioRubric(id: TrainingScenario): ScenarioRubricItem[] {
  return SCENARIOS.find((s) => s.id === id)?.rubric ?? [];
}

export const MODES: {
  id: TrainingMode;
  name: string;
  blurb: string;
  /** 是否需要 AI 在训练中实时参与 */
  live: boolean;
}[] = [
  {
    id: "assistant",
    name: "AI 助教引导",
    blurb: "AI 先给框架和示范，再带你一步步走完，随时可以提问。",
    live: true,
  },
  {
    id: "grill",
    name: "AI Grill",
    blurb: "AI 高强度质询你的方案，专挑漏洞、未验证假设和含糊表述。",
    live: true,
  },
  {
    id: "socratic",
    name: "苏格拉底追问",
    blurb: "AI 只提问、不给答案，用连续追问逼出你自己的结论。",
    live: true,
  },
  {
    id: "solo",
    name: "完全独立训练",
    blurb: "训练过程 0 AI 介入，你独立完成并提交，事后由 AI 批改出报告。",
    live: false,
  },
];

export const DOMAINS = [
  "心理学",
  "经济学",
  "商业与战略",
  "产品设计",
  "用户研究",
  "数据与分析",
  "项目管理",
  "增长与运营",
] as const;

/**
 * 历史数据里出现过的领域别名 → 规范名。
 *
 * 领域以前是纯自由字符串，所以老数据里可能是「数据分析」「增长运营」
 * 这类写法。收敛一下，筛选和分组才可靠。
 */
const DOMAIN_ALIASES: Record<string, (typeof DOMAINS)[number]> = {
  数据分析: "数据与分析",
  数据: "数据与分析",
  增长运营: "增长与运营",
  增长: "增长与运营",
  运营: "增长与运营",
  商业战略: "商业与战略",
  战略: "商业与战略",
  用户调研: "用户研究",
  调研: "用户研究",
  产品: "产品设计",
  心理学与行为: "心理学",
};

export function isKnownDomain(value: string): boolean {
  return (DOMAINS as readonly string[]).includes(value);
}

/**
 * 收敛单个领域名：已知的规范化、别名的映射过来、认不出的**原样保留**
 * （宁可留着一个陌生领域，也不要悄悄丢掉用户填的东西）。
 */
export function normalizeDomain(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "") return "";
  if (isKnownDomain(trimmed)) return trimmed;
  return DOMAIN_ALIASES[trimmed] ?? trimmed;
}

/** 批量收敛并去重。 */
export function normalizeDomains(values: string[]): string[] {
  return Array.from(
    new Set(values.map(normalizeDomain).filter((value) => value !== "")),
  );
}

export const CAPTURE_KINDS: { id: CaptureKind; name: string; blurb: string }[] = [
  { id: "book", name: "图书", blurb: "读完一本书记下的总结与思考" },
  { id: "article", name: "文章", blurb: "文章、报告、长文的结构化记录" },
  { id: "note", name: "笔记思考", blurb: "碎片想法、观察、复盘" },
];

export const PROMPT_SCOPES: { id: PromptScope; name: string; group: string }[] = [
  { id: "product-teardown", name: "产品拆解", group: "场景块" },
  { id: "requirement-research", name: "需求调研", group: "场景块" },
  { id: "process-design", name: "流程设计", group: "场景块" },
  { id: "assistant", name: "AI 助教引导", group: "模式块" },
  { id: "grill", name: "AI Grill", group: "模式块" },
  { id: "socratic", name: "苏格拉底追问", group: "模式块" },
  { id: "solo", name: "完全独立训练", group: "模式块" },
  { id: "report", name: "训练报告生成", group: "其它" },
  { id: "chat", name: "通用对话", group: "其它" },
];

export function scenarioName(id: TrainingScenario): string {
  return SCENARIOS.find((s) => s.id === id)?.name ?? id;
}

export function modeName(id: TrainingMode): string {
  return MODES.find((m) => m.id === id)?.name ?? id;
}

export function captureKindName(id: CaptureKind): string {
  return CAPTURE_KINDS.find((k) => k.id === id)?.name ?? id;
}

export function scopeName(id: PromptScope): string {
  return PROMPT_SCOPES.find((s) => s.id === id)?.name ?? id;
}
