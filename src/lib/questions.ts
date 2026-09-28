/**
 * 题库的 AI 能力。四个独立操作，各自可单独调用、单独失败：
 *
 *   1. classifyQuestion  归类 —— 类型、领域、标签、相关知识
 *   2. streamAnswer      生成 AI 回答（流式，含「回答导览」块）
 *   3. suggestReadings   推荐阅读（需要联网搜索）
 *   4. reviewAnswer      批改「我的回答」，四维度打分
 *
 * 为什么拆成四个而不是一个大调用：
 * 它们耗时差很多（归类 3 秒、回答几十秒、搜索看网络），
 * 而且失败概率不一样（搜索没配 key 就直接不可用）。
 * 合在一起的话，「搜索没配」会连累「归类」也做不了。
 *
 * 归类 / 评分 / 推荐阅读输出结构化 JSON，所以用 chatOnce + parseJsonLoose；
 * 回答要打字机效果，所以用 chatStream。
 */

import { chatOnce, chatStream, parseJsonLoose } from "./ai";
import { DOMAINS, promptScopeName } from "./catalog";
import { promptForScope } from "./prompts";
import { readCollection, readSettings } from "./store";
import type {
  AnswerReview,
  MethodologyCard,
  PromptScope,
  Question,
  QuestionKind,
  RelatedConcept,
  ReadingItem,
} from "./types";
import { renderResults, runSearch } from "./websearch";

/**
 * 取一个作用域的提示词。这三个 scope 的文案住在「设置 → 提示词管理」里，
 * 和训练/报告用的是同一套模板存储，用户能改也能停用。
 *
 * 被停用时这里抛错，而不是退回内置文案 —— 否则用户以为停掉了，实际还在跑。
 * 抛错会被各自的接口转成一条可读的失败信息。
 */
async function requirePrompt(scope: PromptScope): Promise<string> {
  const text = await promptForScope(scope);
  if (!text.trim()) {
    throw new Error(
      `「${promptScopeName(scope)}」提示词被停用了，这一步做不了。去「辅助系统 → 提示词管理」里打开它。`,
    );
  }
  return text;
}

/* ------------------------------------------------------------------ *
 * 归类
 * ------------------------------------------------------------------ */

export interface Classification {
  kind: QuestionKind;
  domains: string[];
  tags: string[];
  related: RelatedConcept[];
}

const KINDS: QuestionKind[] = ["interview", "thinking", "other"];

/** 列出知识库里已有的概念名，让模型优先复用（这样能自动关联上卡片）。 */
async function knownConcepts(): Promise<MethodologyCard[]> {
  try {
    return await readCollection("methodology");
  } catch {
    return [];
  }
}

export async function classifyQuestion(question: string): Promise<Classification> {
  const system = await requirePrompt("question-classify");
  const cards = await knownConcepts();
  const names = cards.map((c) => c.title).filter(Boolean);

  const user = [
    `这道题是：\n${question}`,
    "",
    `可选领域（必须原样使用）：${DOMAINS.join(" / ")}`,
    names.length > 0
      ? `知识库里已有这些概念，如果适用请优先用它们的原名，方便自动关联：\n${names.join(" / ")}`
      : "",
    "",
    '只输出 JSON，形如：{"kind":"interview","domains":["产品设计"],"tags":["留存","增长"],"related":[{"term":"留存曲线","gloss":"用来判断留存问题出在新增质量还是体验"}]}',
  ]
    .filter((line) => line !== "")
    .join("\n");

  const raw = await chatOnce(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // sessionId 必传：供应商要求 x-opencode-session 头，否则 400 MissingSessionID
    { temperature: 0.2, sessionId: "qst-classify" },
  );

  const parsed = parseJsonLoose<Partial<Classification>>(raw);

  const kind: QuestionKind =
    typeof parsed.kind === "string" && KINDS.includes(parsed.kind as QuestionKind)
      ? (parsed.kind as QuestionKind)
      : "other";

  // 领域必须落在白名单内，否则会污染筛选器
  const domains = Array.isArray(parsed.domains)
    ? parsed.domains
        .filter((d): d is string => typeof d === "string")
        .map((d) => d.trim())
        .filter((d) => (DOMAINS as readonly string[]).includes(d))
        .slice(0, 3)
    : [];

  const tags = Array.isArray(parsed.tags)
    ? parsed.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 5)
    : [];

  // 相关知识：顺手把 term 跟知识库里的卡片对上，对上了就存 cardId，
  // 这样详情页能直接给出「去方法论看这条」的入口。
  const byTitle = new Map(cards.map((c) => [c.title.trim(), c.id]));
  const rawRelated: unknown = parsed.related;
  const related: RelatedConcept[] = Array.isArray(rawRelated)
    ? rawRelated
        .flatMap((r): RelatedConcept[] => {
          if (!r || typeof r !== "object") return [];
          const rec = r as { term?: unknown; gloss?: unknown };
          if (typeof rec.term !== "string" || rec.term.trim() === "") return [];
          const term = rec.term.trim();
          return [
            {
              term,
              gloss: typeof rec.gloss === "string" ? rec.gloss.trim() : "",
              cardId: byTitle.get(term),
            },
          ];
        })
        .slice(0, 5)
    : [];

  return { kind, domains, tags, related };
}

