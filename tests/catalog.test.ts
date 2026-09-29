import { describe, expect, it } from "vitest";

import { DOMAINS, isKnownDomain, normalizeDomain, normalizeDomains } from "@/lib/catalog";

describe("领域收敛", () => {
  it("已知领域原样保留", () => {
    for (const domain of DOMAINS) {
      expect(normalizeDomain(domain)).toBe(domain);
      expect(isKnownDomain(domain)).toBe(true);
    }
  });

  it("历史别名映射到规范名", () => {
    expect(normalizeDomain("数据分析")).toBe("数据与分析");
    expect(normalizeDomain("增长运营")).toBe("增长与运营");
    expect(normalizeDomain("用户调研")).toBe("用户研究");
    expect(normalizeDomain("  战略  ")).toBe("商业与战略");
  });

  it("认不出的领域原样保留，不丢用户填的东西", () => {
    expect(normalizeDomain("某个新领域")).toBe("某个新领域");
    expect(normalizeDomain("")).toBe("");
  });

  it("批量收敛会去重并丢掉空值", () => {
    expect(normalizeDomains(["数据分析", "数据与分析", "", "  ", "心理学"])).toEqual([
      "数据与分析",
      "心理学",
    ]);
  });
});

describe("提示词作用域的两级分组", () => {
  it("方法论模块的两个 scope 都在目录里，且归在「方法论」下", async () => {
    const { PROMPT_SCOPES, PROMPT_MODULES } = await import("@/lib/catalog");
    for (const id of ["methodology-clarify", "methodology-generate"]) {
      const entry = PROMPT_SCOPES.find((s) => s.id === id);
      expect(entry, id).toBeTruthy();
      expect(entry?.module).toBe("方法论");
      // 「什么时候用到它」必须写清楚，列表收起时要靠它认人
      expect(entry?.when).toBeTruthy();
    }
    expect(PROMPT_MODULES.map((m) => m.id)).toContain("方法论");
  });
});

describe("方法论的种子提示词", () => {
  it("seedPrompts 里有澄清与补全两条，且内容非空", async () => {
    const { seedPrompts } = await import("@/lib/seed");
    const seeded = seedPrompts();
    for (const id of ["methodology-clarify", "methodology-generate"]) {
      const t = seeded.find((x) => x.scope === id);
      expect(t, id).toBeTruthy();
      expect(t!.system.trim().length).toBeGreaterThan(50);
    }
  });

  it("补全那条把「只补空字段」写死在提示词里", async () => {
    const { seedPrompts } = await import("@/lib/seed");
    const t = seedPrompts().find((x) => x.scope === "methodology-generate");
    expect(t!.system).toContain("只补空");
  });
});
