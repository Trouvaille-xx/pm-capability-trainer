import { assertSameOrigin, fail, handle, ok, readBody, requireString, stringArray } from "@/lib/api";
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

export async function GET(request: Request) {
  return handle(async () => {
    const sessions = await readCollection("sessions");

    /* 列表页只需要摘要。会话多了以后，把每份 transcript 都传下去
       又慢又费内存，所以列表走 ?view=list。 */
    const view = new URL(request.url).searchParams.get("view");
    if (view !== "list") return ok(sessions);

    return ok(
      sessions.map(({ transcript, submission, ...rest }) => ({
        ...rest,
        turnCount: transcript.length,
        submissionLength: submission.length,
      })),
    );
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const body = await readBody<TrainingSession>(request);

    const scenario = SCENARIOS.includes(body.scenario as TrainingScenario)
      ? (body.scenario as TrainingScenario)
      : null;
    const mode = MODES.includes(body.mode as TrainingMode)
      ? (body.mode as TrainingMode)
      : null;

    if (!scenario) return fail("请选择训练场景");
    if (!mode) return fail("请选择训练模式");

    /* ---- 与记录总结 / 方法论的联动：引用必须真实存在 ---- */
    const captureId =
      typeof body.captureId === "string" ? body.captureId.trim() : "";
    if (captureId !== "") {
      const captures = await readCollection("captures");
      if (!captures.some((capture) => capture.id === captureId)) {
        return fail("关联的记录总结不存在");
      }
    }

    const requestedCardIds = stringArray(body.methodologyCardIds, 12);
    let cardIds: string[] = [];
    if (requestedCardIds.length > 0) {
      const cards = await readCollection("methodology");
      const known = new Set(cards.map((card) => card.id));
      // 认不出的卡片静默丢弃，不让一次训练因为一张卡失效就开不起来
      cardIds = requestedCardIds.filter((cardId) => known.has(cardId));
    }

    const retryOf = typeof body.retryOf === "string" ? body.retryOf.trim() : "";

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
      ...(captureId !== "" ? { captureId } : {}),
      ...(cardIds.length > 0 ? { methodologyCardIds: cardIds } : {}),
      ...(retryOf !== "" ? { retryOf } : {}),
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