/* ------------------------------------------------------------------ *
 * AI 回答
 * ------------------------------------------------------------------ */

export async function* streamAnswer(
  question: Question,
): AsyncGenerator<string, void, unknown> {
  const system = await requirePrompt("question-answer");
  const parts = [`题目：\n${question.prompt}`];

  if (question.source) parts.push(`出处：${question.source}`);
  if (question.domains.length > 0) parts.push(`领域：${question.domains.join("、")}`);

  // 把自己的回答一起给模型：这样它是对着「我答了什么」来补充，
  // 而不是干巴巴地重答一遍 —— 后者对这个模块没有价值。
  if (question.myAnswer.trim()) {
    parts.push(
      "我已经先答过一遍了，内容如下。请针对它给出你的答案：该补的补、该纠的纠，\n" +
        "如果我的判断有偏差，直接指出来。\n\n" +
        question.myAnswer,
    );
  }

  yield* chatStream(
    [
      { role: "system", content: system },
      { role: "user", content: parts.join("\n\n") },
    ],
    {
      temperature: 0.5,
      // 【必须传】这个供应商要求 x-opencode-session 头才肯路由，
      // 不传会返回 HTTP 400 MissingSessionID。
      // 用题目 id 当会话标识，同一道题的多次生成算一个会话。
      sessionId: `qst-${question.id}`,
    },
  );
}

/* ------------------------------------------------------------------ *
 * 推荐阅读
 * ------------------------------------------------------------------ */

export async function suggestReadings(
  question: Question,
): Promise<ReadingItem[]> {
  const system = await requirePrompt("question-readings");
  const settings = await readSettings();
  const webSearch = settings.webSearch;

  if (!webSearch || !webSearch.enabled) {
    throw new Error("联网搜索没打开。去「辅助系统」里配置搜索服务后再试。");
  }

  // 搜索词用题目本身 + 领域，比只搜题目命中率高
  const query = [question.prompt.slice(0, 80), question.domains[0]]
    .filter(Boolean)
    .join(" ");

  const outcome = await runSearch(query, webSearch);
  if (!outcome.ok) {
    throw new Error(outcome.error || "搜索失败，检查一下搜索服务的 Key。");
  }
  if (outcome.results.length === 0) {
    throw new Error("没搜到结果，换个模型或稍后再试。");
  }

  const raw = await chatOnce(
    [
      { role: "system", content: system },
      {
        role: "user",
        content:
          `题目：\n${question.prompt}\n\n` +
          (question.myAnswer.trim()
            ? `我的回答要点：\n${question.myAnswer.slice(0, 800)}\n\n`
            : "") +
          renderResults(query, outcome.results),
      },
    ],
    // sessionId 必传：供应商要求 x-opencode-session 头，否则 400 MissingSessionID
    { temperature: 0.3, sessionId: `qst-read-${question.id}` },
  );

  const parsed = parseJsonLoose<Partial<ReadingItem>[]>(raw);
  if (!Array.isArray(parsed)) return [];

  // 只保留搜索结果里真实出现过的 URL —— 模型编链接是常见失效点
  const allowed = new Set(outcome.results.map((r) => r.url));
  return parsed
    .filter(
      (r): r is ReadingItem =>
        !!r &&
        typeof r === "object" &&
        typeof (r as ReadingItem).title === "string" &&
        typeof (r as ReadingItem).url === "string",
    )
    .map((r) => ({
      title: r.title.trim(),
      source: typeof r.source === "string" ? r.source.trim() : "",
      url: r.url.trim(),
      why: typeof r.why === "string" ? r.why.trim() : "",
    }))
    .filter((r) => r.title !== "" && allowed.has(r.url))
    .slice(0, 4);
}

