/**
 * 方法论的两个 AI 能力：先澄清、再补全。
 *
 * 拆成两次调用而不是一次：它们要做的事正好相反 ——
 * 一次只提问不生成，一次只补空字段不提问。合成一次的话，
 * 「这一轮该不该输出卡片内容」就得靠上下文猜，模型很容易在第一轮就把
 * 答案写出来，那澄清就白做了。
 *
 * 两次都**不写库**：只把结果交回给界面，用户确认后自己保存。
 */

import { chatOnce, chatStream, parseJsonLoose, type ChatMessage } from "./ai";
import {
  FIELD_LABELS,
  buildCardSnapshot,
  isBlank,
  normalizeDraft,
  type AiField,
  type DraftForm,
  type DraftProposal,
} from "./methodology-draft";
import { requirePrompt } from "./prompts";

/** 澄清对话的一轮。历史由客户端持有、每轮全量上传。 */
export type ConvoTurn = { role: "user" | "assistant"; content: string };

/**
 * 历史裁剪。
 *
 * 不能因为「历史是客户端传来的」就直接信它：上传是可以被伪造的，
 * 而且真跑起来也会越来越长。轮数与总字符都要卡住。
 */
const MAX_TURNS = 12;
const MAX_CHARS = 12000;

function trimHistory(turns: ConvoTurn[]): ConvoTurn[] {
  const kept = (Array.isArray(turns) ? turns : [])
    .filter(
      (t): t is ConvoTurn =>
        !!t &&
        (t.role === "user" || t.role === "assistant") &&
        typeof t.content === "string" &&
        t.content.trim() !== "",
    )
    .slice(-MAX_TURNS);

  let total = kept.reduce((n, t) => n + t.content.length, 0);
  while (kept.length > 0 && total > MAX_CHARS) {
    total -= kept[0].content.length;
    kept.shift();
  }
  return kept;
}

/** 还没填、且允许 AI 补的字段（title 与 domain 永远不在内）。 */
function blankFields(f: DraftForm): AiField[] {
  return (Object.keys(FIELD_LABELS) as (keyof DraftForm)[])
    .filter((k): k is AiField => k !== "title" && k !== "domain")
    .filter((k) => isBlank(f[k]));
}

/**
 * 澄清那一轮：流式，只提问。
 *
 * 首轮历史为空，所以补一条 user 消息把卡片快照和「该你提问了」一起交待清楚 ——
 * 否则模型对着一个空对话，很可能直接开始写卡片。
 */
export async function* streamClarify(input: {
  fields: DraftForm;
  turns: ConvoTurn[];
  draftId: string;
}): AsyncGenerator<string, void, unknown> {
  const system = await requirePrompt("methodology-clarify");
  const history = trimHistory(input.turns);

  const messages: ChatMessage[] = [{ role: "system", content: system }];
  for (const turn of history) {
    messages.push({ role: turn.role, content: turn.content });
  }

  if (history.length === 0) {
    const blanks = blankFields(input.fields).map((k) => FIELD_LABELS[k]);
    messages.push({
      role: "user",
      content:
        `${buildCardSnapshot(input.fields)}\n\n` +
        `（还没填的字段：${blanks.length > 0 ? blanks.join("、") : "无"}）\n\n` +
        "这是第一轮。请先提问，不要生成任何卡片内容。",
    });
  }

  yield* chatStream(messages, {
    temperature: 0.5,
    sessionId: `mth-clarify-${input.draftId}`,
  });
}

/**
 * 补全那一轮：非流式，输出结构化 JSON。
 *
 * 用户消息里显式列出「只补这几个空字段」——光靠提示词说「只补空的」，
 * 模型仍可能顺手把已填的也重写一遍；把清单摆出来，它越界的概率低得多。
 */
export async function generateDraft(input: {
  fields: DraftForm;
  turns: ConvoTurn[];
  draftId: string;
}): Promise<DraftProposal> {
  const system = await requirePrompt("methodology-generate");
  const history = trimHistory(input.turns);
  const blanks = blankFields(input.fields);

  const transcript =
    history.length > 0
      ? history
          .map((t) => `${t.role === "user" ? "用户" : "你"}：${t.content}`)
          .join("\n\n")
      : "（没有澄清对话）";

  const ask =
    blanks.length > 0
      ? `只补这 ${blanks.length} 个空字段：${blanks
          .map((k) => `${FIELD_LABELS[k]}（${k}）`)
          .join("、")}`
      : "已经没有空字段可补，filled 给空对象即可。";

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    {
      role: "user",
      content:
        `${buildCardSnapshot(input.fields)}\n\n` +
        `澄清对话：\n${transcript}\n\n` +
        ask,
    },
  ];

  const raw = await chatOnce(messages, {
    temperature: 0.3,
    sessionId: `mth-generate-${input.draftId}`,
  });

  const proposal = normalizeDraft(parseJsonLoose<unknown>(raw), input.fields);
  if (
    Object.keys(proposal.filled).length === 0 &&
    proposal.revisions.length === 0
  ) {
    throw new Error("AI 这次没给出可用的内容，再试一次。");
  }
  return proposal;
}
