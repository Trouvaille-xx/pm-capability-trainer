/**
 * OpenAI 兼容的模型客户端。
 *
 * 平台不绑定任何一家供应商：baseURL / apiKey / model 都来自「辅助系统」里的配置，
 * 因此可以指向 opencode zen、DeepSeek 官方、OpenAI 或任何兼容端点。
 */

import { readSettings } from "./store";
import type { AISettings } from "./types";

/** 模型请求调用一个工具。 */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** 暴露给模型的工具定义（OpenAI function calling 格式）。 */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/**
 * 会话消息。
 *
 * 比最开始的 {role, content} 宽：支持助手请求调用工具（tool_calls）
 * 以及把工具结果回灌（role: "tool"）。不带工具的调用方写法不变。
 */
export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; content: string; tool_call_id: string; name?: string };

export class AIRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AIRequestError";
    this.status = status;
  }
}

function trimBase(baseURL: string): string {
  return baseURL.replace(/\/+$/, "");
}

function endpoint(settings: AISettings): string {
  return `${trimBase(settings.baseURL)}/chat/completions`;
}

/**
 * 请求头。
 *
 * `x-opencode-session` 是 OpenCode Zen / Go 网关要求的路由与缓存亲和标识：
 * 缺失时该网关会直接返回 400 MissingSessionID。对其它 OpenAI 兼容端点而言
 * 它只是一个会被忽略的额外头，所以统一带上没有副作用。
 * 传入的值是训练会话 id，因此天然是「一次对话一个稳定 id」。
 */
