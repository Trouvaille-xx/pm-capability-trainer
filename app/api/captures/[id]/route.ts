import { assertSameOrigin, handle, ok, optionalString, readBody, stringArray, uniqueStringArray } from "@/lib/api";
import { normalizeDomains } from "@/lib/catalog";
import { findById, patch, remove } from "@/lib/store";
import type { Capture, CaptureKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const KINDS: CaptureKind[] = ["book", "article", "note"];
const STATUSES: Capture["status"][] = ["inbox", "doing", "done"];

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
    assertSameOrigin(request);
    const { id } = await params;
    const body = await readBody<Capture>(request);

    const changes: Partial<Capture> = { updatedAt: new Date().toISOString() };
    if (body.title !== undefined) changes.title = optionalString(body.title, 200);
    if (body.author !== undefined) changes.author = optionalString(body.author, 200);
    if (body.source !== undefined) changes.source = optionalString(body.source, 500);
    if (body.summary !== undefined) changes.summary = optionalString(body.summary);
    if (body.thoughts !== undefined) changes.thoughts = optionalString(body.thoughts);
    if (body.tags !== undefined) changes.tags = uniqueStringArray(body.tags);
    if (body.domains !== undefined) {
      changes.domains = normalizeDomains(stringArray(body.domains, 12));
    }
    if (body.keyPoints !== undefined) changes.keyPoints = stringArray(body.keyPoints, 30);
    /* 枚举字段按白名单写入，别让 PATCH 成为绕过 POST 校验的后门 */
    if (KINDS.includes(body.kind as CaptureKind)) changes.kind = body.kind;
    if (STATUSES.includes(body.status as Capture["status"])) {
      changes.status = body.status;
    }
    if (typeof body.rating === "number") {
      changes.rating = Math.max(0, Math.min(5, Math.round(body.rating)));
    }

    const updated = await patch("captures", id, changes);
    if (!updated) return ok({ error: "记录不存在" }, 404);
    return ok(updated);
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const deleted = await remove("captures", id);
    if (!deleted) return ok({ error: "记录不存在" }, 404);
    return ok({ deleted: true });
  });
}
