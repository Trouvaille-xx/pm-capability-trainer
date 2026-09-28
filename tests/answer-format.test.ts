import { describe, expect, it } from "vitest";

import { parseAnswer, splitMarks } from "@/lib/answer-format";

/**
 * AI 回答的两块拆分与 <<>> 标记。
 *
 * 这一组测试盯的是「流式安全」：模型是一个字一个字吐出来的，
 * 任何时刻都可能收到半截内容。拆分逻辑在半截内容上也不能吞字。
 */
const FULL = [
  "## 一、面试回答结构",
  "",
  "###导览",
  "开场：先给出总判断。",
  "主体：① 定层次 ② 列约束 ③ 给选型。",
  "收尾：补一句验证方式。",
  "###",
  "",
  "## 二、面试回答原文",
  "",
  "先说结论——这三者不在同一层。我用 <<约束条件>> 来定选型。",
  "",
  "## 三、警惕容易被扣分点",
  "",
  "1. 一上来就比 RAG 和微调，层次错了。",
  "",
  "## 四、回答建议",
  "",
  "补一个实际项目的选型依据。",
].join("\n");

describe("parseAnswer：拆出四块", () => {
  it("按标题拆成 结构 / 原文 / 扣分点 / 建议", () => {
    const r = parseAnswer(FULL);
    expect(r.guide).toContain("开场");
    expect(r.guide).toContain("收尾");
    // 导览里不该混进后面几块
    expect(r.guide).not.toContain("先说结论");
    expect(r.guide).not.toContain("###");
    expect(r.body).toContain("先说结论");
    expect(r.body).toContain("<<约束条件>>");
    expect(r.body).not.toContain("一上来就比");
    expect(r.pitfalls).toContain("层次错了");
    expect(r.suggestions).toContain("补一个实际项目");
  });

  it("只有标题、内容还没来时，后面几块为空而不是乱塞", () => {
    const partial = "## 一、面试回答结构\n\n###导览\n开场：先给判断。";
    const r = parseAnswer(partial);
    expect(r.guide).toContain("开场");
    expect(r.body).toBe("");
    expect(r.pitfalls).toBe("");
    expect(r.suggestions).toBe("");
  });

  it("生成到一半（只到第二块）时前面的块先出来", () => {
    const partial = FULL.slice(0, FULL.indexOf("## 三"));
    const r = parseAnswer(partial);
    expect(r.guide).toContain("开场");
    expect(r.body).toContain("先说结论");
    expect(r.pitfalls).toBe("");
  });

  it("没有任何块标题时，整段当回答原文（老回答也能显示）", () => {
    const raw = "直接就是答案，没有标题结构。\n第二行。";
    const r = parseAnswer(raw);
    expect(r.guide).toBe("");
    expect(r.body).toContain("直接就是答案");
    expect(r.pitfalls).toBe("");
  });

  it("正文里出现「导览」两个字不会被当成分界", () => {
    const raw = "这段正文里提到了导览这个词，但它不是标题。";
    expect(parseAnswer(raw).body).toBe(raw);
  });

  it("空输入不炸", () => {
    expect(parseAnswer("")).toEqual({
      guide: "",
      body: "",
      pitfalls: "",
      suggestions: "",
    });
  });
});

describe("splitMarks：正文里的朱砂标记", () => {
  it("把 <<>> 里的内容标出来，其余保持原样", () => {
    const spans = splitMarks("要看 <<留存曲线>> 而不是新增数。");
    expect(spans).toEqual([
      { text: "要看 ", mark: false },
      { text: "留存曲线", mark: true },
      { text: " 而不是新增数。", mark: false },
    ]);
  });

  it("一段里可以有多处标记", () => {
    const spans = splitMarks("<<A>> 和 <<B>> 都要。");
    expect(spans.filter((s) => s.mark).map((s) => s.text)).toEqual(["A", "B"]);
  });

  it("未闭合的 << 当作普通文本（流式期间常见）", () => {
    const spans = splitMarks("要看 <<留存曲");
    expect(spans).toEqual([{ text: "要看 <<留存曲", mark: false }]);
  });

  it("空的 <<>> 不产生空标记", () => {
    const spans = splitMarks("a <<>> b");
    expect(spans.every((s) => s.text !== "")).toBe(true);
    expect(spans.filter((s) => s.mark)).toHaveLength(0);
  });

  it("没有标记时原样返回一段", () => {
    expect(splitMarks("普通正文")).toEqual([{ text: "普通正文", mark: false }]);
  });
});