function requestHeaders(
  settings: AISettings,
  sessionId?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${settings.apiKey}`,
  };
  if (sessionId) headers["x-opencode-session"] = sessionId;
  return headers;
}

/** 把供应商返回的错误体，整理成一句人能看懂的中文。 */
function describeError(status: number, body: string): string {
  const snippet = body.slice(0, 500);
  if (status === 401 || status === 403) {
    return `鉴权失败（HTTP ${status}）。请在「辅助系统 → AI 配置」里检查 API Key 是否正确、是否有该模型的权限。原始返回：${snippet}`;
  }
  if (status === 404) {
    return `接口不存在（HTTP 404）。请检查 Base URL 是否包含 /v1，以及模型名是否正确。原始返回：${snippet}`;
  }
  if (status === 429) {
    return `触发限流（HTTP 429）。稍后重试，或换一个模型。原始返回：${snippet}`;
  }
  return `模型接口返回 HTTP ${status}：${snippet}`;
}

async function resolveSettings(): Promise<AISettings> {
  const settings = await readSettings();
  if (!settings.baseURL) throw new AIRequestError("尚未配置 Base URL", 0);
  if (!settings.model) throw new AIRequestError("尚未配置模型名", 0);
  return settings;
}

function isLocalEndpoint(baseURL: string): boolean {
  return /localhost|127\.0\.0\.1|\[::1\]/.test(baseURL);
}

function missingKeyHint(settings: AISettings): string {
  return isLocalEndpoint(settings.baseURL)
    ? "当前 Base URL 指向本机，通常不需要 API Key；如果该服务确实需要，请补上。"
    : "请到「辅助系统 → AI 配置」填入 API Key。";
}

/* ------------------------------------------------------------------ *
 * 请求基础设施：超时、取消、统一解包
 *
 * 之前每个请求各写一遍 fetch → text → JSON.parse，且都不传 signal：
 * 上游卡住就会永久占住一个路由。这里统一收口。
 * ------------------------------------------------------------------ */

/** 非流式请求超时（工具轮、报告生成、连通性自检）。 */
const REQUEST_TIMEOUT_MS = 90_000;

/** 流式请求超时：一次长回答可能持续很久，给足时间。 */
const STREAM_TIMEOUT_MS = 300_000;

/**
 * 合并「自身超时」与「调用方的取消信号」。
 *
 * 有调用方信号时必须用 AbortSignal.any 合并，而不是二选一：
 * 直接用调用方的信号会丢掉超时保护，直接用自身的会丢掉「客户端断开即中止」。
 */
function mergeSignal(
  external: AbortSignal | undefined,
  ms: number,
): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return external ? AbortSignal.any([timeout, external]) : timeout;
}

/** 把 abort 类异常翻译成人能看懂的话；不是 abort 就返回 null。 */
function asAbortError(error: unknown): AIRequestError | null {
  if (!(error instanceof Error)) return null;
  if (error.name === "TimeoutError") {
    return new AIRequestError(
      "请求模型超时（上游长时间没有响应），请检查网络或更换端点后重试。",
      0,
    );
  }
  if (error.name === "AbortError") {
    return new AIRequestError("请求已取消。", 0);
  }
  return null;
}

interface ChatRequestOptions {
  sessionId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

/**
 * 发一次非流式 chat/completions 并解包 JSON。
 *
 * 抽出来是为了让 chatOnce / chatWithTools / testConnection 共用同一套
 * 超时、取消、错误翻译逻辑，而不是各写一遍。
 */
async function postChat<T>(
  settings: AISettings,
  body: Record<string, unknown>,
  options: ChatRequestOptions = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(endpoint(settings), {
      method: "POST",
      headers: requestHeaders(settings, options.sessionId),
      body: JSON.stringify(body),
      signal: mergeSignal(options.signal, options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    const abortError = asAbortError(error);
    if (abortError) throw abortError;
    throw error;
  }

  const text = await response.text();
  if (!response.ok) {
    throw new AIRequestError(describeError(response.status, text), response.status);
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AIRequestError(
      `模型返回的不是合法 JSON：${text.slice(0, 300)}`,
      response.status,
    );
  }
}

/* ------------------------------------------------------------------ *
 * 一次性问答（用于生成训练报告）
 * ------------------------------------------------------------------ */

export async function chatOnce(
  messages: ChatMessage[],
  options: {
    temperature?: number;
    maxTokens?: number;
    sessionId?: string;
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  const settings = await resolveSettings();
  if (!settings.apiKey) throw new AIRequestError(missingKeyHint(settings), 0);

  const parsed = await postChat<{
    choices?: { message?: { content?: string } }[];
  }>(
    settings,
    {
      model: settings.model,
      messages,
      stream: false,
      temperature: options.temperature ?? settings.temperature,
      max_tokens: options.maxTokens ?? settings.maxTokens,
    },
    { sessionId: options.sessionId, signal: options.signal },
  );

  const content = parsed.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim() === "") {
    throw new AIRequestError("模型返回了空内容，请重试或更换模型。", 0);
  }
  return content;
}

/* ------------------------------------------------------------------ *
 * 带工具的问答（联网搜索 / MCP）
 *
 * 工具调用阶段不流式：需要先拿到完整的 tool_calls 才能执行。
 * 拿到结果后，最终回答仍然走 chatStream，保住打字机效果。
 * ------------------------------------------------------------------ */

export interface ToolCallReply {
  content: string;
  toolCalls: ToolCall[];
}

export async function chatWithTools(
  messages: ChatMessage[],
  tools: ToolDefinition[],
  options: {
    temperature?: number;
    maxTokens?: number;
    sessionId?: string;
    toolChoice?: "auto" | "none";
    signal?: AbortSignal;
  } = {},
): Promise<ToolCallReply> {
  const settings = await resolveSettings();
  if (!settings.apiKey) throw new AIRequestError(missingKeyHint(settings), 0);

  const parsed = await postChat<{
    choices?: {
      message?: { content?: string | null; tool_calls?: ToolCall[] };
    }[];
  }>(
    settings,
    {
      model: settings.model,
      messages,
      stream: false,
      temperature: options.temperature ?? settings.temperature,
      max_tokens: options.maxTokens ?? settings.maxTokens,
      ...(tools.length > 0
        ? { tools, tool_choice: options.toolChoice ?? "auto" }
        : {}),
    },
    { sessionId: options.sessionId, signal: options.signal },
  );

  const message = parsed.choices?.[0]?.message;
  return {
    content: typeof message?.content === "string" ? message.content : "",
    toolCalls: Array.isArray(message?.tool_calls) ? message.tool_calls : [],
  };
}

/* ------------------------------------------------------------------ *
 * 流式问答（用于训练对话）
 * ------------------------------------------------------------------ */

export async function* chatStream(
  messages: ChatMessage[],
  options: {
    temperature?: number;
    maxTokens?: number;
    sessionId?: string;
    signal?: AbortSignal;
  } = {},
): AsyncGenerator<string, void, unknown> {
  const settings = await resolveSettings();
  if (!settings.apiKey) throw new AIRequestError(missingKeyHint(settings), 0);

  let response: Response;
  try {
    response = await fetch(endpoint(settings), {
      method: "POST",
      headers: requestHeaders(settings, options.sessionId),
      body: JSON.stringify({
        model: settings.model,
        messages,
        stream: true,
        temperature: options.temperature ?? settings.temperature,
        max_tokens: options.maxTokens ?? settings.maxTokens,
      }),
      signal: mergeSignal(options.signal, STREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const abortError = asAbortError(error);
    if (abortError) throw abortError;
    throw error;
  }

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => "");
    throw new AIRequestError(describeError(response.status, body), response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        const abortError = asAbortError(error);
        if (abortError) throw abortError;
        throw error;
      }
      const { done, value } = chunk;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE 事件以空行分隔
      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const rawEvent = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const line of rawEvent.split("\n")) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const payload = trimmed.slice(5).trim();
          if (payload === "" || payload === "[DONE]") continue;

          try {
            const chunk = JSON.parse(payload) as {
              choices?: { delta?: { content?: string } }[];
            };
            const delta = chunk.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) yield delta;
          } catch {
            // 单条分片解析失败就跳过，不要中断整段回答
          }
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    /* releaseLock 只是把锁还回去，不会中止上游；调用方提前跳出
       （客户端断开 / 处理器提前返回）时必须 cancel，否则模型还在生成、
       连接一直挂着。 */
    try {
      await reader.cancel();
    } catch {
      // 流已经结束或已经出错，cancel 抛错无所谓
    }
    reader.releaseLock();
  }
}

/* ------------------------------------------------------------------ *
 * 稳健的 JSON 解析
 *
 * 模型偶尔会把 JSON 包在 ```json 里、写出行尾逗号，或者在字符串里塞入
 * 真实换行符。这些都不该让一次训练白跑，所以逐层修复。
 * ------------------------------------------------------------------ */

/** 把字符串字面量里的裸换行/制表符转义掉——JSON 不允许它们直接出现。 */
function escapeControlCharsInStrings(text: string): string {
  let out = "";
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) {
        out += ch;
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        out += ch;
        escaped = true;
        continue;
      }
      if (ch === '"') {
        out += ch;
        inString = false;
        continue;
      }
      if (ch === "\n") {
        out += "\\n";
        continue;
      }
      if (ch === "\r") {
        out += "\\r";
        continue;
      }
      if (ch === "\t") {
        out += "\\t";
        continue;
      }
      out += ch;
      continue;
    }
    if (ch === '"') inString = true;
    out += ch;
  }
  return out;
}

