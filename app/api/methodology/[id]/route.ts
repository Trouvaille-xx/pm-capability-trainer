import { assertSameOrigin, handle, ok, optionalString, readBody, requireString, stringArray } from "@/lib/api";
import { normalizeDomain } from "@/lib/catalog";
import { patch, remove } from "@/lib/store";
import type { MethodologyCard, TrainingScenario } from "@/lib/types";

export const dynamic = "force-dynamic";

const SCENARIOS: TrainingScenario[] = [
  "product-teardown",
  "requirement-research",
  "process-design",
];

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const body = await readBody<MethodologyCard>(request);

    const changes: Partial<MethodologyCard> = {
      updatedAt: new Date().toISOString(),
    };
    /* 必填字段用 requireString：PATCH 不该能把 domain / title / oneLiner 清空 */
    if (body.domain !== undefined) {
      changes.domain = normalizeDomain(
        requireString(body.domain, "领域", { max: 50 }),
      );
    }
    if (body.title !== undefined) {
      changes.title = requireString(body.title, "知识点名称", { max: 100 });
    }
    if (body.oneLiner !== undefined) {
      changes.oneLiner = requireString(body.oneLiner, "一句话定义", { max: 500 });
    }
    if (body.detail !== undefined) changes.detail = optionalString(body.detail);
    if (body.boundary !== undefined) changes.boundary = optionalString(body.boundary);
    if (body.pitfalls !== undefined) changes.pitfalls = optionalString(body.pitfalls);
    if (body.howToUse !== undefined) changes.howToUse = optionalString(body.howToUse);
    if (body.example !== undefined) changes.example = optionalString(body.example);
    // 与 POST 一致：过滤掉不在白名单里的场景，而不是强转
    if (body.scenarios !== undefined) {
      changes.scenarios = stringArray(body.scenarios, 3).filter(
        (s): s is TrainingScenario => SCENARIOS.includes(s as TrainingScenario),
      );
    }
    if (body.sourceCaptureIds !== undefined) {
      changes.sourceCaptureIds = stringArray(body.sourceCaptureIds, 20);
    }
    if (body.sourceNote !== undefined) {
      changes.sourceNote = optionalString(body.sourceNote, 300);
    }

    const updated = await patch("methodology", id, changes);
    if (!updated) return ok({ error: "知识点不存在" }, 404);
    return ok(updated);
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const deleted = await remove("methodology", id);
    if (!deleted) return ok({ error: "知识点不存在" }, 404);
    return ok({ deleted: true });
  });
}
