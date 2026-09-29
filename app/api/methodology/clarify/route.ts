import { assertSameOrigin, handle, readBody } from "@/lib/api";
import { coerceDraftForm } from "@/lib/methodology-draft";
import { streamClarify, type ConvoTurn } from "@/lib/methodology-ai";

export const dynamic = "force-dynamic";

/** 与训练会话、题库回答共用同一套控制帧前缀（ASCII 记录分隔符）。 */
const CTRL = String.fromCharCode(30);

/**
 * 生成前的澄清对话，流式返回。
 *
 * 协议与 /api/questions/[id]/answer 一致：
 *   控制帧（JSON 单行）  报阶段
 *   其余                 对话正文
 * 中途失败仍返回 HTTP 200，正文尾部追加 [生成中断] —— 前端自己认，
 * 不能用 response.ok 判断成功。
 *
 * **不写库**：这段对话是临时的，只为了喂给下一次「补全」。
 * 历史由客户端持有，每轮全量上传；服务端只负责裁剪（不信客户端）。
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

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sendControl = (payload: unknown) => {
          controller.enqueue(
            encoder.encode(`${CTRL}${JSON.stringify(payload)}\n`),
          );
        };

        let wrote = false;
        try {
          sendControl({ type: "status", phase: "thinking" });

          for await (const delta of streamClarify({ fields, turns, draftId })) {
            if (!wrote) {
              sendControl({ type: "status", phase: "writing" });
              wrote = true;
            }
            controller.enqueue(encoder.encode(delta));
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "澄清时出错了";
          controller.enqueue(encoder.encode(`\n\n[生成中断] ${message}`));
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      },
    });
  });
}
