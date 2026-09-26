import { assertSameOrigin, fail, handle, readBody, requireString } from "@/lib/api";
import { chatStream } from "@/lib/ai";
import { buildToolset, runToolRounds } from "@/lib/agent";
import { scenarioSteps } from "@/lib/catalog";
import {
  parseStep,
  trainingSystemPrompt,
  toChatMessages,
} from "@/lib/prompts";
import { findById, mutate, nowIso, readSettings } from "@/lib/store";
import type { ChatMessage } from "@/lib/ai";
import type { ToolTrace, TrainingSession } from "@/lib/types";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/**
 * 流式协议里的控制帧前缀（ASCII 记录分隔符）。
 * 以它开头的行是给前端的元信息，不会被当成回答正文渲染。
 */
const CTRL = "\u001e";

/** 端点不支持工具调用时，用题目 + 最近一句作答拼一个检索词。 */
function fallbackQuery(session: TrainingSession): string {
  const lastUser = [...session.transcript]
    .reverse()
    .find((entry) => entry.role === "user")?.content;

  const parts = [session.topic];
  if (session.productType) parts.push(session.productType);
  if (lastUser) parts.push(lastUser.slice(0, 120));

  return parts.join(" ").replace(/\s+/g, " ").trim().slice(0, 300);
}

/**
 * 追加一轮对话，并以纯文本流返回模型的回答。
 *
 * 用户消息先落盘再生成，中途失败不会丢失；
 * 模型回答在流结束后整段落盘，保证 transcript 与界面上看到的一致。
 * kickoff=true 用于开场：不追加用户消息，只让教练先说话。
 *
 * 两处落盘都走 store.mutate（锁内读改写）：并发两轮时各自基于**最新**
 * transcript 追加，不会出现「后写覆盖前写、丢掉一整轮回答」。
 *
 * 如果配置了联网搜索或 MCP，会先跑一轮工具调用（不流式），
 * 把检索结果并进上下文，再流式生成最终回答。
 */
export async function POST(request: Request, { params }: Params) {
  return handle(async () => {
    assertSameOrigin(request);
    const { id } = await params;
    const body = await readBody<{ content?: string; kickoff?: boolean }>(request);

    const session = await findById("sessions", id);
    if (!session) return fail("训练会话不存在", 404);
    if (session.mode === "solo") {
      return fail("「完全独立训练」模式下 AI 不参与对话，请直接提交作答。", 400);
    }
    if (session.status === "completed") {
      return fail("本次训练已结束，请新建一次训练。", 400);
    }

    const kickoff = body.kickoff === true;
    const content = kickoff
      ? ""
      : requireString(body.content, "内容", { max: 8000 });

    let working: TrainingSession = session;
    if (!kickoff) {
      const appended = await mutate("sessions", id, (current) => ({
        ...current,
        transcript: [
          ...current.transcript,
          { role: "user", content, at: nowIso() },
        ],
        updatedAt: nowIso(),
      }));
      if (appended) working = appended;
    }

    const settings = await readSettings();
    const toolset = await buildToolset(settings);

    const system = await trainingSystemPrompt(working);
    const baseMessages: ChatMessage[] = toChatMessages(system, working);
    if (kickoff) {
      baseMessages.push({ role: "user", content: "请开始本次训练。" });
    }

    const encoder = new TextEncoder();
    const signal = request.signal;

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        /* 客户端断开后 enqueue 会抛错，用 closed 标志兜住，
           同时保证「断开也能走完落盘逻辑」。 */
        let closed = false;
        const enqueue = (chunk: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(chunk));
          } catch {
            closed = true;
          }
        };
        const sendControl = (payload: unknown) => {
          enqueue(`${CTRL}${JSON.stringify(payload)}\n`);
        };

        /** 只有模型真实产出的正文；出错的提示语走控制帧，不进这里。 */
        let full = "";
        let traces: ToolTrace[] = [];

        try {
          /* 工具轮放在流里跑：这样前端能立刻收到「正在检索」的信号，
             而不是对着一个不动的界面等十几秒。 */
          sendControl({
            type: "status",
            phase: toolset.defs.length > 0 ? "tools" : "thinking",
          });

          const outcome = await runToolRounds(
            baseMessages,
            toolset,
            settings,
            id,
            fallbackQuery(working),
            signal,
          );

          if (
            outcome.traces.length > 0 ||
            outcome.note ||
            toolset.notes.length > 0
          ) {
            traces = outcome.traces;
            sendControl({
              type: "tools",
              traces: outcome.traces,
              /* MCP 连接失败这类问题也一并说给用户听，而不是只留在终端日志里 */
              note:
                [...toolset.notes, outcome.note].filter(Boolean).join("；") ||
                null,
            });
          }

          sendControl({ type: "status", phase: "writing" });

          for await (const delta of chatStream(outcome.messages, {
            sessionId: id,
            signal,
          })) {
            full += delta;
            enqueue(delta);
          }
        } catch (error) {
          /* 错误提示只发给界面，不写进 transcript——
             否则「[生成中断] …」会变成对话与报告的一部分。 */
          const message =
            error instanceof Error ? error.message : "生成回答时出错";
          sendControl({ type: "error", message });
        } finally {
          if (full.trim() !== "") {
            try {
              await mutate("sessions", id, (current) => {
                /* 从回答里解析「第X步」并推进进度。
                   模型可能一次跳到后面的步骤，取解析值但不超过总步数；
                   解析不到就保持原进度不动。 */
                const steps = scenarioSteps(current.scenario);
                const parsed = parseStep(full);
                const nextStep =
                  steps.length > 0 && parsed !== null
                    ? Math.min(
                        Math.max(parsed, current.currentStep ?? 1),
                        steps.length,
                      )
                    : undefined;

                return {
                  ...current,
                  transcript: [
                    ...current.transcript,
                    {
                      role: "assistant",
                      content: full,
                      at: nowIso(),
                      ...(traces.length > 0 ? { tools: traces } : {}),
                    },
                  ],
                  ...(nextStep !== undefined && nextStep !== current.currentStep
                    ? { currentStep: nextStep }
                    : {}),
                  updatedAt: nowIso(),
                };
              });
            } catch (error) {
              console.error("[sessions/message] 保存回答失败", error);
            }
          }

          closed = true;
          try {
            controller.close();
          } catch {
            // 已经关闭（客户端断开导致），忽略
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-accel-buffering": "no",
      },
    });
  });
}
