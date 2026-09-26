/**
 * MCP（Model Context Protocol）客户端。
 *
 * 只实现 Streamable HTTP 传输：一个 POST 过去，返回可能是
 * application/json（单个响应），也可能是 text/event-stream（SSE 分片）。
 * 两种都要能解析，因为不同服务器的实现不一致。
 *
 * 设计原则：**MCP 出问题绝不能拖垮一次训练**。
 * 列出工具失败会返回空的工具表 + 一条错误说明，由调用方决定怎么提示；
 * 调用工具失败会返回 ok:false，让模型自己决定下一步。
 */

import type { MCPServer } from "./types";

export interface MCPTool {
  /** 服务器上的原始工具名 */
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** 归属的服务器 */
  server: MCPServer;
  /** 暴露给模型时用的名字（已做字符清洗） */
  exposedName: string;
}

/** 列工具的结果：失败时不抛错，而是把原因带出来给界面展示。 */
export interface MCPToolListing {
  tools: MCPTool[];
  error?: string;
}

const PROTOCOL_VERSION = "2025-06-18";
const TIMEOUT_MS = 20000;

/**
 * 把服务器工具名清洗成符合 OpenAI function name 约束的标识
 * （只允许字母、数字、下划线、短横线，且不超过 64 字符）。
 */
export function exposeName(server: MCPServer, toolName: string): string {
  const raw = `mcp__${server.id}__${toolName}`;
  const safe = raw.replace(/[^A-Za-z0-9_-]/g, "_");
  return safe.length <= 64 ? safe : safe.slice(0, 64);
}

interface RpcResult {
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

let rpcId = 1;

/** 带 HTTP 状态码的错误，便于上层区分「会话过期」这类可重试的错误。 */
function rpcError(status: number, message: string): Error {
  return Object.assign(new Error(message), { status });
}

/**
 * 发一次 JSON-RPC。返回解析后的 result，以及服务器给的 session id。
 *
 * SSE 响应里可能有多条 payload，必须按自己发出去的 `id` 认领响应；
 * 只认「第一个带 result 的」在批量/多消息的服务器上会取错结果。
 */
async function rpc(
  server: MCPServer,
  method: string,
  params: unknown,
  sessionId?: string,
  notification = false,
): Promise<{ payload: RpcResult | null; sessionId?: string }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "mcp-protocol-version": PROTOCOL_VERSION,
  };
  if (server.token) headers.authorization = `Bearer ${server.token}`;
  if (sessionId) headers["mcp-session-id"] = sessionId;

  const sentId = notification ? null : rpcId++;
  const body = notification
    ? { jsonrpc: "2.0", method, params }
    : { jsonrpc: "2.0", id: sentId, method, params };

  const response = await fetch(server.url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const nextSession =
    response.headers.get("mcp-session-id") ?? sessionId ?? undefined;

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw rpcError(
      response.status,
      `MCP 服务器「${server.name}」返回 HTTP ${response.status}：${text.slice(0, 200)}`,
    );
  }

  // 通知没有响应体
  if (notification) return { payload: null, sessionId: nextSession };

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (contentType.includes("text/event-stream")) {
    /* SSE：逐行找 data: 分片，按 id 认领属于自己的那一条响应 */
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "" || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as RpcResult;
        if (parsed && parsed.id === sentId) {
          return { payload: parsed, sessionId: nextSession };
        }
      } catch {
        // 跳过解析不了的分片
      }
    }
    return { payload: null, sessionId: nextSession };
  }

  try {
    return { payload: JSON.parse(text) as RpcResult, sessionId: nextSession };
  } catch {
    throw new Error(
      `MCP 服务器「${server.name}」返回的不是合法 JSON：${text.slice(0, 200)}`,
    );
  }
}

/* ------------------------------------------------------------------ *
 * 会话缓存
 *
 * 协议要求先 initialize 拿到 mcp-session-id，后续请求带着它。
 * 之前每调用一次工具都重新握一次手（多两个来回），这里按服务器缓存。
 * ------------------------------------------------------------------ */

const sessions = new Map<string, string>();

function serverKey(server: MCPServer): string {
  return `${server.id}|${server.url}`;
}

