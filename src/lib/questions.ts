/**
 * 题库的 AI 能力。三个独立操作，各自可单独调用、单独失败：
 *
 *   1. classifyQuestion  归类 —— 类型、领域、标签、相关知识
 *   2. answerQuestion    生成 AI 回答（流式）
 *   3. suggestReadings   推荐阅读（需要联网搜索）
 *
 * 为什么拆成三个而不是一个大调用：
 * 它们耗时差很多（归类 3 秒、回答几十秒、搜索看网络），
 * 而且失败概率不一样（搜索没配 key 就直接不可用）。
 * 合在一起的话，「搜索没配」会连累「归类」也做不了。
 *
 * 归类输出结构化 JSON，所以用 chatOnce + parseJsonLoose；
 * 回答要打字机效果，所以用 chatStream。
 */

import { chatOnce, chatStream, parseJsonLoose } from "./ai";
import { DOMAINS } from "./catalog";
import { readCollection, readSettings } from "./store";
import type {
  MethodologyCard,
  Question,
  QuestionKind,
  RelatedConcept,
  ReadingItem,
} from "./types";
import { renderResults, runSearch } from "./websearch";

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

const CLASSIFY_SYSTEM = `你是一个给产品经理题库做归类的助手。

用户会给你一道面试题或思考题。你要输出 JSON，不要输出任何其它文字。

字段：
- kind: 只能是 "interview"（面试真题）、"thinking"（自己想的思考题）、"other"（其它）
- domains: 从给定领域列表里选 1-3 个最贴切的，必须原样使用列表里的词
- tags: 2-5 个短标签（每个不超过 6 个字），用于检索
- related: 3-5 个「相关知识」概念，每个形如 {"term": "概念名", "gloss": "一句话说明它跟这道题的关系"}

related 的要求：
- term 要是一个**有名字的概念**（比如「留存曲线」「护栏指标」「损失厌恶」），
  不要写成一句描述。它会用来跟知识库匹配。
- gloss 要说清「这个概念能帮答题人解决什么」，不要复述定义。
- 优先给那些能直接用来回答这道题的概念。`;

/** 列出知识库里已有的概念名，让模型优先复用（这样能自动关联上卡片）。 */
async function knownConcepts(): Promise<MethodologyCard[]> {
  try {
    return await readCollection("methodology");
  } catch {
    return [];
  }
}

export async function classifyQuestion(question: string): Promise<Classification> {
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
      { role: "system", content: CLASSIFY_SYSTEM },
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

const ANSWER_SYSTEM = `你是一位资深产品经理，正在帮一个正在准备面试的人看同一道题。

要求：
- 直接给出你的答案，不要先复述题目、不要写「这是个好问题」。
- 结构清晰，但不要滥用小标题；该用列表的地方用列表。
- 关键判断要给出依据（数据基准、案例、原理），区分事实与推断。
- 如果这是一道面试题，顺带点出「答这题时最容易被扣分的地方」。
- 用中文，语气像一个愿意把话说明白的同事，不要客套。`;

export async function* streamAnswer(
  question: Question,
): AsyncGenerator<string, void, unknown> {
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
      { role: "system", content: ANSWER_SYSTEM },
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

const READING_SYSTEM = `你在给一个产品经理推荐阅读材料。

用户会给你一道题，以及一组搜索结果。你要从中挑出 3-4 条真正值得读的，
输出 JSON 数组，不要输出任何其它文字。

每个元素：
- title: 材料标题（保留原文语言，不要翻译书名）
- source: 来源（站点名、书名 + 章节、作者）
- url: 链接，必须来自给定的搜索结果，不要自己编
- why: 一句话说明「为什么对这道题有用」，要具体到这道题的论点，不要说「内容很全面」

优先选：直接回应题目核心争论的、有具体数据或案例的、经典框架的原出处。
不要选：聚合页、课程广告、内容农场。`;

export async function suggestReadings(
  question: Question,
): Promise<ReadingItem[]> {
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
      { role: "system", content: READING_SYSTEM },
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
