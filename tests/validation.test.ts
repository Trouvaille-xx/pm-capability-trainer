import { describe, expect, it } from "vitest";

import { optionalString, requireString, stringArray, uniqueStringArray } from "@/lib/api";

describe("stringArray", () => {
  it("只保留非空字符串并去掉首尾空格", () => {
    expect(stringArray([" a ", "", "b", 1, null, "  "])).toEqual(["a", "b"]);
  });

  it("非数组直接返回空", () => {
    expect(stringArray("a,b")).toEqual([]);
    expect(stringArray(null)).toEqual([]);
  });
});

describe("uniqueStringArray", () => {
  it("去掉重复项（回归：标签重复会被原样写回）", () => {
    expect(uniqueStringArray(["定价", "心理学", "定价"])).toEqual(["定价", "心理学"]);
  });

  it("先去重再截断，重复项不会挤掉有效项", () => {
    expect(uniqueStringArray(["a", "a", "a", "b", "c"], 2)).toEqual(["a", "b"]);
  });
});

describe("requireString", () => {
  it("空值抛错", () => {
    expect(() => requireString("  ", "标题")).toThrow(/不能为空/);
    expect(() => requireString(undefined, "标题")).toThrow(/不能为空/);
  });

  it("超长抛错，带上字段名", () => {
    expect(() => requireString("x".repeat(11), "标题", { max: 10 })).toThrow(
      /标题.*超长/,
    );
  });

  it("正常值返回去空格后的结果", () => {
    expect(requireString("  拆解小红书  ", "题目")).toBe("拆解小红书");
  });
});

describe("optionalString", () => {
  it("非字符串返回空串而不是抛错", () => {
    expect(optionalString(undefined)).toBe("");
    expect(optionalString(123)).toBe("");
  });

  it("按上限截断", () => {
    expect(optionalString("abcdef", 3)).toBe("abc");
  });
});
