import {
  handle,
  ok,
  optionalString,
  readBody,
  requireString,
  stringArray,
} from "@/lib/api";
import { DOMAINS } from "@/lib/catalog";
import { classifyQuestion } from "@/lib/questions";
import { newId, nowIso, readCollection, upsert } from "@/lib/store";
import type { Question, QuestionKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const KINDS: QuestionKind[] = ["interview", "thinking", "other"];

/**
 * 挡掉「全是问号和标点」的题目。
 *
 * 起因是一个真实事故：用 PowerShell 的 Invoke-RestMethod 发中文 JSON 时，
 * PS 5.1 不按 UTF-8 编码请求体，中文被替换成 `?` 之后**静默存进了库**，
 * 列表页上就是一串问号，而且很难看出是哪一步坏的。
 *
 * 正常情况下中文题目一定含汉字/字母/数字，不可能整串只有 `?` 和标点。
 * 与其存进去再排查，不如在入口就把这种请求挡回来并说明原因。
 */
function looksMojibake(text: string): boolean {
  const stripped = text.replace(/[\s?？!！.,，。、;；:：'"“”‘’()（）\-_/\\[\]{}<>+=*&#@~`|^$%]/g, "");
  return stripped.length === 0;
}

export async function GET() {
  return handle(async () => {
    const questions = await readCollection("questions");
    return ok(questions);
  });
}

/**
 * 新建一道题。
 *
 * 关键设计：**保存不受归类失败影响**。
 * 用户贴进一道题，AI 归类可能要好几秒，也可能因为没配 Key / 网络问题失败 ——
 * 但从用户视角，「我把题存下来了」这件事必须成功。
 * 所以先落盘（kind 用 heuristics 兜底），再尽力归类并二次写回。
 *
 * 请求体可以带 classify: false 跳过归类（用户手填类型时用）。
 */
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody<Question & { classify?: boolean }>(request);
    const now = nowIso();

    const prompt = requireString(body.prompt, "题目", { max: 2000 });
    if (looksMojibake(prompt)) {
      throw Object.assign(
        new Error(
          "题目里全是问号和标点，看起来是编码坏了（中文没传成 UTF-8）。" +
            "浏览器里正常提交不会这样；如果是用脚本发请求，请把请求体按 UTF-8 编码。",
        ),
        { status: 400 },
      );
    }
    const source = optionalString(body.source, 100);
    const myAnswer = optionalString(body.myAnswer);
    const hasAnswer = myAnswer.trim() !== "";

    const question: Question = {
      id: newId("qst"),
      prompt,
      kind: KINDS.includes(body.kind as QuestionKind)
        ? (body.kind as QuestionKind)
        : "other",
      status: hasAnswer ? "answered" : "open",
      source,
      domains: stringArray(body.domains, 3).filter((d) =>
        (DOMAINS as readonly string[]).includes(d),
      ),
      tags: stringArray(body.tags, 5),
      myAnswer,
      myAnsweredAt: hasAnswer ? now : "",
      aiAnswer: "",
      aiAnsweredAt: "",
      related: [],
      readings: [],
      createdAt: now,
      updatedAt: now,
    };

    await upsert("questions", question);

    // 归类是「尽力而为」：失败就保留兜底结果，并把原因记下来给界面显示。
    if (body.classify !== false) {
      try {
        const c = await classifyQuestion(prompt);
        const patched: Question = {
          ...question,
          // 用户手填过类型就不覆盖
          kind: body.kind ? question.kind : c.kind,
          domains: question.domains.length > 0 ? question.domains : c.domains,
          tags: c.tags.length > 0 ? c.tags : question.tags,
          related: c.related,
          updatedAt: nowIso(),
        };
        await upsert("questions", patched);
        return ok(patched, 201);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "归类失败";
        console.warn("[questions] 归类失败：", reason);
        const patched: Question = {
          ...question,
          lastError: `AI 归类没成功：${reason}。你可以手动选类型，或者稍后点「重新归类」。`,
          updatedAt: nowIso(),
        };
        await upsert("questions", patched);
        return ok(patched, 201);
      }
    }

    return ok(question, 201);
  });
}
