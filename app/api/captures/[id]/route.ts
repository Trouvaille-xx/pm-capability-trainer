import { handle, ok, optionalString, readBody, stringArray } from "@/lib/api";
import { findById, patch, remove } from "@/lib/store";
import type { Capture } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const capture = await findById("captures", id);
    if (!capture) return ok({ error: "记录不存在" }, 404);
    return ok(capture);
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody<Capture>(request);

    const changes: Partial<Capture> = { updatedAt: new Date().toISOString() };
    if (body.title !== undefined) changes.title = optionalString(body.title, 200);
    if (body.author !== undefined) changes.author = optionalString(body.author, 200);
    if (body.source !== undefined) changes.source = optionalString(body.source, 500);
    if (body.summary !== undefined) changes.summary = optionalString(body.summary);
    if (body.thoughts !== undefined) changes.thoughts = optionalString(body.thoughts);
    if (body.tags !== undefined) changes.tags = stringArray(body.tags);
    if (body.domains !== undefined) changes.domains = stringArray(body.domains, 12);
    if (body.keyPoints !== undefined) changes.keyPoints = stringArray(body.keyPoints, 30);
    if (body.kind !== undefined) changes.kind = body.kind;
    if (body.status !== undefined) changes.status = body.status;
    if (typeof body.rating === "number") {
      changes.rating = Math.max(0, Math.min(5, Math.round(body.rating)));
    }

    const updated = await patch("captures", id, changes);
    if (!updated) return ok({ error: "记录不存在" }, 404);
    return ok(updated);
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const deleted = await remove("captures", id);
    if (!deleted) return ok({ error: "记录不存在" }, 404);
    return ok({ deleted: true });
  });
}
