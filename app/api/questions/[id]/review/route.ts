import { fail, handle, ok } from "@/lib/api";
import { reviewAnswer } from "@/lib/questions";
import { findById, nowIso, patch } from "@/lib/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 批改「我的回答」。
 *
 * 不流式：评分是一份结构化结果（五个维度的分数 + 评语 + 建议），
 * 边算边出没有意义，反而会让界面一直跳。等两三秒给一个完整结果更好。
 *
 * 没写回答就直接拒绝 —— 让模型去评一份空回答，只会得到一段
 * 「你没有作答」的废话，还白花一次调用。
 */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;

    const question = await findById("questions", id);
    if (!question) return fail("题目不存在", 404);

    if (!question.myAnswer.trim()) {
      return fail("还没写「我的回答」，先写一遍再来评分。", 400);
    }

    let review;
    try {
      review = await reviewAnswer(question);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "评分失败";
      console.warn("[questions/review] 失败：", reason);
      await patch("questions", id, {
        lastError: `评分没做成：${reason}`,
        updatedAt: nowIso(),
      });
      return fail(reason, 400);
    }

    const updated = await patch("questions", id, {
      review,
      lastError: "",
      updatedAt: nowIso(),
    });
    return ok(updated);
  });
}
