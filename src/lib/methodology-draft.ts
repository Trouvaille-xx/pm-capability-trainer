/**
 * 方法论卡片的草稿模型。
 *
 * 纯函数，不碰 store、不碰 node:fs —— 客户端和服务端共用同一套规则：
 * 客户端拿它把 AI 的产出分成「可以直接填」与「要先问你」，
 * 服务端拿同一套函数再过滤一遍（兜底：万一模型把非空字段塞进 filled，
 * 也不会被当成「覆盖提议」）。
 *
 * 为什么合并逻辑要放这里而不是散在组件里：它是这个功能唯一有判断的地方
 * （哪些能自动填、哪些必须问），值得单独被测。
 */

import { DOMAINS } from "./catalog";
import type { MethodologyCard, TrainingScenario } from "./types";

/** 表单持有的字段。id / builtin / 时间戳不在内；sourceCaptureIds 是关联不是文本，也不在。 */
export interface DraftForm {
  domain: string;
  title: string;
  oneLiner: string;
  detail: string;
  boundary: string;
  pitfalls: string;
  howToUse: string;
  example: string;
  scenarios: TrainingScenario[];
  sourceNote: string;
}

/**
 * AI 可补的字段。
 *
 * title 不在内 —— 整条流程以用户写的标题为锚点，让 AI 编一个标题，
 * 后面的澄清就失去意义了。domain 也不在：它有默认值，不算「空」。
 */
export const AI_FILLABLE = [
  "oneLiner",
  "detail",
  "boundary",
  "pitfalls",
  "howToUse",
  "example",
  "scenarios",
  "sourceNote",
] as const;

export type AiField = (typeof AI_FILLABLE)[number];

/** 字段的中文名。卡片快照与界面标签共用，只写一遍。 */
export const FIELD_LABELS: Record<keyof DraftForm, string> = {
  domain: "领域",
  title: "知识点名称",
  oneLiner: "一句话定义",
  detail: "展开说明",
  boundary: "边界",
  pitfalls: "常见误区",
  howToUse: "在产品工作里怎么用",
  example: "具体例子",
  scenarios: "适用训练场景",
  sourceNote: "来源",
};

/** 训练场景的白名单，与 /api/methodology 里的那三个一致。 */
export const ALL_SCENARIOS: TrainingScenario[] = [
  "product-teardown",
  "requirement-research",
  "process-design",
];

/**
 * 各字段的长度上限，跟 /api/methodology 的校验对齐。
 * 不对齐的后果是：AI 写长了当时不报错，点保存才失败 —— 那时用户已经改不动了。
 */
const STRING_CAPS: Record<Exclude<AiField, "scenarios">, number> = {
  oneLiner: 500,
  detail: 20000,
  boundary: 20000,
  pitfalls: 20000,
  howToUse: 20000,
  example: 20000,
  sourceNote: 300,
};

const MAX_SCENARIOS = 3;

export function emptyDraft(): DraftForm {
  return {
    domain: DOMAINS[0],
    title: "",
    oneLiner: "",
    detail: "",
    boundary: "",
    pitfalls: "",
    howToUse: "",
    example: "",
    scenarios: [],
    sourceNote: "",
  };
}

/** 从已有卡片灌进草稿（编辑模式）。只取表单管的字段。 */
export function draftFromCard(card: MethodologyCard): DraftForm {
  return {
    domain: card.domain,
    title: card.title,
    oneLiner: card.oneLiner,
    detail: card.detail,
    boundary: card.boundary,
    pitfalls: card.pitfalls,
    howToUse: card.howToUse,
    example: card.example,
    scenarios: card.scenarios,
    sourceNote: card.sourceNote,
  };
}

/** 一个字段算不算空。scenarios 按条数算，其余按去空白后的长度。 */
export function isBlank(value: string | TrainingScenario[]): boolean {
  if (Array.isArray(value)) return value.length === 0;
  return value.trim() === "";
}

/**
 * 把任意输入收敛成一个合法草稿。
 *
 * 服务端用它处理请求体：客户端传什么都得先过这一道，否则
 * 「字段长得不像字段」的输入会一路带到提示词里。
 */
export function coerceDraftForm(raw: unknown): DraftForm {
  const src = (raw ?? {}) as Record<string, unknown>;
  const str = (value: unknown, cap: number) =>
    typeof value === "string" ? value.slice(0, cap).trim() : "";

  const draft = emptyDraft();
  draft.domain = str(src.domain, 50) || DOMAINS[0];
  draft.title = str(src.title, 100);
  draft.oneLiner = str(src.oneLiner, 500);
  draft.detail = str(src.detail, 20000);
  draft.boundary = str(src.boundary, 20000);
  draft.pitfalls = str(src.pitfalls, 20000);
  draft.howToUse = str(src.howToUse, 20000);
  draft.example = str(src.example, 20000);
  draft.sourceNote = str(src.sourceNote, 300);
  draft.scenarios = Array.isArray(src.scenarios)
    ? src.scenarios
        .filter((s): s is TrainingScenario =>
          ALL_SCENARIOS.includes(s as TrainingScenario),
        )
        .slice(0, MAX_SCENARIOS)
    : [];
  return draft;
}