/* ------------------------------------------------------------------ *
 * AI 评分
 * ------------------------------------------------------------------ */

/**
 * 评分的五个固定维度与满分。
 *
 * 固定而不是让模型自创，是为了让不同题目之间可比 —— 概览页要看的是
 * 「这个维度是不是一直弱」，每道题换一套维度就什么也看不出来。
 *
 * 顺序与提示词里的一致，用来在模型漏维度/改名时兜底对齐。
 */
export const REVIEW_DIMENSIONS: { dimension: string; max: number }[] = [
  { dimension: "问题理解", max: 20 },
  { dimension: "结构层次", max: 20 },
  { dimension: "论据充分", max: 20 },
  { dimension: "洞察深度", max: 20 },
  { dimension: "谬误识别", max: 20 },
];

/**
 * 批改「我的回答」。
 *
 * 为什么用固定的四个维度而不是让模型自创：只有维度一致，
 * 不同题目的分数才能横向比较 —— 概览页要看的是「这个维度是不是一直弱」，
 * 每道题换一套维度就什么也看不出来。
 *
 * 模型可能漏维度、写错名字、给超范围的分数，所以这里按 REVIEW_DIMENSIONS
 * 逐个对齐（对齐方式与 report.ts 的 grading 一致）：认识的按名字取，
 * 不认识的按位置兜底，都取不到就给 0 并在 total 上如实反映。
 */
export async function reviewAnswer(question: Question): Promise<AnswerReview> {
  const system = await requirePrompt("question-review");
  const answer = question.myAnswer.trim();

  const user = [
    `题目：\n${question.prompt}`,
    question.source ? `出处：${question.source}` : "",
    question.domains.length > 0 ? `领域：${question.domains.join("、")}` : "",
    answer ? `我的回答：\n${answer}` : "我的回答：（空）",
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await chatOnce(
    [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    // 温度压到 0.2：评分要的是稳定，不是发挥
    { temperature: 0.2, sessionId: `qst-review-${question.id}` },
  );

  const parsed = parseJsonLoose<Partial<AnswerReview>>(raw);
  const rawScores = Array.isArray(parsed.scores) ? parsed.scores : [];

  /* 按维度名对齐；名字对不上就按位置兜底 —— 模型把维度改名时
     位置通常还是对的，这一步能救回大部分情况。 */
  const scores = REVIEW_DIMENSIONS.map((dim, index) => {
    const byName = rawScores.find(
      (s) => s && typeof s.dimension === "string" && s.dimension.trim() === dim.dimension,
    );
    const picked = byName ?? rawScores[index];
    const score =
      picked && Number.isFinite(Number(picked.score))
        ? Math.max(0, Math.min(dim.max, Math.round(Number(picked.score))))
        : 0;
    return {
      dimension: dim.dimension,
      max: dim.max,
      score,
      comment:
        picked && typeof picked.comment === "string" ? picked.comment.trim() : "",
    };
  });

  const summary =
    typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  if (!summary && scores.every((s) => s.score === 0)) {
    throw new Error("评分没给出有效结果，请再试一次。");
  }

  const suggestions = Array.isArray(parsed.suggestions)
    ? parsed.suggestions
        .filter((s): s is string => typeof s === "string" && s.trim() !== "")
        .map((s) => s.trim())
        .slice(0, 4)
    : [];

  return {
    scores,
    overall: scores.reduce((sum, s) => sum + s.score, 0),
    summary,
    suggestions,
    at: new Date().toISOString(),
  };
}
