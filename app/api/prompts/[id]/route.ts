import { handle, ok, optionalString, readBody } from "@/lib/api";
import { patch, remove } from "@/lib/store";
import type { PromptTemplate } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody<PromptTemplate>(request);

    const changes: Partial<PromptTemplate> = {
      updatedAt: new Date().toISOString(),
    };
    if (body.name !== undefined) changes.name = optionalString(body.name, 100);
    if (body.system !== undefined) changes.system = optionalString(body.system, 20000);
    if (body.scope !== undefined) changes.scope = body.scope;
    if (body.mode !== undefined) changes.mode = body.mode;
    if (body.enabled !== undefined) changes.enabled = body.enabled === true;

    const updated = await patch("prompts", id, changes);
    if (!updated) return ok({ error: "提示词不存在" }, 404);
    return ok(updated);
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const deleted = await remove("prompts", id);
    if (!deleted) return ok({ error: "提示词不存在" }, 404);
    return ok({ deleted: true, note: "内置模板删除后，重启不会自动恢复；如需恢复请删除 data/prompts.json" });
  });
}
