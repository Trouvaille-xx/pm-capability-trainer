import { describe, expect, it } from "vitest";

import { parseJsonLoose } from "@/lib/ai";

describe("parseJsonLoose", () => {
  it("直接解析干净 JSON", () => {
    expect(parseJsonLoose<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("剥掉 ```json 围栏", () => {
    expect(parseJsonLoose<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("去掉对象前后的解释性文字", () => {
    expect(parseJsonLoose<{ a: number }>('好的，这是结果：\n{"a":1}\n希望有帮助')).toEqual({
      a: 1,
    });
  });

  it("修掉尾逗号", () => {
    expect(parseJsonLoose<{ a: number; b: number }>('{"a":1,"b":2,}')).toEqual({
      a: 1,
      b: 2,
    });
  });

  it("转义字符串里的裸换行", () => {
    const raw = '{"summary":"第一行\n第二行"}';
    expect(parseJsonLoose<{ summary: string }>(raw)).toEqual({
      summary: "第一行\n第二行",
    });
  });

  it("实在解析不了时抛出可读的错误", () => {
    expect(() => parseJsonLoose("完全不是 JSON")).toThrow(/无法从模型输出中解析/);
  });
});
