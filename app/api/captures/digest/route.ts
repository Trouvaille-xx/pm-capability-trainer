import { assertSameOrigin, fail, handle, ok, optionalString, readBody } from "@/lib/api";
import { digestCapture } from "@/lib/capture-ai";

export const dynamic = "force-dynamic";

/**
 * 把一段原文读成结构化摘记：总结 / 关键要点 / 标签 / 关联领域。
 *
 * **不写库**：结果只回给编辑页，用户改完点保存才落盘。
 * 摘记是他日后会当真的东西，不该替他做主。
 *
 * 不流式：产出是结构化 JSON，边算边出没法用（半份 JSON 没法渲染）。
 */
export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const body = await readBody<{
      title?: unknown;
      kind?: unknown;
      author?: unknown;
      source?: unknown;
      raw?: unknown;
    }>(request);

    const raw = optionalString(body.raw, 60000);
    if (raw.trim().length < 20) {
      return fail("原文太短了（不到 20 字），先贴一段真正要整理的内容。", 400);
    }

    const title = optionalString(body.title, 200) || "（无标题）";

    try {
      const digest = await digestCapture({
        title,
        kind: optionalString(body.kind, 20) || "note",
        author: optionalString(body.author, 200),
        source: optionalString(body.source, 500),
        raw,
        // 用标题当会话标识：同一条记录的多次生成算一个会话
        sessionId: `cap-digest-${title.slice(0, 24)}`,
      });
      return ok(digest);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "生成摘要失败";
      console.warn("[captures/digest] 失败：", reason);
      return fail(reason, 400);
    }
  });
}
