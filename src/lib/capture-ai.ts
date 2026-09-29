/**
 * 记录总结的 AI 能力：把一段原文读成一份结构化摘记。
 *
 * 只提议、不写库 —— 结果交给编辑页，用户改完点保存才落盘。
 * 摘记是「他日后会当真的东西」，所以宁可他过一眼再存，也不想替他做主。
 */

import { chatOnce, parseJsonLoose, type ChatMessage } from "./ai";
import { DOMAINS, normalizeDomains } from "./catalog";
import { requirePrompt } from "./prompts";

export interface CaptureDigest {
  summary: string;
  keyPoints: string[];
  tags: string[];
  domains: string[];
}

/** 原文的长度上限。太长的原文既费钱又会把要点淹掉，截断比报错好。 */
const MAX_SOURCE = 12000;
const MAX_POINTS = 6;
const MAX_TAGS = 6;

export async function digestCapture(input: {
  title: string;
  kind: string;
  author?: string;
  source?: string;
  raw: string;
  /** 会话标识，只给网关当 x-opencode-session 用 */
  sessionId: string;
}): Promise<CaptureDigest> {
  const system = await requirePrompt("capture-digest");

  const clipping =
    input.raw.length > MAX_SOURCE
      ? `\n\n（原文过长，以下只取前 ${MAX_SOURCE} 字）`
      : "";

  const context = [
    `标题：${input.title}`,
    input.author ? `作者：${input.author}` : "",
    input.source ? `出处：${input.source}` : "",
    `可选领域（必须原样使用）：${DOMAINS.join(" / ")}`,
  ]
    .filter(Boolean)
    .join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    {
      role: "user",
      content: `${context}\n\n原文：\n${input.raw.slice(0, MAX_SOURCE)}${clipping}`,
    },
  ];

  const raw = await chatOnce(messages, {
    temperature: 0.3,
    sessionId: input.sessionId,
  });

  const parsed = parseJsonLoose<Partial<CaptureDigest>>(raw);

  const summary =
    typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  const keyPoints = Array.isArray(parsed.keyPoints)
    ? parsed.keyPoints
        .filter((p): p is string => typeof p === "string" && p.trim() !== "")
        .map((p) => p.trim())
        .slice(0, MAX_POINTS)
    : [];
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags
        .filter((t): t is string => typeof t === "string" && t.trim() !== "")
        .map((t) => t.trim().slice(0, 12))
        .slice(0, MAX_TAGS)
    : [];
  // 领域必须落在白名单里，否则会污染筛选器（和题目归类同一条规矩）
  const domains = normalizeDomains(
    (Array.isArray(parsed.domains) ? parsed.domains : [])
      .filter((d): d is string => typeof d === "string")
      .slice(0, 3),
  );

  if (summary === "" && keyPoints.length === 0) {
    throw new Error("AI 没读出一份可用的摘记，再试一次。");
  }

  return { summary, keyPoints, tags, domains };
}
