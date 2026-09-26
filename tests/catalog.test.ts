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
