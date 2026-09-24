import { handle, ok } from "@/lib/api";
import { findById, patch, remove } from "@/lib/store";
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
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Partial<TrainingSession>;

    const changes: Partial<TrainingSession> = {
      updatedAt: new Date().toISOString(),
    };
    if (typeof body.topic === "string" && body.topic.trim() !== "") {
      changes.topic = body.topic.trim().slice(0, 500);
    }
    if (body.status === "active" || body.status === "completed") {
      changes.status = body.status;
    }

    const updated = await patch("sessions", id, changes);
    if (!updated) return ok({ error: "训练会话不存在" }, 404);
    return ok(updated);
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const deleted = await remove("sessions", id);
    if (!deleted) return ok({ error: "训练会话不存在" }, 404);
    return ok({ deleted: true });
  });
}
