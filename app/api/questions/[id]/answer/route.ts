import { fail, handle } from "@/lib/api";
import { findById, patch, nowIso } from "@/lib/store";
import { streamAnswer } from "@/lib/questions";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 与训练会话共用同一套控制帧前缀（ASCII 记录分隔符）。 */
const CTRL = "\u001e";

/**
 * 生成「AI 回答」，流式返回。
 *
 * 协议跟 /api/sessions/{id}/message 保持一致：
 *   \u001e{json}  控制帧（status）
 *   其余          回答正文
 * 中途失败仍返回 HTTP 200，正文尾部追加 [生成中断] —— 前端必须自己认出来，
 * 不能用 response.ok 判断成功。
 *
 * 回答在流结束后整段落盘，保证库里和屏幕上看到的一致。
 */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;

    const question = await findById("questions", id);
    if (!question) return fail("题目不存在", 404);

    // 标记「正在生成」：这样刷新页面能看出上次没跑完，
    // 而不是对着一个空白的 AI 回答区猜。
    await patch("questions", id, { aiGenerating: true });

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const sendControl = (payload: unknown) => {
          controller.enqueue(encoder.encode(`${CTRL}${JSON.stringify(payload)}\n`));
        };

        let full = "";
        let failed = false;

        try {
          sendControl({ type: "status", phase: "thinking" });

          // 把自己的回答一起给模型，让它针对性地补，而不是重答一遍
          for await (const delta of streamAnswer(question)) {
            if (full === "") sendControl({ type: "status", phase: "writing" });
            full += delta;
            controller.enqueue(encoder.encode(delta));
          }
        } catch (error) {
          failed = true;
          const message = error instanceof Error ? error.message : "生成回答时出错";
          const tail = `\n\n[生成中断] ${message}`;
          controller.enqueue(encoder.encode(tail));
          full += tail;
        } finally {
          try {
            if (full.trim() !== "") {
              await patch("questions", id, {
                aiAnswer: full,
                aiAnsweredAt: nowIso(),
                aiGenerating: false,
                // 生成成功就顺手清掉上一次的错误，免得界面一直挂着旧提示
                ...(failed
                  ? {
                      lastError: `AI 回答没生成完：${full
                        .split("[生成中断]")[1]
                        ?.trim() || "未知原因"}。重试一次就行，已经生成的部分都留着。`,
                    }
                  : { lastError: "" }),
                updatedAt: nowIso(),
              });
            } else {
              await patch("questions", id, { aiGenerating: false });
            }
          } catch (error) {
            console.error("[questions/answer] 保存回答失败", error);
            await patch("questions", id, { aiGenerating: false }).catch(() => {});
          }
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
