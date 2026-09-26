"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useRef, useState } from "react";

import { Markdown } from "@/components/Markdown";
import { ConfirmDialog } from "@/components/Modal";
import {
  IconBack,
  IconCheck,
  IconReport,
  IconSearch,
  IconSend,
  IconTrash,
} from "@/components/icons";
import { SCENARIOS, modeName, scenarioName, scenarioSteps } from "@/lib/catalog";
import { apiGet, apiSend, formatDate } from "@/lib/client";
import type { ToolTrace, TrainingSession } from "@/lib/types";

/** 流式协议里的控制帧前缀，与服务端约定一致。 */
const CTRL = "\u001e";

/** 当前 AI 处于哪个阶段，用来给用户即时反馈。 */
type Phase = "idle" | "tools" | "thinking" | "writing";

const PHASE_TEXT: Record<Phase, string> = {
  idle: "",
  tools: "正在检索资料…",
  thinking: "正在思考…",
  writing: "正在作答…",
};

export default function TrainingSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const router = useRouter();

  const [session, setSession] = useState<TrainingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [sending, setSending] = useState(false);

  /** 本轮的实时状态：阶段 + 已经发生的工具调用 */
  const [phase, setPhase] = useState<Phase>("idle");
  const [liveTraces, setLiveTraces] = useState<ToolTrace[]>([]);
  const [toolNote, setToolNote] = useState<string | null>(null);

  const [submission, setSubmission] = useState("");
  const [generating, setGenerating] = useState(false);

  const kickedOff = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<TrainingSession>(`/api/sessions/${id}`);
      setSession(data);
      setSubmission((prev) => (prev === "" ? data.submission : prev));
      setError("");
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
      return null;
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session?.transcript.length, streaming, phase]);

  /** 输入框随内容长高，最多到 CSS 里的 max-height。 */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
  }, [input]);

  /** 发一轮对话，把模型回答以流式方式显示出来。 */
  const talk = useCallback(
    async (payload: { content?: string; kickoff?: boolean }) => {
      setSending(true);
      setStreaming("");
      setLiveTraces([]);
      setToolNote(null);
      setPhase("thinking");
      setError("");
      try {
        const response = await fetch(`/api/sessions/${id}/message`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok || !response.body) {
          const text = await response.text();
          let message = `请求失败（HTTP ${response.status}）`;
          try {
            message = (JSON.parse(text) as { error?: string }).error ?? message;
          } catch {
            // 保留默认错误信息
          }
          throw new Error(message);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let answer = "";

        /* 控制帧可能出现在正文之后（例如生成中途出错），所以不能只看行首，
           要在整个缓冲区里找分隔符。找到就把前面的正文吐出来、
           再把完整的帧解析掉；帧没接收完就留着等下一个分片。 */
        const consume = (flush: boolean) => {
          while (true) {
            const at = buffer.indexOf(CTRL);
            if (at === -1) {
              if (flush && buffer !== "") {
                answer += buffer;
                buffer = "";
              }
              return;
            }
            if (at > 0) {
              answer += buffer.slice(0, at);
              buffer = buffer.slice(at);
            }
            const newline = buffer.indexOf("\n");
            if (newline === -1) return;
            const line = buffer.slice(1, newline);
            buffer = buffer.slice(newline + 1);
            try {
              const frame = JSON.parse(line) as {
                type?: string;
                phase?: Phase;
                traces?: ToolTrace[];
                note?: string | null;
                message?: string;
              };
              if (frame.type === "status" && frame.phase) setPhase(frame.phase);
              if (frame.type === "tools") {
                setLiveTraces(frame.traces ?? []);
                setToolNote(frame.note ?? null);
              }
              /* 生成中断：错误只作提示，正文里不含它，
                 所以落盘的历史对话是干净的。 */
              if (frame.type === "error") {
                setError(frame.message ?? "生成回答时出错");
              }
            } catch {
              // 坏帧直接丢，不影响正文
            }
          }
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          consume(false);
          setStreaming(answer);
        }
        consume(true);

        setStreaming("");
        setPhase("idle");
        await load();
        setLiveTraces([]);
      } catch (e) {
        setStreaming("");
        setPhase("idle");
        setError(e instanceof Error ? e.message : "对话失败");
      } finally {
        setSending(false);
      }
    },
    [id, load],
  );

  // 实时模式：进入页面后让教练先开场
  useEffect(() => {
    if (!session || kickedOff.current) return;
    if (session.mode === "solo") return;
    if (session.status !== "active") return;
    if (session.transcript.length > 0) return;
    const kickoff = new URLSearchParams(window.location.search).get("kickoff");
    if (kickoff !== "1") return;
    kickedOff.current = true;
    void talk({ kickoff: true });
  }, [session, talk]);

  async function send() {
    const content = input.trim();
    if (content === "" || sending) return;
    setInput("");
    await talk({ content });
  }

  async function finish() {
    setGenerating(true);
    setError("");
    try {
      if (session?.mode === "solo") {
        await apiSend(`/api/sessions/${id}/submit`, "POST", { submission });
      }
      await apiSend(`/api/sessions/${id}/report`, "POST");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成报告失败");
    } finally {
      setGenerating(false);
    }
  }

  async function destroy() {
    setDeleting(true);
    try {
      await apiSend(`/api/sessions/${id}`, "DELETE");
      router.push("/trainer");
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
      setDeleting(false);
      setConfirming(false);
    }
  }

  if (loading) return <div className="loading">加载中…</div>;
  if (!session) {
    return (
      <div className="stack">
        <div className="notice notice-error">{error || "训练会话不存在"}</div>
        <Link href="/trainer" className="btn">
          返回训练列表
        </Link>
      </div>
    );
  }

  const scenarioMeta = SCENARIOS.find((s) => s.id === session.scenario);
  const isSolo = session.mode === "solo";
  const completed = session.status === "completed";

  /* 有分步流程的场景（产品拆解）显示步骤条 */
  const steps = scenarioSteps(session.scenario);
  const currentStep = session.currentStep ?? 0;
  const stepMeta = steps.find((s) => s.id === currentStep) ?? null;
  const answered = session.transcript.filter((t) => t.role === "user").length;

  const head = (
    <div className="detail-head">
      <Link
        href="/trainer"
        className="btn btn-sm detail-back"
        title="返回训练列表"
      >
        <IconBack width={14} height={14} />
        返回
      </Link>

      <div className="detail-title-wrap">
        <h1 className="detail-title">{session.topic}</h1>
        <div className="detail-meta">
          <span className="detail-meta-item">
            {scenarioName(session.scenario)}
          </span>
          <span className="detail-meta-item">{modeName(session.mode)}</span>
          {session.productType ? (
            <span className="detail-meta-item">{session.productType}</span>
          ) : null}
          {session.analysisGoal ? (
            <span className="detail-meta-item">{session.analysisGoal}</span>
          ) : null}
          <span className="detail-meta-item">
            {formatDate(session.createdAt)}
          </span>
        </div>
      </div>

      <div className="detail-actions">
        <Link
          href={`/trainer/${session.id}/report`}
          className="btn btn-sm btn-primary"
          title="查看这次训练的报告"
        >
          <IconReport width={13} height={13} />
          {session.report ? "查看报告" : "报告"}
        </Link>
        <button
          className="btn btn-sm btn-danger"
          onClick={() => setConfirming(true)}
        >
          <IconTrash width={13} height={13} />
          删除
        </button>
      </div>
    </div>
  );

  /* 完全独立训练没有对话，用普通文档流即可 */
  if (isSolo) {
    return (
      <div className="stack">
        {head}
        {error ? <div className="notice notice-error">{error}</div> : null}
        <div className="card">
          <h2 style={{ marginBottom: 10 }}>独立作答</h2>
          <textarea
            className="textarea textarea-lg"
            value={submission}
            onChange={(e) => setSubmission(e.target.value)}
            placeholder="结论先行，每个判断给出依据，区分事实与推断。"
            disabled={generating}
          />
          <div className="row" style={{ marginTop: 12 }}>
            <button
              className="btn btn-primary"
              onClick={finish}
              disabled={generating || submission.trim() === ""}
            >
              <IconReport width={15} height={15} />
              {generating
                ? "批改中…"
                : session.report
                  ? "重新生成报告"
                  : "提交作答并生成报告"}
            </button>
            <span className="stat-label">
              共 {submission.length} 字 · 建议至少写 300 字，太短无法看出思维过程
            </span>
          </div>
        </div>
        <ConfirmDialog
          open={confirming}
          title="删除这次训练"
          message="确定删除这次训练记录？对话和报告都会一起删掉，无法恢复。"
          busy={deleting}
          onConfirm={destroy}
          onCancel={() => setConfirming(false)}
        />
      </div>
    );
  }

  /* 工具轨迹：优先显示本轮实时的，没有就显示落盘的历史 */
  const traces = liveTraces.length > 0 ? liveTraces : [];
  const busy = phase !== "idle";

  return (
    <div className="session-shell">
      {head}

      {error ? <div className="notice notice-error">{error}</div> : null}
      {toolNote ? <div className="notice notice-info">{toolNote}</div> : null}

      {steps.length > 0 ? (
        <div className="card">
          <div className="stepbar">
            {steps.map((s) => {
              const state =
                s.id < currentStep || (completed && s.id <= steps.length)
                  ? "done"
                  : s.id === currentStep
                    ? "active"
                    : "";
              return (
                <div key={s.id} className={`stepbar-item ${state}`}>
                  <span className="stepbar-num">
                    {state === "done" ? (
                      <IconCheck width={11} height={11} />
                    ) : (
                      s.id
                    )}
                  </span>
                  <span className="stepbar-name">{s.name}</span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="session-chat">
        <div className="session-scroll">
          {session.transcript.length === 0 && streaming === "" && !busy ? (
            <div className="empty">
              还没有开始，输入内容或刷新页面重新开场。
            </div>
          ) : (
            <div className="chat">
              {session.transcript.map((entry, index) => (
                <div
                  key={index}
                  className={`turn ${entry.role === "user" ? "turn-user" : ""}`}
                >
                  <div className="turn-avatar">
                    {entry.role === "user" ? "我" : "AI"}
                  </div>
                  <div className="turn-body">
                    <div className="turn-meta">
                      {entry.role === "user" ? "我" : "教练"} ·{" "}
                      {formatDate(entry.at)}
                    </div>

                    {entry.tools && entry.tools.length > 0 ? (
                      <div className="tool-traces">
                        {entry.tools.map((trace, i) => (
                          <span
                            key={i}
                            className={`tool-trace${trace.ok ? "" : " bad"}`}
                            title={trace.detail}
                          >
                            <span className="tool-trace-icon">
                              <IconSearch width={11} height={11} />
                            </span>
                            <span className="tool-trace-name">{trace.name}</span>
                            <span className="tool-trace-detail">
                              {trace.detail}
                            </span>
                            <span className="tool-trace-result">
                              {trace.result}
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : null}

                    <div className="turn-text">
                      <Markdown>{entry.content}</Markdown>
                    </div>
                  </div>
                </div>
              ))}

              {busy || streaming !== "" ? (
                <div className="turn">
                  <div className="turn-avatar">AI</div>
                  <div className="turn-body">
                    <div className="turn-meta">
                      {phase === "writing" ? "正在回答…" : "教练"}
                    </div>

                    {traces.length > 0 ? (
                      <div className="tool-traces">
                        {traces.map((trace, i) => (
                          <span
                            key={i}
                            className={`tool-trace${trace.ok ? "" : " bad"}`}
                            title={trace.detail}
                          >
                            <span className="tool-trace-icon">
                              <IconSearch width={11} height={11} />
                            </span>
                            <span className="tool-trace-name">{trace.name}</span>
                            <span className="tool-trace-detail">
                              {trace.detail}
                            </span>
                            <span className="tool-trace-result">
                              {trace.result}
                            </span>
                          </span>
                        ))}
                      </div>
                    ) : null}

                    {phase === "tools" || phase === "thinking" ? (
                      <div className="tool-running">
                        <span className="tool-running-dot" />
                        {PHASE_TEXT[phase]}
                      </div>
                    ) : null}

                    {streaming !== "" ? (
                      <div className="turn-text cursor">
                        <Markdown>{streaming}</Markdown>
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {/* 输入框固定在底部，不随对话滚动 */}
        <div className="session-composer">
          {completed ? (
            <div className="row">
              <span className="stat-label">
                本次训练已结束。想继续练同一个题目，可以
              </span>
              <Link href="/trainer/new" className="btn btn-sm">
                新建一次训练
              </Link>
            </div>
          ) : (
            <>
              <textarea
                ref={inputRef}
                className="textarea"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    void send();
                  }
                }}
                placeholder="写下你的分析或回答…（⌘/Ctrl + Enter 发送）"
                disabled={sending}
                rows={2}
              />
              <div className="composer-row">
                <button
                  className="btn btn-primary"
                  onClick={send}
                  disabled={sending || input.trim() === ""}
                >
                  <IconSend width={15} height={15} />
                  {sending ? "回答中…" : "发送"}
                </button>
                <button
                  className="btn"
                  onClick={finish}
                  disabled={generating || session.transcript.length === 0}
                  title={
                    session.transcript.length === 0
                      ? "至少完成一轮对话才能生成报告"
                      : "结束训练并生成评估报告"
                  }
                >
                  <IconReport width={15} height={15} />
                  {generating ? "生成报告中…" : "结束并生成报告"}
                </button>
                <div className="spacer" />
                <span className="stat-label">已作答 {answered} 轮</span>
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        title="删除这次训练"
        message="确定删除这次训练记录？对话和报告都会一起删掉，无法恢复。"
        busy={deleting}
        onConfirm={destroy}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
