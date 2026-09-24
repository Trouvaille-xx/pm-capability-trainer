import { handle, ok, optionalString, readBody, stringArray } from "@/lib/api";
import { patch, remove } from "@/lib/store";
import type { MethodologyCard } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody<MethodologyCard>(request);

    const changes: Partial<MethodologyCard> = {
      updatedAt: new Date().toISOString(),
    };
    if (body.domain !== undefined) changes.domain = optionalString(body.domain, 50);
    if (body.title !== undefined) changes.title = optionalString(body.title, 100);
    if (body.oneLiner !== undefined) changes.oneLiner = optionalString(body.oneLiner, 500);
    if (body.detail !== undefined) changes.detail = optionalString(body.detail);
    if (body.howToUse !== undefined) changes.howToUse = optionalString(body.howToUse);
    if (body.example !== undefined) changes.example = optionalString(body.example);
    if (body.scenarios !== undefined) changes.scenarios = stringArray(body.scenarios, 3) as MethodologyCard["scenarios"];
    if (body.sourceCaptureIds !== undefined) {
      changes.sourceCaptureIds = stringArray(body.sourceCaptureIds, 20);
    }

    const updated = await patch("methodology", id, changes);
    if (!updated) return ok({ error: "知识点不存在" }, 404);
    return ok(updated);
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const deleted = await remove("methodology", id);
    if (!deleted) return ok({ error: "知识点不存在" }, 404);
    return ok({ deleted: true });
  });
}