function stripFences(raw: string): string {
  return raw
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

function sliceObject(text: string): string {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start !== -1 && end > start ? text.slice(start, end + 1) : text;
}

/** 依次尝试：原样 → 去掉围栏 → 裁出对象 → 修尾逗号 → 转义裸换行。 */
export function parseJsonLoose<T>(raw: string): T {
  const candidates = [
    raw.trim(),
    stripFences(raw),
    sliceObject(stripFences(raw)),
    sliceObject(stripFences(raw)).replace(/,\s*([}\]])/g, "$1"),
    escapeControlCharsInStrings(sliceObject(stripFences(raw))),
    escapeControlCharsInStrings(
      sliceObject(stripFences(raw)).replace(/,\s*([}\]])/g, "$1"),
    ),
  ];

  let lastError: unknown = null;
  for (const candidate of candidates) {
    if (candidate.trim() === "") continue;
    try {
      return JSON.parse(candidate) as T;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(
    `无法从模型输出中解析出 JSON：${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

/**
 * 连通性自检。
 *
 * 刻意不复用 chatOnce：推理模型会先吐一大段 reasoning_content，
 * 小 max_tokens 下可见内容可能为空。这里只判断「HTTP 通了、鉴权过了、
 * 模型名存在」，所以看状态码与 choices 结构，不看正文长短。
 */
export async function testConnection(): Promise<{ ok: true; reply: string }> {
  const settings = await resolveSettings();
  if (!settings.apiKey) throw new AIRequestError(missingKeyHint(settings), 0);

  const parsed = await postChat<{ choices?: { message?: { content?: string } }[] }>(
    settings,
    {
      model: settings.model,
      messages: [{ role: "user", content: "只回复两个字：可用" }],
      stream: false,
      temperature: 0,
      max_tokens: 512,
    },
    { sessionId: "connection-test", timeoutMs: 60_000 },
  );

  if (!parsed.choices || parsed.choices.length === 0) {
    throw new AIRequestError(
      "接口连通，但返回体缺少 choices 字段，可能不是 OpenAI 兼容端点。",
      0,
    );
  }

  const content = (parsed.choices[0]?.message?.content ?? "").trim();
  return {
    ok: true,
    reply: content === "" ? "（模型本次只返回了推理内容，接口连通正常）" : content,
  };
}
