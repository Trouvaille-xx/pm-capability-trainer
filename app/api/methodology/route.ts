import { assertSameOrigin, handle, ok, optionalString, readBody, requireString, stringArray } from "@/lib/api";
import { normalizeDomain } from "@/lib/catalog";
import { newId, nowIso, readCollection, upsert } from "@/lib/store";
import type { MethodologyCard, TrainingScenario } from "@/lib/types";

export const dynamic = "force-dynamic";

const SCENARIOS: TrainingScenario[] = [
  "product-teardown",
  "requirement-research",
  "process-design",
];

export async function GET() {
  return handle(async () => {
    const cards = await readCollection("methodology");
    return ok(cards);
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const body = await readBody<MethodologyCard>(request);
    const now = nowIso();

    const card: MethodologyCard = {
      id: newId("mth"),
      domain: normalizeDomain(requireString(body.domain, "领域", { max: 50 })),
      title: requireString(body.title, "知识点名称", { max: 100 }),
      oneLiner: requireString(body.oneLiner, "一句话定义", { max: 500 }),
      detail: optionalString(body.detail),
      howToUse: optionalString(body.howToUse),
      example: optionalString(body.example),
      scenarios: stringArray(body.scenarios, 3).filter((s): s is TrainingScenario =>
        SCENARIOS.includes(s as TrainingScenario),
      ),
      sourceCaptureIds: stringArray(body.sourceCaptureIds, 20),
      builtin: false,
      createdAt: now,
      updatedAt: now,
    };

    await upsert("methodology", card);
    return ok(card, 201);
  });
}
