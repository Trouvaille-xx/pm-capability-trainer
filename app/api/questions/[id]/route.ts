import { handle, ok, optionalString, readBody, stringArray } from "@/lib/api";
import { DOMAINS } from "@/lib/catalog";
import { readCollection, patch, remove } from "@/lib/store";
import type {
  Question,
  QuestionKind,
  QuestionStatus,
  ReadingItem,
  RelatedConcept,
} from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const KINDS: QuestionKind[] = ["interview", "thinking", "other"];
const STATUSES: QuestionStatus[] = ["open", "answered", "archived"];

/** 只接受结构正确的条目，避免脏数据进库后前端崩掉。 */
function relatedArray(value: unknown): RelatedConcept[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item): RelatedConcept[] => {
      if (!item || typeof item !== "object") return [];
      const r = item as { term?: unknown; gloss?: unknown; cardId?: unknown };
      if (typeof r.term !== "string" || r.term.trim() === "") return [];
      return [
        {
          term: r.term.trim().slice(0, 100),
          gloss: typeof r.gloss === "string" ? r.gloss.trim().slice(0, 500) : "",
          cardId: typeof r.cardId === "string" ? r.cardId : undefined,
        },
      ];
    })
    .slice(0, 8);
}

function readingArray(value: unknown): ReadingItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item): ReadingItem[] => {
      if (!item || typeof item !== "object") return [];
      const r = item as Record<string, unknown>;
      if (typeof r.title !== "string" || r.title.trim() === "") return [];
      const url = typeof r.url === "string" ? r.url.trim() : "";
      // 只放行 http(s)，避免把 javascript: 之类的塞进 <a href>
      if (url !== "" && !/^https?:\/\//i.test(url)) return [];
      return [
        {
          title: r.title.trim().slice(0, 300),
          source: typeof r.source === "string" ? r.source.trim().slice(0, 200) : "",
          url,
          why: typeof r.why === "string" ? r.why.trim().slice(0, 500) : "",
        },
      ];
    })
    .slice(0, 10);
}

export async function GET(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const all = await readCollection("questions");
    const found = all.find((q) => q.id === id);
    if (!found) return ok({ error: "题目不存在" }, 404);
    return ok(found);
  });
}

export async function PATCH(request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const body = await readBody<Question>(request);

    const changes: Partial<Question> = { updatedAt: new Date().toISOString() };

    if (body.prompt !== undefined) changes.prompt = optionalString(body.prompt, 2000);
    if (body.source !== undefined) changes.source = optionalString(body.source, 100);

    if (body.kind !== undefined && KINDS.includes(body.kind as QuestionKind)) {
      changes.kind = body.kind as QuestionKind;
    }

    if (body.domains !== undefined) {
      changes.domains = stringArray(body.domains, 3).filter((d) =>
        (DOMAINS as readonly string[]).includes(d),
      );
    }
    if (body.tags !== undefined) changes.tags = stringArray(body.tags, 5);
    if (body.related !== undefined) changes.related = relatedArray(body.related);
    if (body.readings !== undefined) changes.readings = readingArray(body.readings);

    if (body.myAnswer !== undefined) {
      changes.myAnswer = optionalString(body.myAnswer);
      changes.myAnsweredAt =
        changes.myAnswer.trim() === "" ? "" : new Date().toISOString();
      // 写了回答但状态还停在 open，就自动推进到 answered ——
      // 否则「待作答」筛选里会出现已经答过的题。
      if (changes.myAnswer.trim() !== "") changes.status = "answered";
    }

    if (body.aiAnswer !== undefined) {
      changes.aiAnswer = optionalString(body.aiAnswer);
      changes.aiAnsweredAt = changes.aiAnswer.trim() === "" ? "" : new Date().toISOString();
    }

    if (
      body.status !== undefined &&
      STATUSES.includes(body.status as QuestionStatus)
    ) {
      changes.status = body.status as QuestionStatus;
    }

    // 手动改 / 清错误信息
    if ("lastError" in body) changes.lastError = optionalString(body.lastError, 500);

    const updated = await patch("questions", id, changes);
    if (!updated) return ok({ error: "题目不存在" }, 404);
    return ok(updated);
  });
}

export async function DELETE(_request: Request, { params }: Params) {
  return handle(async () => {
    const { id } = await params;
    const deleted = await remove("questions", id);
    if (!deleted) return ok({ error: "题目不存在" }, 404);
    return ok({ deleted: true });
  });
}
