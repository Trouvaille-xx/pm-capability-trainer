/**
 * AI 回答的解析。
 *
 * 回答现在是四块，用 Markdown 二级标题分开：
 *   一、面试回答结构 —— 发言骨架（用 ###导览 围栏包着）
 *   二、面试回答原文 —— 能照着讲的作答，里面用 <<>> 标出得分点
 *   三、警惕容易被扣分点
 *   四、回答建议
 *
 * 界面上按这四块分段展示，所以这里负责拆开。
 *
 * 另外正文里用 <<双尖括号>> 标出了「得分点」，界面渲染成朱砂。
 * 为什么用双尖括号而不是 <mark>：模型经常把 HTML 标签写坏（漏闭合、混在
 * Markdown 里），而且我们的 Markdown 渲染器会原样转义尖括号。<<>> 在中文语境里
 * 不会被误用，也不会被 Markdown 语法吃掉。
 *
 * 【流式安全】内容是一段段吐出来的，所以拆分必须能在「只收到一半」时
 * 也给出合理结果：认不出的部分一律落进「回答原文」，绝不吞掉已收到的内容。
 */

export interface ParsedAnswer {
  /** 一、面试回答结构（发言骨架），没写时是空串 */
  guide: string;
  /** 二、面试回答原文 */
  body: string;
  /** 三、警惕容易被扣分点 */
  pitfalls: string;
  /** 四、回答建议 */
  suggestions: string;
}

/** 四块的标题锚点。标题可能写成「## 三、…」也可能带别的修饰，用前缀匹配。 */
const SECTION_PATTERNS: { key: keyof ParsedAnswer; re: RegExp }[] = [
  { key: "body", re: /^[ \t]*#{1,4}[ \t]*二[、.．][ \t]*(?:面试回答原文|回答原文)/m },
  { key: "pitfalls", re: /^[ \t]*#{1,4}[ \t]*三[、.．][ \t]*(?:警惕容易被扣分点|容易被扣分点|扣分点)/m },
  { key: "suggestions", re: /^[ \t]*#{1,4}[ \t]*四[、.．][ \t]*(?:回答建议|建议)/m },
];

/** 「一、面试回答结构」块的标题（这块内含导览围栏）。 */
const SECTION_HEAD =
  /^[ \t]*#{1,4}[ \t]*一[、.．][ \t]*(?:面试回答结构|回答结构)/m;

/**
 * 导览围栏：一行「###导览」开，一行「###」关。
 * 闭围栏放宽到「###正文」这类带标题的写法 —— 实测模型会这么写。
 */
const GUIDE_FENCE = /^[ \t]*#{2,4}[ \t]*导览[ \t]*$/m;
const GUIDE_FENCE_END = /^[ \t]*#{2,4}[ \t]*(?:正文|答案|回答)?[ \t]*$/m;

/** 从围栏内容里抽导览。没有围栏就返回空串 —— 不能把整块当导览。 */
function extractGuide(block: string): string {
  const text = block ?? "";
  const open = GUIDE_FENCE.exec(text);
  if (!open || open.index === undefined) return "";

  const afterOpen = open.index + open[0].replace(/\n$/, "").length;
  const close = GUIDE_FENCE_END.exec(text.slice(afterOpen));
  if (close && close.index !== undefined) {
    return text.slice(afterOpen, afterOpen + close.index).trim();
  }
  // 围栏还没闭合（流式期间）：后面的都算导览
  return text.slice(afterOpen).trim();
}

/**
 * 按四块的标题切段。
 *
 * 只认「已经出现的」标题，所以流式期间前面几块能先渲染出来；
 * 一块都没认出来（老回答、或模型没按格式写）就整段落进 body。
 */
export function parseAnswer(raw: string): ParsedAnswer {
  const text = raw ?? "";

  /* 收集所有块标题的位置，按位置排序后切成区间。 */
  type Hit = { key: keyof ParsedAnswer; start: number; len: number };
  const hits: Hit[] = [];

  const head = SECTION_HEAD.exec(text);
  if (head && head.index !== undefined) {
    hits.push({ key: "guide", start: head.index, len: head[0].length });
  }
  for (const { key, re } of SECTION_PATTERNS) {
    const m = re.exec(text);
    if (m && m.index !== undefined) {
      hits.push({ key, start: m.index, len: m[0].length });
    }
  }

  if (hits.length === 0) {
    // 没有任何块标题：整段当「回答原文」，导览另找围栏
    return {
      guide: extractGuide(text),
      body: text.trim(),
      pitfalls: "",
      suggestions: "",
    };
  }

  hits.sort((a, b) => a.start - b.start);

  const out: ParsedAnswer = { guide: "", body: "", pitfalls: "", suggestions: "" };
  hits.forEach((hit, i) => {
    const from = hit.start + hit.len;
    const to = i + 1 < hits.length ? hits[i + 1].start : text.length;
    const chunk = text.slice(from, to).trim();
    if (hit.key === "guide") out.guide = extractGuide(chunk);
    else out[hit.key] = chunk;
  });

  /* 标题之前如果还有内容（模型没按格式起头），塞进回答原文，
     免得那部分凭空消失。 */
  const first = hits[0];
  if (first.key !== "guide" && first.start > 0) {
    const lead = text.slice(0, first.start).trim();
    if (lead !== "") out.body = `${lead}\n\n${out.body}`.trim();
  }

  return out;
}

/** 正文里被 <<>> 标记的一个片段。 */
export interface MarkSpan {
  text: string;
  /** true 表示这一段要渲染成朱砂重点 */
  mark: boolean;
}

/**
 * 把正文按 <<>> 切成若干片段，供逐段渲染。
 *
 * 未闭合的 `<<` 当作普通文本 —— 流式输出时经常先收到左括号，
 * 这时候不能把后面的字全吞掉等着闭合。
 */
export function splitMarks(text: string): MarkSpan[] {
  const spans: MarkSpan[] = [];
  let rest = text ?? "";

  while (rest !== "") {
    const open = rest.indexOf("<<");
    if (open === -1) {
      spans.push({ text: rest, mark: false });
      break;
    }
    const close = rest.indexOf(">>", open + 2);
    if (close === -1) {
      spans.push({ text: rest, mark: false });
      break;
    }
    if (open > 0) spans.push({ text: rest.slice(0, open), mark: false });
    const inner = rest.slice(open + 2, close).trim();
    if (inner !== "") spans.push({ text: inner, mark: true });
    rest = rest.slice(close + 2);
  }

  return spans.filter((s) => s.text !== "");
}
