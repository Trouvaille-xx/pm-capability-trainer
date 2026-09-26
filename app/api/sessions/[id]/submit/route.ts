import { assertSameOrigin, fail, handle, ok, readBody, requireString } from "@/lib/api";
import { mutate, nowIso } from "@/lib/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 保存「完全独立训练」模式下的作答，随后由前端触发生成报告。 */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const body = await readBody<{ submission?: string }>(request);

    const submission = requireString(body.submission, "作答内容", { max: 40000 });

    // 锁内读改写：与并发的对话轮次共用同一把锁，不会互相覆盖
    const updated = await mutate("sessions", id, (current) => ({
      ...current,
      submission,
      updatedAt: nowIso(),
    }));

    if (!updated) return fail("训练会话不存在", 404);
    return ok(updated);
  });
}
