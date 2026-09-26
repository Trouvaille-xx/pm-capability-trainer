/**
 * 工具编排：把「联网搜索」和「MCP 工具」接进训练对话。
 *
 * 流程分两段，各自解决一个问题：
 *
 * 1. **工具轮**（不流式）：带着 tools 问模型，它要么直接回答，
 *    要么请求调用工具。执行完把结果回灌，再问一次，最多几轮。
 *    这一段必须不流式 —— 得先拿到完整的 tool_calls 才能执行。
 * 2. **最终回答**（流式）：工具结果已经在上下文里，去掉 tools
 *    再流式问一次，保住打字机效果。
 *
 * 降级策略：如果端点不支持 tools（不少网关会直接 400），
 * 就退回到「先搜一次、把结果塞进系统提示词」的老办法，
 * 而不是让这次训练直接失败。
 */

import { AIRequestError, chatWithTools } from "./ai";
import type { ChatMessage, ToolCall, ToolDefinition } from "./ai";
import { callTool, listAllTools } from "./mcp";
import type { MCPTool } from "./mcp";
import { renderResults, runSearch } from "./websearch";
import type { AISettings, ToolTrace } from "./types";

/** 最多几轮工具调用。再多就说明模型在打转，不如让它直接回答。 */
const MAX_ROUNDS = 3;

/** 单个工具结果截断长度，避免一次搜索把上下文撑爆。 */
const MAX_RESULT_CHARS = 4000;

const WEB_SEARCH_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "联网搜索。当需要外部事实、行业数据、竞品资料、方法论出处，或你不确定的信息时调用。不要用它来替用户完成分析，只用来补充事实依据。",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "搜索关键词，尽量具体，例如「小红书 信息流 推荐算法 机制」",
        },
      },
      required: ["query"],
    },
  },
};

export interface Toolset {
  defs: ToolDefinition[];
  mcpTools: MCPTool[];
  /** MCP 连接失败之类需要让用户看见的问题（不再只进 console.warn） */
  notes: string[];
}

/** 组装本次对话可用的工具集合。 */
export async function buildToolset(settings: AISettings): Promise<Toolset> {
  const { tools: mcpTools, errors } = await listAllTools(settings.mcpServers);

  const defs: ToolDefinition[] = [];
  if (settings.webSearch.enabled) defs.push(WEB_SEARCH_TOOL);

  for (const tool of mcpTools) {
    defs.push({
      type: "function",
      function: {
        name: tool.exposedName,
        description: (tool.description || `MCP 工具：${tool.name}`).slice(0, 900),
        parameters: tool.inputSchema,
      },
    });
  }

  return { defs, mcpTools, notes: errors };
}

function truncate(text: string, max = MAX_RESULT_CHARS): string {
  return text.length <= max ? text : `${text.slice(0, max)}…（已截断）`;
}

/**
 * 按工具自己的 inputSchema 收敛模型给的参数。
 *
 * 模型（或提示词注入）给出的参数是不可信输入，直接转发给 MCP 服务器等于
 * 把任意对象交出去。这里只保留 schema 里声明过的字段，并做基本类型校验：
 * 声明为 string 的就转成字符串，声明为 number/integer 的转不成数字就丢弃。
 * schema 不是对象形状时无从校验，原样返回。
 */
function sanitizeToolArgs(
  args: Record<string, unknown>,
  schema: unknown,
): Record<string, unknown> {
  const spec = schema as
    | { type?: string; properties?: Record<string, { type?: string }> }
    | undefined;

  if (!spec || spec.type !== "object" || !spec.properties) return args;

  const out: Record<string, unknown> = {};
  for (const [key, declared] of Object.entries(spec.properties)) {
    if (!(key in args)) continue;
    const value = args[key];
    switch (declared?.type) {
      case "string":
        if (typeof value === "string") out[key] = value;
        else if (typeof value === "number" || typeof value === "boolean") {
          out[key] = String(value);
        }
        break;
      case "number":
      case "integer": {
        const num = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(num)) {
          out[key] = declared.type === "integer" ? Math.round(num) : num;
        }
        break;
      }
      case "boolean":
        if (typeof value === "boolean") out[key] = value;
        break;
      case "array":
        if (Array.isArray(value)) out[key] = value;
        break;
      default:
        // 没声明类型（或 object 等复杂类型）：原样带上，交给工具自己校验
        out[key] = value;
    }
  }
  return out;
}

