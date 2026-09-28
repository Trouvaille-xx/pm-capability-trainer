import { assertSameOrigin, handle, ok, readBody, requireString } from "@/lib/api";
import { PROMPT_SCOPES } from "@/lib/catalog";
import { newId, nowIso, readCollection, upsert } from "@/lib/store";
import type { PromptScope, PromptTemplate } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * 合法 scope 从目录派生，不在路由里手抄一份 ——
 * 抄一份的后果是加新 scope 时漏掉某个路由，POST 能建、PATCH 改不了，
 * 或者反过来，静默降级成 "chat" 把用户的模板塞错地方。
 */
const SCOPES: PromptScope[] = PROMPT_SCOPES.map((s) => s.id);

export async function GET() {
  return handle(async () => {
    const prompts = await readCollection("prompts");
    return ok(prompts);
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const body = await readBody<PromptTemplate>(request);
    const scope = body.scope as PromptScope;
    if (!SCOPES.includes(scope)) {
      return ok({ error: `不认识的作用域「${body.scope}」` }, 400);
    }
    const now = nowIso();

    const template: PromptTemplate = {
      id: newId("prm"),
      name: requireString(body.name, "模板名称", { max: 100 }),
      scope,
      mode: body.mode,
      system: requireString(body.system, "提示词内容", { max: 20000 }),
      enabled: body.enabled !== false,
      builtin: false,
      createdAt: now,
      updatedAt: now,
    };

    await upsert("prompts", template);
    return ok(template, 201);
  });
}
