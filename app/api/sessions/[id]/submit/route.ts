import { fail, handle, ok, readBody, requireString } from "@/lib/api";
import { findById, nowIso, patch } from "@/lib/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 保存「完全独立训练」模式下的作答，随后由前端触发生成报告。 */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody<{ submission?: string }>(request);

    const session = await findById("sessions", id);
    if (!session) return fail("训练会话不存在", 404);

    const submission = requireString(body.submission, "作答内容", { max: 40000 });
    const updated = await patch("sessions", id, {
      submission,
      updatedAt: nowIso(),
    });

    return ok(updated);
  });
}
