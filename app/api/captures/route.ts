import { assertSameOrigin, fail, handle, ok, optionalString, readBody, requireString, stringArray, uniqueStringArray } from "@/lib/api";
import { normalizeDomains } from "@/lib/catalog";
import { newId, nowIso, readCollection, upsert } from "@/lib/store";
import type { Capture, CaptureKind } from "@/lib/types";

export const dynamic = "force-dynamic";

const KINDS: CaptureKind[] = ["book", "article", "note"];

export async function GET() {
  return handle(async () => {
    const captures = await readCollection("captures");
    return ok(captures);
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);
    const body = await readBody<Capture>(request);
    const kind = KINDS.includes(body.kind as CaptureKind)
      ? (body.kind as CaptureKind)
      : "note";

    const now = nowIso();
    const capture: Capture = {
      id: newId("cap"),
      kind,
      title: requireString(body.title, "标题", { max: 200 }),
      author: optionalString(body.author, 200),
      source: optionalString(body.source, 500),
      status: ["inbox", "doing", "done"].includes(String(body.status))
        ? (body.status as Capture["status"])
        : "inbox",
      tags: uniqueStringArray(body.tags),
      summary: optionalString(body.summary),
      keyPoints: stringArray(body.keyPoints, 30),
      thoughts: optionalString(body.thoughts),
      rating: typeof body.rating === "number" ? Math.max(0, Math.min(5, Math.round(body.rating))) : 0,
      domains: normalizeDomains(stringArray(body.domains, 12)),
      createdAt: now,
      updatedAt: now,
    };

    /* 这里**不再要求**「总结 / 要点 / 思考」至少有一项。
       现在的流程是：弹窗只收「标题 + 类型」（快速钉一张便签），
       内容在接下来的编辑页里补 —— 刚创建时正文为空是正常状态，
       不是错误。status 默认 inbox 就是为这个「还没写」的阶段准备的。 */
    await upsert("captures", capture);
    return ok(capture, 201);
  });
}
