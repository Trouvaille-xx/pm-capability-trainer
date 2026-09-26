import { fail, handle, ok } from "@/lib/api";
import { classifyQuestion } from "@/lib/questions";
import { findById, patch, nowIso } from "@/lib/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 重新归类。
 *
 * 归类会自动带出「相关知识」—— 用户的回答和 AI 回答都靠自己写，
 * 但「这道题涉及哪些概念」让 AI 去知识库里找更合适，
 * 顺手把概念名跟方法论卡片对上，详情页就能直接给出入口。
 *
 * 失败时仍然返回 200 + 更新后的记录（lastError 写明原因）：
 * 归类失败不该让「重新归类」这个动作整体报错，
 * 界面拿到记录就能把原因显示出来。
 */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;

    const question = await findById("questions", id);
    if (!question) return fail("题目不存在", 404);

    try {
      const c = await classifyQuestion(question.prompt);
      const updated = await patch("questions", id, {
        kind: c.kind,
        domains: c.domains.length > 0 ? c.domains : question.domains,
        tags: c.tags.length > 0 ? c.tags : question.tags,
        // AI 返回空 related 时保留原值，不要把已有内容清掉
        related: c.related.length > 0 ? c.related : question.related,
        lastError: "",
        updatedAt: nowIso(),
      });
      return ok(updated);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "归类失败";
      console.warn("[questions/classify] 失败：", reason);
      const updated = await patch("questions", id, {
        lastError: `AI 归类没成功：${reason}`,
        updatedAt: nowIso(),
      });
      return ok(updated);
    }
  });
}