/** 执行一次工具调用，返回喂给模型的文本 + 一条可展示的轨迹。 */
async function executeTool(
  call: ToolCall,
  toolset: Toolset,
  settings: AISettings,
): Promise<{ text: string; trace: ToolTrace }> {
  const name = call.function?.name ?? "";
  let args: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(call.function?.arguments || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      args = parsed as Record<string, unknown>;
    }
  } catch {
    // 参数不是合法 JSON 就按空对象处理，让工具自己报错
  }

  if (name === "web_search") {
    const query = String(args.query ?? "").trim();
    const outcome = await runSearch(query, settings.webSearch);
    if (!outcome.ok) {
      return {
        text: `搜索失败：${outcome.error}。请基于你已有的知识继续，并在回答里说明这一点。`,
        trace: {
          name: "联网搜索",
          detail: query || "（空搜索词）",
          result: `失败：${outcome.error}`,
          ok: false,
        },
      };
    }
    const rendered = renderResults(query, outcome.results);
    return {
      text: rendered === "" ? "没有找到相关结果。" : rendered,
      trace: {
        name: "联网搜索",
        detail: query,
        result: `${outcome.results.length} 条结果`,
        ok: true,
      },
    };
  }

  const tool = toolset.mcpTools.find((t) => t.exposedName === name);
  if (!tool) {
    return {
      text: `没有名为 ${name} 的工具。`,
      trace: { name, detail: "未知工具", result: "未找到该工具", ok: false },
    };
  }

  // 参数是不可信输入：按该工具的 inputSchema 收敛后再转发给 MCP 服务器
  const safeArgs = sanitizeToolArgs(args, tool.inputSchema);
  const result = await callTool(tool, safeArgs);
  const detail =
    Object.keys(safeArgs).length > 0
      ? `${tool.server.name} · ${tool.name}(${JSON.stringify(safeArgs).slice(0, 80)})`
      : `${tool.server.name} · ${tool.name}`;

  return {
    text: truncate(result.text),
    trace: {
      name: `MCP · ${tool.name}`,
      detail,
      result: result.ok
        ? `${result.text.slice(0, 60)}${result.text.length > 60 ? "…" : ""}`
        : result.text.slice(0, 80),
      ok: result.ok,
    },
  };
}

export interface ToolRoundOutcome {
  /** 追加了工具结果之后的消息列表，直接拿去流式生成最终回答 */
  messages: ChatMessage[];
  traces: ToolTrace[];
  /** 端不支持 tools 时为 true，调用方可以据此提示用户 */
  degraded: boolean;
  /** 给用户看的降级说明 */
  note?: string;
}

/**
 * 跑完工具轮，返回带检索结果的消息列表。
 *
 * @param baseMessages 已经拼好的 system + 历史对话
 * @param fallbackQuery 端点不支持 tools 时，用它直接搜一次
 * @param signal 调用方的取消信号（客户端断开时用来中止工具轮）
 */
export async function runToolRounds(
  baseMessages: ChatMessage[],
  toolset: Toolset,
  settings: AISettings,
  sessionId: string,
  fallbackQuery: string,
  signal?: AbortSignal,
): Promise<ToolRoundOutcome> {
  if (toolset.defs.length === 0) {
    return { messages: baseMessages, traces: [], degraded: false };
  }

  const messages: ChatMessage[] = [...baseMessages];
  const traces: ToolTrace[] = [];

  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const reply = await chatWithTools(messages, toolset.defs, {
        temperature: settings.temperature,
        sessionId,
        signal,
      });

      if (reply.toolCalls.length === 0) {
        /* 模型选择直接回答。把它的回答放进上下文，
           后面的流式调用会基于它继续（通常是收尾）。 */
        if (reply.content.trim() !== "") {
          messages.push({ role: "assistant", content: reply.content });
        }
        break;
      }

      messages.push({
        role: "assistant",
        content: reply.content || null,
        tool_calls: reply.toolCalls,
      });

      for (const call of reply.toolCalls) {
        const { text, trace } = await executeTool(call, toolset, settings);
        traces.push(trace);
        messages.push({
          role: "tool",
          tool_call_id: call.id,
          name: call.function?.name,
          content: text,
        });
      }
    }
    return { messages, traces, degraded: false };
  } catch (error) {
    /* 调用方主动取消（客户端断开）：不要再退化去检索一次，
       那只会白白浪费一次外部请求，直接向上抛。 */
    if (signal?.aborted) throw error;

    /* 端点不支持 tools（或工具轮里出了别的错）：退回「先搜后答」。
       训练不该因为工具挂了就中断。 */
    const reason = error instanceof Error ? error.message : String(error);
    const unsupported =
      error instanceof AIRequestError &&
      (error.status === 400 || error.status === 404 || error.status === 422);

    console.warn("[agent] 工具轮失败，改用直接检索兜底：", reason);

    if (!settings.webSearch.enabled) {
      return {
        messages: baseMessages,
        traces,
        degraded: true,
        note: unsupported
          ? "当前模型端点不支持工具调用，本次未使用联网与 MCP。"
          : `工具调用出错，本次未使用联网与 MCP：${reason}`,
      };
    }

    const outcome = await runSearch(fallbackQuery, settings.webSearch);
    if (!outcome.ok) {
      return {
        messages: baseMessages,
        traces,
        degraded: true,
        note: `工具调用不可用，直接检索也失败了：${outcome.error}`,
      };
    }

    traces.push({
      name: "联网搜索",
      detail: fallbackQuery,
      result: `${outcome.results.length} 条结果（降级模式）`,
      ok: true,
    });

    const rendered = renderResults(fallbackQuery, outcome.results);
    return {
      messages: [
        ...baseMessages,
        {
          role: "system",
          content: `以下是与本次训练题目相关的检索结果，可作为事实依据引用。引用时请注明来源编号。\n\n${truncate(rendered)}`,
        },
      ],
      traces,
      degraded: true,
      note: unsupported
        ? "当前模型端点不支持工具调用，已改为直接检索一次并注入上下文。"
        : `工具调用出错（${reason}），已改为直接检索一次并注入上下文。`,
    };
  }
}
