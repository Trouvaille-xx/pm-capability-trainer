import { fail, handle, ok } from "@/lib/api";
import { generateReport } from "@/lib/report";
import { findById, nowIso, patch } from "@/lib/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 生成训练报告并结束本次训练——这是平台的闭环环节。 */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const session = await findById("sessions", id);
    if (!session) return fail("训练会话不存在", 404);

    if (session.mode === "solo" && session.submission.trim() === "") {
      return fail("请先提交你的作答，再生成报告。", 400);
    }
    if (session.mode !== "solo" && session.transcript.length === 0) {
      return fail("还没有任何训练记录，无法生成报告。", 400);
    }

    const report = await generateReport(session);
    const updated = await patch("sessions", id, {
      report,
      status: "completed",
      updatedAt: nowIso(),
    });

    return ok(updated);
  });
}