/**
 * 渲染成给模型看的卡片快照。
 * 没填的字段标成（空）—— 模型要靠这个知道哪些是它能补的。
 */
export function buildCardSnapshot(f: DraftForm): string {
  const lines = (Object.keys(FIELD_LABELS) as (keyof DraftForm)[]).map((key) => {
    const value = f[key];
    const shown = Array.isArray(value)
      ? value.join(", ")
      : value.trim();
    return `- ${FIELD_LABELS[key]}：${shown === "" ? "（空）" : shown}`;
  });
  return ["当前卡片：", ...lines].join("\n");
}

/** 一条「AI 想改动你已写内容」的提议。 */
export interface PendingChange {
  field: AiField;
  value: string | TrainingScenario[];
  /** AI 给的理由，展示在提议卡上 */
  why: string;
}

/** 模型产出的原始形状（已解析成对象）。 */
export interface DraftProposal {
  filled: Partial<Record<AiField, string | TrainingScenario[]>>;
  revisions: PendingChange[];
}

const FILLABLE_SET = new Set<string>(AI_FILLABLE);

function coerce(field: AiField, raw: unknown): string | TrainingScenario[] | null {
  if (field === "scenarios") {
    if (!Array.isArray(raw)) return null;
    const picked = raw
      .filter((x): x is string => typeof x === "string")
      .filter((x): x is TrainingScenario =>
        ALL_SCENARIOS.includes(x as TrainingScenario),
      )
      .slice(0, MAX_SCENARIOS);
    return picked;
  }
  if (typeof raw !== "string") return null;
  const capped = raw.slice(0, STRING_CAPS[field]).trim();
  return capped;
}

/**
 * 服务端过滤。两层限制：
 *   - `filled` 里只保留**提交时本来就为空**的字段（非空的直接丢，绝不提议覆盖）
 *   - `revisions` 里只保留**已知字段、且该字段原始非空、且值确实不同**的条目
 * 未知字段、类型不对的、空的，一律丢。
 */
export function normalizeDraft(raw: unknown, f: DraftForm): DraftProposal {
  const source = (raw ?? {}) as {
    filled?: unknown;
    revisions?: unknown;
  };

  const filled: DraftProposal["filled"] = {};
  if (source.filled && typeof source.filled === "object") {
    for (const [key, value] of Object.entries(source.filled)) {
      if (!FILLABLE_SET.has(key)) continue;
      const field = key as AiField;
      // 非空字段不接受填充 —— 这是「只补空的」的兜底
      if (!isBlank(f[field])) continue;
      const value2 = coerce(field, value);
      if (value2 === null || isBlank(value2)) continue;
      filled[field] = value2;
    }
  }

  const revisions: PendingChange[] = [];
  if (Array.isArray(source.revisions)) {
    for (const entry of source.revisions) {
      if (!entry || typeof entry !== "object") continue;
      const rec = entry as { field?: unknown; value?: unknown; why?: unknown };
      if (typeof rec.field !== "string" || !FILLABLE_SET.has(rec.field)) continue;
      const field = rec.field as AiField;
      // 只对「用户已经写了」的字段提修改建议
      if (isBlank(f[field])) continue;
      const value = coerce(field, rec.value);
      if (value === null || isBlank(value)) continue;
      // 值跟原文一样就没必要问
      if (sameValue(value, f[field])) continue;
      revisions.push({
        field,
        value,
        why: typeof rec.why === "string" ? rec.why.trim().slice(0, 300) : "",
      });
    }
  }

  return { filled, revisions };
}

function sameValue(
  a: string | TrainingScenario[],
  b: string | TrainingScenario[],
): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => x === b[i]);
  }
  if (typeof a === "string" && typeof b === "string") {
    return a.trim() === b.trim();
  }
  return false;
}

/**
 * 往草稿里写一个字段的值。
 *
 * 存在的理由：`field` 是联合类型，`value` 也是联合类型，
 * 直接 `form[field] = value` 过不了类型检查（TS 要求值同时满足所有候选字段）。
 * 这里按 field 收窄一次，调用方就不用各自做类型体操。
 */
export function applyField(
  form: DraftForm,
  field: AiField,
  value: string | TrainingScenario[],
): DraftForm {
  const next = { ...form };
  if (field === "scenarios") {
    next.scenarios = Array.isArray(value) ? value : [];
  } else {
    next[field] = typeof value === "string" ? value : "";
  }
  return next;
}

/**
 * 客户端分类：把一份（已过滤的）提议分成两堆。
 * 与服务端同规则，这里是给界面用的 —— 决定了哪些静默填入、哪些要弹确认。
 */
export function classifyProposal(
  f: DraftForm,
  proposal: DraftProposal,
): {
  fills: Partial<Record<AiField, string | TrainingScenario[]>>;
  changes: PendingChange[];
} {
  const fills: DraftProposal["filled"] = {};
  for (const [key, value] of Object.entries(proposal.filled)) {
    const field = key as AiField;
    if (!FILLABLE_SET.has(field)) continue;
    if (!isBlank(f[field])) continue; // 已经有内容 → 不碰
    fills[field] = value;
  }

  const changes = proposal.revisions.filter(
    (r) => !isBlank(f[r.field]) && !sameValue(r.value, f[r.field]),
  );

  return { fills, changes };
}
