import { assertSameOrigin, handle, ok, readBody, uniqueStringArray } from "@/lib/api";
import { findById, mutate, remove } from "@/lib/store";
import type { TrainingSession } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const session = await findById("sessions", id);
    if (!session) return ok({ error: "训练会话不存在" }, 404);
    return ok(session);
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const body = await readBody<TrainingSession & { tags?: string[] }>(request);

    // 标签写进报告里（没有报告就忽略），其余字段只接受白名单值
    const tags =
      body.tags !== undefined ? uniqueStringArray(body.tags, 12) : undefined;

    const updated = await mutate("sessions", id, (current) => ({
      ...current,
      ...(typeof body.topic === "string" && body.topic.trim() !== ""
        ? { topic: body.topic.trim().slice(0, 500) }
        : {}),
      ...(body.status === "active" || body.status === "completed"
        ? { status: body.status }
        : {}),
      ...(tags !== undefined && current.report
        ? { report: { ...current.report, tags } }
        : {}),
      updatedAt: new Date().toISOString(),
    }));

    if (!updated) return ok({ error: "训练会话不存在" }, 404);
    return ok(updated);
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const deleted = await remove("sessions", id);
    if (!deleted) return ok({ error: "训练会话不存在" }, 404);
    return ok({ deleted: true });
  });
}
