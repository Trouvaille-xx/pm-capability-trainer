import { assertSameOrigin, handle, ok, readBody, requireString } from "@/lib/api";
import { newId, nowIso, readCollection, upsert } from "@/lib/store";
import type { PromptScope, PromptTemplate } from "@/lib/types";

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
    const scope = SCOPES.includes(body.scope as PromptScope)
      ? (body.scope as PromptScope)
      : "chat";
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
