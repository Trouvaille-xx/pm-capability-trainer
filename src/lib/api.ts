/** API 路由的通用响应与错误处理。 */

import { NextResponse } from "next/server";

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** 统一兜底：把异常转成 { error } 结构，避免前端拿到 HTML 错误页。 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "服务器内部错误，请查看终端日志";
    console.error("[api]", error);
    const status =
      typeof (error as { status?: number }).status === "number"
        ? (error as { status: number }).status
        : 500;
    return fail(message, status);
  }
}

/** 读取并解析 JSON 请求体，空体返回 {}。 */
export async function readBody<T>(request: Request): Promise<Partial<T>> {
  try {
    const raw = await request.text();
    if (raw.trim() === "") return {};
    return JSON.parse(raw) as Partial<T>;
  } catch {
    throw Object.assign(new Error("请求体不是合法 JSON"), { status: 400 });
  }
}

export function requireString(
  value: unknown,
  field: string,
  { max = 20000 }: { max?: number } = {},
): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw Object.assign(new Error(`字段「${field}」不能为空`), { status: 400 });
  }
  if (value.length > max) {
    throw Object.assign(
      new Error(`字段「${field}」超长（上限 ${max} 字符）`),
      { status: 400 },
    );
  }
  return value.trim();
}

export function optionalString(value: unknown, max = 20000): string {
  if (typeof value !== "string") return "";
  return value.slice(0, max).trim();
}

export function stringArray(value: unknown, max = 50): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, max);
}
