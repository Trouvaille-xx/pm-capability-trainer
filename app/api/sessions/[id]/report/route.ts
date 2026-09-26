import { assertSameOrigin, fail, handle, ok } from "@/lib/api";
import { generateReport } from "@/lib/report";
import { findById, mutate, nowIso } from "@/lib/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 正在生成报告的会话 id。
 *
 * 报告是一次付费的模型调用，双击按钮（或前端重试）不该生成两份。
 * 「重新生成」仍然可用——这个集合只挡并发，不挡先后。
 */
const inFlight = new Set<string>();

/** 生成训练报告并结束本次训练——这是平台的闭环环节。 */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;

    if (inFlight.has(id)) {
      return fail("这次训练的报告正在生成中，请稍候。", 409);
    }

    const session = await findById("sessions", id);
    if (!session) return fail("训练会话不存在", 404);

    if (session.mode === "solo" && session.submission.trim() === "") {
      return fail("请先提交你的作答，再生成报告。", 400);
    }
    if (session.mode !== "solo" && session.transcript.length === 0) {
      return fail("还没有任何训练记录，无法生成报告。", 400);
    }

    inFlight.add(id);
    try {
      const report = await generateReport(session);

      // 锁内写回：报告生成期间可能又追加了一轮对话，别把它覆盖掉
      const updated = await mutate("sessions", id, (current) => ({
        ...current,
        report,
        status: "completed",
        updatedAt: nowIso(),
      }));

      if (!updated) return fail("训练会话不存在", 404);
      return ok(updated);
    } finally {
      inFlight.delete(id);
    }
  });
}
