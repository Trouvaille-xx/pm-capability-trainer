import { fail, handle, ok } from "@/lib/api";
import { suggestReadings } from "@/lib/questions";
import { findById, patch, nowIso } from "@/lib/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 推荐阅读：联网搜一轮，再让模型从结果里挑出值得读的。
 *
 * 不流式 —— 搜索本身就要几秒，而且最终产出是 3-4 条结构化条目，
 * 边搜边出会让界面一直在跳。这里宁可等两三秒给一个完整列表。
 *
 * 失败时返回 400 + { error }：跟归类不同，搜索失败通常是因为
 * 「没配 Key」或「Key 不对」，用户需要看到具体原因去修设置。
 */
export async function POST(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;

    const question = await findById("questions", id);
    if (!question) return fail("题目不存在", 404);

    let readings;
    try {
      readings = await suggestReadings(question);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "推荐失败";
      console.warn("[questions/readings] 失败：", reason);
      await patch("questions", id, {
        lastError: `推荐阅读没生成：${reason}`,
        updatedAt: nowIso(),
      });
      return fail(reason, 400);
    }

    if (readings.length === 0) {
      const updated = await patch("questions", id, {
        lastError: "搜索到了结果，但没有挑出值得读的。可以换个模型再试。",
        updatedAt: nowIso(),
      });
      return ok(updated);
    }

    const updated = await patch("questions", id, {
      readings,
      lastError: "",
      updatedAt: nowIso(),
    });
    return ok(updated);
  });
}
