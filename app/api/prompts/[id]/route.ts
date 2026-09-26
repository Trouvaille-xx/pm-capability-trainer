import { assertSameOrigin, handle, ok, readBody, requireString } from "@/lib/api";
import { patch, remove } from "@/lib/store";
import type { PromptScope, PromptTemplate, TrainingMode } from "@/lib/types";

export const dynamic = "force-dynamic";

const SCOPES: PromptScope[] = [
  "product-teardown",
  "requirement-research",
  "process-design",
  "assistant",
  "grill",
  "socratic",
  "solo",
  "report",
  "chat",
];

const MODES: TrainingMode[] = ["assistant", "grill", "socratic", "solo"];

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const body = await readBody<PromptTemplate>(request);

    const changes: Partial<PromptTemplate> = {
      updatedAt: new Date().toISOString(),
    };
    // 名称与内容不允许被 PATCH 清空，枚举按白名单写入（与 POST 一致）
    if (body.name !== undefined) {
      changes.name = requireString(body.name, "模板名称", { max: 100 });
    }
    if (body.system !== undefined) {
      changes.system = requireString(body.system, "提示词内容", { max: 20000 });
    }
    if (SCOPES.includes(body.scope as PromptScope)) {
      changes.scope = body.scope;
    }
    if (MODES.includes(body.mode as TrainingMode)) {
      changes.mode = body.mode;
    }
    if (body.enabled !== undefined) changes.enabled = body.enabled === true;

    const updated = await patch("prompts", id, changes);
    if (!updated) return ok({ error: "提示词不存在" }, 404);
    return ok(updated);
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const deleted = await remove("prompts", id);
    if (!deleted) return ok({ error: "提示词不存在" }, 404);
    return ok({ deleted: true, note: "内置模板删除后，重启不会自动恢复；如需恢复请删除 data/prompts.json" });
  });
}
