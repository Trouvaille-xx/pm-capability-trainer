/** API 路由的通用响应与错误处理。 */

import { NextResponse } from "next/server";

/** 请求体上限。本地应用，但别让一个畸形请求把内存吃满。 */
const MAX_BODY_BYTES = 2 * 1024 * 1024;

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(message: string, status = 400): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * 统一兜底：把异常转成 { error } 结构，避免前端拿到 HTML 错误页。
 *
 * 5xx 对外只说「服务器内部错误」——原始信息里可能有文件路径、
 * 上游响应体等不该给浏览器看的东西，细节只进终端日志。
 * 4xx 是我们自己抛的校验错误，文案本来就是写给用户看的，原样返回。
 */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (error) {
    console.error("[api]", error);
    const status =
      typeof (error as { status?: number }).status === "number"
        ? (error as { status: number }).status
        : 500;
    if (status >= 500) {
      return fail("服务器内部错误，请查看终端日志", status);
    }
    const message =
      error instanceof Error ? error.message : "请求有误，请检查后重试";
    return fail(message, status);
  }
}

/**
 * 变更加路由的同源校验。
 *
 * 服务跑在本机，但浏览器里的任意网页都能向 localhost:3000 发请求。
 * 只放行同源请求：跨站直接拒。
 *
 * 对没有 Origin 的请求（curl、本地脚本）保持放行——否则本地调试全废，
 * 而这类请求本来也不受浏览器同源策略保护、不构成 CSRF。
 */
export function assertSameOrigin(request: Request): void {
  const site = request.headers.get("sec-fetch-site");
  if (site === "cross-site") {
    throw Object.assign(new Error("已拒绝跨站请求"), { status: 403 });
  }

  const origin = request.headers.get("origin");
  if (!origin) return;

  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw Object.assign(new Error("已拒绝来源不明的请求"), { status: 403 });
  }

  const host = request.headers.get("host");
  if (host && originHost !== host) {
    throw Object.assign(new Error("已拒绝跨站请求"), { status: 403 });
  }
}

/** 读取并解析 JSON 请求体，空体返回 {}。 */
export async function readBody<T>(request: Request): Promise<Partial<T>> {
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw Object.assign(new Error("请求体过大"), { status: 413 });
  }

  let raw: string;
  try {
    raw = await request.text();
  } catch {
    throw Object.assign(new Error("读取请求体失败"), { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) {
    throw Object.assign(new Error("请求体过大"), { status: 413 });
  }
  if (raw.trim() === "") return {};

  try {
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

/**
 * 同 stringArray，但去掉重复项。
 *
 * 标签这类字段重复没有意义，而用户很容易贴两遍。先去重再截断，
 * 免得重复项把有效标签挤出去。
 */
export function uniqueStringArray(value: unknown, max = 50): string[] {
  return Array.from(new Set(stringArray(value, Number.MAX_SAFE_INTEGER))).slice(
    0,
    max,
  );
}
