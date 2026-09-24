import { fail, handle, ok, readBody, requireString } from "@/lib/api";
import { scenarioSteps } from "@/lib/catalog";
import { newId, nowIso, readCollection, upsert } from "@/lib/store";
import type { TrainingMode, TrainingScenario, TrainingSession } from "@/lib/types";

export const dynamic = "force-dynamic";

const SCENARIOS: TrainingScenario[] = [
  "product-teardown",
  "requirement-research",
  "process-design",
];
const MODES: TrainingMode[] = ["assistant", "grill", "socratic", "solo"];

/** 产品类型是自由文本，限制一下长度避免塞进提示词过长。 */
const PRODUCT_TYPES = ["C端", "B端", "AI功能", "完整产品"];

export async function GET() {
  return handle(async () => {
    const sessions = await readCollection("sessions");
    return ok(sessions);
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const body = await readBody<TrainingSession>(request);

    const scenario = SCENARIOS.includes(body.scenario as TrainingScenario)
      ? (body.scenario as TrainingScenario)
      : null;
    const mode = MODES.includes(body.mode as TrainingMode)
      ? (body.mode as TrainingMode)
      : null;

    if (!scenario) return fail("请选择训练场景");
    if (!mode) return fail("请选择训练模式");

    const steps = scenarioSteps(scenario);
    const now = nowIso();

    const productType =
      typeof body.productType === "string" ? body.productType.trim() : "";
    const analysisGoal =
      typeof body.analysisGoal === "string" ? body.analysisGoal.trim() : "";

    const session: TrainingSession = {
      id: newId("trn"),
      scenario,
      mode,
      topic: requireString(body.topic, "训练题目", { max: 500 }),
      status: "active",
      transcript: [],
      submission: "",
      // 有分步流程的场景从第 1 步开始，其它场景为 0
      currentStep: steps.length > 0 ? 1 : 0,
      ...(PRODUCT_TYPES.includes(productType) || productType !== ""
        ? { productType: productType.slice(0, 40) }
        : {}),
      ...(analysisGoal !== "" ? { analysisGoal: analysisGoal.slice(0, 300) } : {}),
      createdAt: now,
      updatedAt: now,
    };

    await upsert("sessions", session);
    return ok(session, 201);
  });
}
