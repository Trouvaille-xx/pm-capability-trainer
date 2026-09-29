import { describe, expect, it } from "vitest";

import { DOMAINS, domainCode } from "@/lib/catalog";

describe("domainCode", () => {
  it("按 DOMAINS 的顺序从 01 起编号", () => {
    expect(domainCode("心理学")).toBe("01");
    expect(domainCode("产品设计")).toBe("04");
    // 最后一项拿到最大的编号。**不要写死具体领域名** ——
    // 之前写的是「增长与运营」，后来新增了一个领域，这条断言就误报了。
    const last = DOMAINS[DOMAINS.length - 1];
    expect(domainCode(last)).toBe(String(DOMAINS.length).padStart(2, "0"));
  });

  it("固定两位，便于对齐", () => {
    for (const domain of DOMAINS) {
      expect(domainCode(domain)).toMatch(/^\d{2}$/);
    }
  });

  it("认不出的领域返回空串（老数据里的自由字符串不该被硬编号）", () => {
    expect(domainCode("某个新领域")).toBe("");
    expect(domainCode("")).toBe("");
  });

  it("每个已知领域都有唯一编号", () => {
    const codes = DOMAINS.map(domainCode);
    expect(new Set(codes).size).toBe(DOMAINS.length);
  });
});
