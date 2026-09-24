/**
 * MCP（Model Context Protocol）客户端。
 *
 * 只实现 Streamable HTTP 传输：一个 POST 过去，返回可能是
 * application/json（单个响应），也可能是 text/event-stream（SSE 分片）。
 * 两种都要能解析，因为不同服务器的实现不一致。
 *
 * 设计原则：**MCP 出问题绝不能拖垮一次训练**。
 * 所以这里所有函数都自己吞掉异常并返回空结果，由调用方决定怎么提示。
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
  result?: unknown;
  error?: { code: number; message: string };
}

let rpcId = 1;

/**
 * 发一次 JSON-RPC。返回解析后的 result，以及服务器给的 session id。
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

  const body = notification
    ? { jsonrpc: "2.0", method, params }
    : { jsonrpc: "2.0", id: rpcId++, method, params };

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
    throw new Error(
      `MCP 服务器「${server.name}」返回 HTTP ${response.status}：${text.slice(0, 200)}`,
    );
  }

  // 通知没有响应体
  if (notification) return { payload: null, sessionId: nextSession };

  const contentType = response.headers.get("content-type") ?? "";
  const text = await response.text();

  if (contentType.includes("text/event-stream")) {
    /* SSE：逐行找 data: 分片，取第一个带 result/error 的 JSON */
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "" || payload === "[DONE]") continue;
      try {
        const parsed = JSON.parse(payload) as RpcResult;
        if (parsed && (parsed.result !== undefined || parsed.error !== undefined)) {
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

/** 建立会话并列出该服务器提供的工具。任何失败都返回空数组。 */
export async function listTools(server: MCPServer): Promise<MCPTool[]> {
  try {
    const init = await rpc(server, "initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "pm-capability-trainer", version: "0.1.0" },
    });

    if (init.payload?.error) {
      throw new Error(init.payload.error.message);
    }

    const sessionId = init.sessionId;

    // 按协议要求回一条 initialized 通知（失败不致命）
    await rpc(server, "notifications/initialized", {}, sessionId, true).catch(
      () => undefined,
    );

    const listed = await rpc(server, "tools/list", {}, sessionId);
    if (listed.payload?.error) {
      throw new Error(listed.payload.error.message);
    }

    const result = listed.payload?.result as
      | { tools?: { name?: string; description?: string; inputSchema?: unknown }[] }
      | undefined;

    const tools = Array.isArray(result?.tools) ? result.tools : [];
    return tools
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
      }));
  } catch (error) {
    console.warn(
      `[mcp] 无法列出「${server.name}」的工具：`,
      error instanceof Error ? error.message : error,
    );
    return [];
  }
}

/** 并发拉取所有启用服务器的工具。 */
export async function listAllTools(servers: MCPServer[]): Promise<MCPTool[]> {
  const active = servers.filter((s) => s.enabled && s.url.trim() !== "");
  if (active.length === 0) return [];
  const groups = await Promise.all(active.map((s) => listTools(s)));
  return groups.flat();
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
    // tools/call 需要复用 initialize 建立的会话，这里重新握手一次
    const init = await rpc(tool.server, "initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "pm-capability-trainer", version: "0.1.0" },
    });
    const sessionId = init.sessionId;
    await rpc(
      tool.server,
      "notifications/initialized",
      {},
      sessionId,
      true,
    ).catch(() => undefined);

    const called = await rpc(
      tool.server,
      "tools/call",
      { name: tool.name, arguments: args },
      sessionId,
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