async function initializeOnce(server: MCPServer): Promise<string | undefined> {
  const init = await rpc(server, "initialize", {
    protocolVersion: PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "pm-capability-trainer", version: "0.1.0" },
  });

  if (init.payload?.error) throw new Error(init.payload.error.message);

  const sessionId = init.sessionId;
  if (sessionId) {
    // 按协议要求回一条 initialized 通知（失败不致命）
    await rpc(server, "notifications/initialized", {}, sessionId, true).catch(
      () => undefined,
    );
    sessions.set(serverKey(server), sessionId);
  }
  return sessionId;
}

async function ensureSession(server: MCPServer): Promise<string | undefined> {
  const cached = sessions.get(serverKey(server));
  if (cached) return cached;
  return initializeOnce(server);
}

/**
 * 带会话执行一次请求；会话失效（服务器重启，返回 404）时清缓存重试一次。
 */
async function withSession<T>(
  server: MCPServer,
  fn: (sessionId?: string) => Promise<T>,
): Promise<T> {
  try {
    return await fn(await ensureSession(server));
  } catch (error) {
    if ((error as { status?: number }).status === 404) {
      sessions.delete(serverKey(server));
      return await fn(await ensureSession(server));
    }
    throw error;
  }
}

/** 建立会话并列出该服务器提供的工具。失败返回空表 + 错误说明。 */
export async function listTools(server: MCPServer): Promise<MCPToolListing> {
  try {
    const listed = await withSession(server, (sessionId) =>
      rpc(server, "tools/list", {}, sessionId),
    );

    if (listed.payload?.error) {
      throw new Error(listed.payload.error.message);
    }

    const result = listed.payload?.result as
      | { tools?: { name?: string; description?: string; inputSchema?: unknown }[] }
      | undefined;

    const tools = Array.isArray(result?.tools) ? result.tools : [];
    return {
      tools: tools
        .filter((t) => typeof t?.name === "string" && t.name !== "")
        .map((t) => ({
          name: t.name as string,
          description: typeof t.description === "string" ? t.description : "",
          inputSchema:
            t.inputSchema && typeof t.inputSchema === "object"
              ? (t.inputSchema as Record<string, unknown>)
              : { type: "object", properties: {} },
          server,
          exposedName: exposeName(server, t.name as string),
        })),
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[mcp] 无法列出「${server.name}」的工具：`, reason);
    /* 不再静默吞掉：把原因带回上层，界面上能看到「这个 MCP 挂了」 */
    return { tools: [], error: `${server.name || server.url}：${reason}` };
  }
}

/** 并发拉取所有启用服务器的工具，同时收集失败原因。 */
export async function listAllTools(
  servers: MCPServer[],
): Promise<{ tools: MCPTool[]; errors: string[] }> {
  const active = servers.filter((s) => s.enabled && s.url.trim() !== "");
  if (active.length === 0) return { tools: [], errors: [] };

  const listings = await Promise.all(active.map((s) => listTools(s)));
  return {
    tools: listings.flatMap((listing) => listing.tools),
    errors: listings
      .map((listing) => listing.error)
      .filter((error): error is string => typeof error === "string"),
  };
}

export interface MCPCallResult {
  ok: boolean;
  /** 已经拍平成纯文本的结果，直接喂给模型 */
  text: string;
}

/** 调用一个 MCP 工具，把返回的 content 数组拍平成文本。 */
export async function callTool(
  tool: MCPTool,
  args: Record<string, unknown>,
): Promise<MCPCallResult> {
  try {
    const called = await withSession(tool.server, (sessionId) =>
      rpc(
        tool.server,
        "tools/call",
        { name: tool.name, arguments: args },
        sessionId,
      ),
    );

    if (called.payload?.error) {
      return { ok: false, text: `MCP 工具调用失败：${called.payload.error.message}` };
    }

    const result = called.payload?.result as
      | {
          content?: { type?: string; text?: string }[];
          isError?: boolean;
        }
      | undefined;

    const parts = Array.isArray(result?.content) ? result.content : [];
    const text = parts
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .filter((t) => t !== "")
      .join("\n")
      .trim();

    return {
      ok: result?.isError !== true,
      text: text === "" ? "（工具没有返回文本内容）" : text,
    };
  } catch (error) {
    return {
      ok: false,
      text: `MCP 工具调用出错：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
