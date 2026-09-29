import { assertSameOrigin, fail, handle, ok, readBody } from "@/lib/api";
import { coerceDraftForm } from "@/lib/methodology-draft";
import { generateDraft, type ConvoTurn } from "@/lib/methodology-ai";

export const dynamic = "force-dynamic";

/**
 * 补全卡片的空字段，返回结构化 JSON。
 *
 * 不流式：产出是一份字段到值的映射，边算边出没有意义（没法用半份 JSON），
 * 而且这一轮通常比澄清快。等一两秒给完整结果更干脆。
 *
 * **只提议、不写库**。真正写进去的是用户点保存那一下 —— 而且只写空的字段，
 * 已有内容要改必须经他确认（那条在客户端做，服务端这里也过滤了一道）。
 */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const body = await readBody<{
      draftId?: unknown;
      fields?: unknown;
      turns?: unknown;
    }>(request);

    const fields = coerceDraftForm(body.fields);
    const turns: ConvoTurn[] = Array.isArray(body.turns)
      ? (body.turns as ConvoTurn[])
      : [];
    const draftId =
      typeof body.draftId === "string" && body.draftId.trim() !== ""
        ? body.draftId.trim().slice(0, 64)
        : "anon";

    try {
      const proposal = await generateDraft({ fields, turns, draftId });
      return ok(proposal);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "补全失败";
      // 提示词被停用 / 模型没给出可用内容 / JSON 解析失败，都会走到这里
      return fail(reason, 400);
    }
  });
}
