import { describe, expect, it } from "vitest";

import {
  AI_FILLABLE,
  applyField,
  buildCardSnapshot,
  classifyProposal,
  coerceDraftForm,
  draftFromCard,
  emptyDraft,
  isBlank,
  normalizeDraft,
  type DraftForm,
} from "@/lib/methodology-draft";
import type { MethodologyCard } from "@/lib/types";

/**
 * 「只补空字段」这条规则的实现处。
 *
 * 它是这个功能唯一有判断的地方 —— AI 补哪儿、哪儿要问用户 —— 所以单独钉死：
 * 已填的字段绝不被静默覆盖，这是用户能不能信任它的前提。
 */

function form(partial: Partial<DraftForm> = {}): DraftForm {
  return { ...emptyDraft(), title: "损失厌恶", ...partial };
}

describe("isBlank", () => {
  it("纯空白算空", () => {
    expect(isBlank("")).toBe(true);
    expect(isBlank("   \n ")).toBe(true);
    expect(isBlank("有字")).toBe(false);
  });

  it("scenarios 按条数算", () => {
    expect(isBlank([])).toBe(true);
    expect(isBlank(["product-teardown"])).toBe(false);
  });
});

describe("classifyProposal：只补空的", () => {
  it("字段是空的 → 静默填入", () => {
    const f = form({ detail: "" });
    const { fills, changes } = classifyProposal(f, {
      filled: { detail: "AI 写的展开说明" },
      revisions: [],
    });
    expect(fills.detail).toBe("AI 写的展开说明");
    expect(changes).toHaveLength(0);
  });

  it("字段已经有内容 → 绝不静默覆盖（直接丢弃）", () => {
    const f = form({ detail: "我自己写的" });
    const { fills, changes } = classifyProposal(f, {
      filled: { detail: "AI 想换掉的" },
      revisions: [],
    });
    expect(fills.detail).toBeUndefined();
    expect(changes).toHaveLength(0);
  });

  it("已填字段的改动只能走 revisions，变成「待确认」", () => {
    const f = form({ detail: "我自己写的" });
    const { fills, changes } = classifyProposal(f, {
      filled: {},
      revisions: [{ field: "detail", value: "建议改成这样", why: "原句太笼统" }],
    });
    expect(fills.detail).toBeUndefined();
    expect(changes).toHaveLength(1);
    expect(changes[0].value).toBe("建议改成这样");
  });

  it("提议和原文一样 → 不打扰用户", () => {
    const f = form({ detail: "一样的" });
    const { changes } = classifyProposal(f, {
      filled: {},
      revisions: [{ field: "detail", value: "一样的", why: "…" }],
    });
    expect(changes).toHaveLength(0);
  });

  it("未知字段被丢掉", () => {
    const { fills } = classifyProposal(form(), {
      filled: { 不存在的字段: "x" } as never,
      revisions: [],
    });
    expect(Object.keys(fills)).toHaveLength(0);
  });

  it("title 与 domain 不在可补范围里", () => {
    expect(AI_FILLABLE).not.toContain("title");
    expect(AI_FILLABLE).not.toContain("domain");
  });
});

describe("normalizeDraft：服务端那一层过滤", () => {
  it("非空字段的 filled 会被剥掉（模型越界也拦得住）", () => {
    const f = form({ detail: "用户写的" });
    const out = normalizeDraft(
      { filled: { detail: "AI 想覆盖的", boundary: "边界" } },
      f,
    );
    expect(out.filled.detail).toBeUndefined();
    expect(out.filled.boundary).toBe("边界");
  });

  it("未知字段丢弃、类型不对丢弃", () => {
    const out = normalizeDraft(
      { filled: { 乱七八糟: "x", detail: 123, boundary: "有效" } },
      form(),
    );
    expect(Object.keys(out.filled)).toEqual(["boundary"]);
  });

  it("scenarios 过滤白名单并限量", () => {
    const out = normalizeDraft(
      {
        filled: {
          scenarios: ["product-teardown", "不存在的场景", "process-design"],
        },
      },
      form(),
    );
    expect(out.filled.scenarios).toEqual(["product-teardown", "process-design"]);
  });

  it("revisions 只保留「已知 + 原字段非空 + 值确实不同」的", () => {
    const f = form({ detail: "原文", boundary: "" });
    const out = normalizeDraft(
      {
        revisions: [
          { field: "detail", value: "新文", why: "理由" },
          { field: "boundary", value: "空字段不该走 revisions", why: "" },
          { field: "detail2", value: "未知字段", why: "" },
        ],
      },
      f,
    );
    expect(out.revisions).toHaveLength(1);
    expect(out.revisions[0].field).toBe("detail");
  });

  it("字符串超长会被裁到上限", () => {
    const out = normalizeDraft(
      { filled: { sourceNote: "x".repeat(500) } },
      form(),
    );
    expect((out.filled.sourceNote as string).length).toBe(300);
  });
});

describe("buildCardSnapshot", () => {
  it("每个字段都出现，空字段标成（空）", () => {
    const snap = buildCardSnapshot(form({ detail: "有内容" }));
    expect(snap).toContain("知识点名称：损失厌恶");
    expect(snap).toContain("展开说明：有内容");
    expect(snap).toContain("边界：（空）");
  });
});

describe("coerceDraftForm：不信客户端传来的形状", () => {
  it("乱七八糟的输入被收敛成合法草稿", () => {
    const out = coerceDraftForm({ title: 123, scenarios: "x", detail: "  ok  " });
    expect(out.title).toBe("");
    expect(out.scenarios).toEqual([]);
    expect(out.detail).toBe("ok");
    // 领域有兜底，不会是空串
    expect(out.domain).not.toBe("");
  });

  it("完全不是对象也不炸", () => {
    expect(coerceDraftForm(null).title).toBe("");
  });
});

describe("applyField", () => {
  it("写入 scenarios 用数组", () => {
    const next = applyField(form(), "scenarios", ["requirement-research"]);
    expect(next.scenarios).toEqual(["requirement-research"]);
  });

  it("写入文本字段用字符串", () => {
    const next = applyField(form(), "boundary", "边界说明");
    expect(next.boundary).toBe("边界说明");
    expect(next.scenarios).toEqual([]);
  });
});

describe("draftFromCard", () => {
  it("把卡片的字段灌进草稿（含新开入口的三个）", () => {
    const card: MethodologyCard = {
      id: "mth-1",
      domain: "心理学",
      title: "损失厌恶",
      oneLiner: "一句话",
      detail: "展开",
      boundary: "边界",
      pitfalls: "误区",
      howToUse: "怎么用",
      example: "例子",
      scenarios: ["product-teardown"],
      sourceCaptureIds: ["cap-1"],
      sourceNote: "来源",
      builtin: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const draft = draftFromCard(card);
    expect(draft.boundary).toBe("边界");
    expect(draft.pitfalls).toBe("误区");
    expect(draft.sourceNote).toBe("来源");
    expect(draft.scenarios).toEqual(["product-teardown"]);
  });
});
