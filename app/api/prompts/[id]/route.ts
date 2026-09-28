import { assertSameOrigin, handle, ok, readBody, requireString } from "@/lib/api";
import { PROMPT_SCOPES } from "@/lib/catalog";
import { patch, readCollection, remove, retirePromptScope } from "@/lib/store";
import type { PromptScope, PromptTemplate, TrainingMode } from "@/lib/types";

export const dynamic = "force-dynamic";

/* scope 白名单从目录派生，与 POST 用的是同一张表（见 app/api/prompts/route.ts） */
const SCOPES: PromptScope[] = PROMPT_SCOPES.map((s) => s.id);

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

    /* 删之前先看一眼：内置模板被删掉后要记一笔，
       否则下次读取会因为「种子里有、文件里没有」把它补回来 —— 等于删不掉。 */
    const target = (await readCollection("prompts")).find((p) => p.id === id);

    const deleted = await remove("prompts", id);
    if (!deleted) return ok({ error: "提示词不存在" }, 404);

    if (target?.builtin) {
      await retirePromptScope(target.scope);
    }

    return ok({
      deleted: true,
      note: "这条不会再被自动补回来。想恢复内置文案，需要在「提示词管理」里新建一条同名作用域的模板。",
    });
  });
}
