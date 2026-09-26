"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useCallback, useEffect, useRef, useState } from "react";

import { Markdown } from "@/components/Markdown";
import { ConfirmDialog } from "@/components/Modal";
import { SCENARIOS, modeName, scenarioName, scenarioSteps } from "@/lib/catalog";
import { apiGet, apiSend, formatDate } from "@/lib/client";
import type { ToolTrace, TrainingSession } from "@/lib/types";

/** 流式协议里的控制帧前缀，与服务端约定一致。 */
const CTRL = "\u001e";

/** 服务端流中途失败时追加的标记：它仍走 HTTP 200。 */
const INTERRUPT = "[生成中断]";

/** 当前 AI 处于哪个阶段，用来给用户即时反馈。
 *  注意别用「作答」：训练师是在带你练，不是在考试里答题。
 *  它给的是回应和追问，所以这里说「回应」。 */
type Phase = "idle" | "tools" | "thinking" | "writing";

const PHASE_TEXT: Record<Phase, string> = {
  idle: "",
  tools: "正在检索资料",
  thinking: "正在思考",
  writing: "正在回应",
};

/** 时钟：转录里每一轮只留时分，日期在页头说过一次就够了。 */
function clock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** AI 说的话里，「【当前步骤】第2步：…」是它自己标注的进度，提出来当旁注。 */
function stepTag(content: string, steps: { id: number; name: string }[]): string {
  const hit = /【当前步骤】\s*第\s*(\d+)\s*步/.exec(content);
  if (!hit) return "";
  const n = Number(hit[1]);
  const step = steps.find((s) => s.id === n);
  return step ? `第 ${n} 步：${step.name}` : `第 ${n} 步`;
}

/**
 * 工具轨迹：训练是过程导向的，所以「查了什么、命中几条」要留在页面上。
 * 这里是给人读的一句话，不是一条等宽日志。
 */
function traceSummary(trace: ToolTrace): string {
  const name = trace.name.replace(/^mcp__/, "").replace(/__/g, " / ");
  const detail = trace.detail.trim();
  const result = trace.result.trim();
  if (trace.ok) {
    return `${name} 查了 ${detail}${result ? `，${result}` : ""}`;
  }
  return `${name} 在 ${detail} 上没成功${result ? `：${result}` : ""}`;
}

/**
 * 把落库正文拆成「真正的回答」和「中断说明」。
 *
 * 服务端在生成失败时会把 `[生成中断] 原因` 追加进这一轮的内容并照常落库，
 * 所以历史记录里也会带这个标记。它是给用户看的故障说明，不是训练师说的话 ——
 * 直接当正文渲染会读成「AI 在跟我讲协议」，所以要拆出来单独呈现。
 */
function splitInterrupt(content: string): { body: string; cut: string } {
  const at = content.indexOf(INTERRUPT);
  if (at < 0) return { body: content, cut: "" };
  return {
    body: content.slice(0, at).trimEnd(),
    cut: content
      .slice(at + INTERRUPT.length)
      .trim()
      .replace(/^[：:]\s*/, ""),
  };
}

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

  /**
   * 刚发出去、服务端还没确认的那一轮。
   *
   * 服务端其实在调用模型之前就把用户消息写进 transcript 了，但客户端要等整轮
   * 生成结束才 load() —— 中间十几秒屏幕上找不到自己刚发的话，看起来像没发出去。
   * 所以本地先顶上一条，等 transcript 真的长出来了再交班。
   */
  const [pendingUser, setPendingUser] = useState<{
    content: string;
    at: string;
  } | null>(null);

  /** 本轮的实时状态：阶段 + 已经发生的工具调用。 */
  const [phase, setPhase] = useState<Phase>("idle");
  const [liveTraces, setLiveTraces] = useState<ToolTrace[]>([]);
  const [toolNote, setToolNote] = useState<string | null>(null);

  const [submission, setSubmission] = useState("");
  const [generating, setGenerating] = useState(false);

  const kickedOff = useRef(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  /* 服务端 transcript 的当前长度。发送前记一份基线，load() 之后比一下，
     就知道这一轮有没有真的落库（而不是靠猜）。 */
  const transcriptLenRef = useRef(0);
  const pendingBaseRef = useRef(0);

  const load = useCallback(async () => {
    try {
      const data = await apiGet<TrainingSession>(`/api/sessions/${id}`);
      setSession(data);
      transcriptLenRef.current = data.transcript.length;
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

  /** transcript 比基线长了，说明临时那条已经落库，可以撤掉，交给正式数据渲染。 */
  const settlePending = useCallback(() => {
    setPendingUser((prev) =>
      prev && transcriptLenRef.current > pendingBaseRef.current ? null : prev,
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [session?.transcript.length, pendingUser, streaming, phase]);

  /** 输入框随内容长高，最多到 CSS 里的 max-height。 */
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 190)}px`;
  }, [input]);

  /** 发一轮对话，把训练师的回答以流式方式显示出来。 */
  const talk = useCallback(
    async (payload: { content?: string; kickoff?: boolean }) => {
      setSending(true);
      setStreaming("");
      setLiveTraces([]);
      setToolNote(null);
      setPhase("thinking");
      setError("");

      /* 用户这一轮立刻上屏，不等模型。开场白没有用户内容，跳过。 */
      if (payload.content) {
        pendingBaseRef.current = transcriptLenRef.current;
        setPendingUser({ content: payload.content, at: new Date().toISOString() });
      }

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

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          /* 先把控制帧摘出来（它们总是完整的单行），剩下的才是正文。
             帧没接收完就先留着，等下一个分片。 */
          while (buffer.startsWith(CTRL)) {
            const newline = buffer.indexOf("\n");
            if (newline === -1) break;
            const line = buffer.slice(1, newline);
            buffer = buffer.slice(newline + 1);
            try {
              const frame = JSON.parse(line) as {
                type?: string;
                phase?: Phase;
                traces?: ToolTrace[];
                note?: string | null;
              };
              if (frame.type === "status" && frame.phase) setPhase(frame.phase);
              if (frame.type === "tools") {
                setLiveTraces(frame.traces ?? []);
                setToolNote(frame.note ?? null);
              }
            } catch {
              // 坏帧直接丢，不影响正文
            }
          }

          if (buffer !== "" && !buffer.startsWith(CTRL)) {
            answer += buffer;
            buffer = "";
            setStreaming(answer);
          }
        }

        setStreaming("");
        setPhase("idle");

        /* 【关键】流中途失败时服务端仍返回 HTTP 200，只在正文尾部追加
           「[生成中断] 原因」。所以 response.ok 说明不了任何事，
           必须在这一步自己把它认出来，否则会当成一次正常回答。 */
        const cut = answer.indexOf(INTERRUPT);
        const interrupted =
          cut >= 0
            ? answer
                .slice(cut + INTERRUPT.length)
                .trim()
                .replace(/^[：:]\s*/, "") || "生成中断，请重试"
            : "";

        /* 先把落库的那一轮拉回来，再报错 —— load() 成功时会清空 error，
           顺序反了的话这条错误刚设上就被自己抹掉。 */
        await load();
        settlePending();
        setLiveTraces([]);
        if (interrupted) setError(interrupted);
      } catch (e) {
        setStreaming("");
        setPhase("idle");
        setError(e instanceof Error ? e.message : "对话失败");
        /* 生成中断时服务端往往已经把这一轮存下了，拉回来看看再决定
           要不要继续挂着那条临时消息。 */
        await load();
        settlePending();
      } finally {
        setSending(false);
      }
    },
    [id, load, settlePending],
  );

  // 实时模式：进入页面后让训练师先开场
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
        <Link href="/trainer" className="vs-btn">
          回到全部训练
        </Link>
      </div>
    );
  }

  const isSolo = session.mode === "solo";
  const completed = session.status === "completed";
  const steps = scenarioSteps(session.scenario);
  const currentStep = session.currentStep ?? 0;
  const answered = session.transcript.filter((t) => t.role === "user").length;
  const traces = liveTraces;
  const busy = phase !== "idle";

  /* 对话区铺满 .session-body（外层已经是 1360 版心），只有正文本身限宽：
     一行放得下 30 来个汉字最舒服，但整块面板必须跟着版心走 ——
     否则面板被挤窄、右侧留一大片空板，看起来像页面没做满。 */
  const SHEET = { width: "100%" } as const;
  const READING = { maxWidth: 760, margin: "0 auto", width: "100%" } as const;

  /* ---- 头部 ---- */
  const head = (
    <div className="detail-head">
      <Link href="/trainer" className="detail-back" title="返回训练列表">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          width={14}
          height={14}
          aria-hidden="true"
        >
          <path d="M15 6l-6 6 6 6" />
        </svg>
        回到全部训练
      </Link>

      <div className="detail-title-wrap">
        <h1 className="detail-title">{session.topic}</h1>
        <div className="detail-meta">
          <span className="detail-meta-item">{scenarioName(session.scenario)}</span>
          <span className="detail-meta-item">{modeName(session.mode)}</span>
          {session.productType ? (
            <span className="detail-meta-item">{session.productType}</span>
          ) : null}
          <span className="detail-meta-item">
            {completed ? "已结束" : "进行中"}
          </span>
          <span className="detail-meta-item">
            {steps.length > 0
              ? `进行到第 ${Math.min(Math.max(currentStep || 1, 1), steps.length)} 步`
              : "无固定步骤"}
          </span>
        </div>
      </div>

      <div className="detail-actions">
        {session.report ? (
          <Link href={`/trainer/${session.id}/report`} className="vs-btn on">
            看报告
          </Link>
        ) : (
          <button
            className="vs-btn on"
            onClick={finish}
            disabled={generating || session.transcript.length === 0}
            title={
              session.transcript.length === 0
                ? "至少完成一轮对话才能出报告"
                : "结束这次训练并让训练师评分"
            }
          >
            {generating ? "正在评分…" : "结束并出报告"}
          </button>
        )}
        <button className="vs-btn" onClick={() => setConfirming(true)}>
          删除
        </button>
      </div>
    </div>
  );

  const dialog = (
    <ConfirmDialog
      open={confirming}
      title="删除这次训练"
      message="确定删除这次训练记录？对话和报告都会一起删掉，无法恢复。"
      busy={deleting}
      onConfirm={destroy}
      onCancel={() => setConfirming(false)}
    />
  );

  /* ---- 独立训练：没有对话，就是一份作答 ---- */
  if (isSolo) {
    return (
      <div className="stack">
        {head}
        {error ? <div className="notice notice-error">{error}</div> : null}

        <div style={SHEET}>
          <div className="sheet-head">
            <h2>独立作答</h2>
            <p
              style={{
                fontSize: 13.5,
                color: "var(--ink-3)",
                lineHeight: 1.85,
                marginTop: 8,
                maxWidth: 560,
              }}
            >
              训练过程里 AI 不介入。写完提交，训练师再按评分表批改。
              结论先行，每个判断给出依据，把事实和推断分开写。
            </p>
          </div>

          <textarea
            className="textarea textarea-lg"
            value={submission}
            onChange={(e) => setSubmission(e.target.value)}
            placeholder="结论先行，每个判断给出依据，区分事实与推断。"
            disabled={generating}
          />

          <div
            className="row"
            style={{ marginTop: 14, alignItems: "baseline", gap: 16 }}
          >
            <button
              className="composer-send"
              style={{ width: "auto", padding: "0 20px", height: 36 }}
              onClick={finish}
              disabled={generating || submission.trim() === ""}
            >
              <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>
                {generating
                  ? "批改中…"
                  : session.report
                    ? "重新生成报告"
                    : "提交作答并生成报告"}
              </span>
            </button>
            <span className="stat-label">
              已写 {submission.length} 字。建议至少 300 字，太短看不出思维过程。
            </span>
          </div>
        </div>

        {dialog}
      </div>
    );
  }

  /* ---- 实时训练：逐条读的往来记录 ---- */
  return (
    <div className="session-shell">
      {head}

      {error ? <div className="notice notice-error">{error}</div> : null}

      {/* 不要在这里写 display:block —— .session-body 的 CSS 是 flex，
          写成 block 会让 .session-chat 不再是 flex item，
          min-height:0 失效、面板被内容撑到 1864px，内层滚动就死了。 */}
      <div className="session-body">
        <div className="session-chat" style={{ ...SHEET }}>
          {/* 分步场景：流程摆在正文上方，读到哪一步一眼就知道。 */}
          {steps.length > 0 ? (
            <div className="stepbar" style={READING}>
              {steps.map((s, index) => {
                const at = Math.min(Math.max(currentStep || 1, 1), steps.length);
                const state =
                  completed || s.id < at ? "done" : s.id === at ? "on" : "";
                return (
                  <span key={s.id} style={{ display: "contents" }}>
                    <span
                      className={`step-chip ${state}`}
                      title={`第 ${s.id} 步：${s.name}`}
                    >
                      <span className="step-chip-n">{s.id}</span>
                      {s.name}
                    </span>
                    {index < steps.length - 1 ? (
                      <span className="step-chip-line" />
                    ) : null}
                  </span>
                );
              })}
            </div>
          ) : null}

          <div className="session-scroll">
            <div style={READING}>
            {session.transcript.length === 0 &&
            pendingUser === null &&
            streaming === "" &&
            !busy ? (
              <div className="empty-board" style={{ margin: "40px 0" }}>
                <h3>还没有开始</h3>
                <p>写下第一句，或者刷新页面让训练师先开场。</p>
              </div>
            ) : (
              <div className="turns">
                {session.transcript.map((entry, index) => {
                  const isUser = entry.role === "user";
                  const { body, cut } = splitInterrupt(entry.content);
                  const tag = isUser ? "" : stepTag(body, steps);
                  return (
                    <article
                      key={index}
                      className={`turn turn-${isUser ? "user" : "ai"}`}
                    >
                      <div className="turn-role">
                        <span>{isUser ? "我" : "训练师"}</span>
                        <span>{clock(entry.at)}</span>
                        {tag ? <span className="tag">{tag}</span> : null}
                        {cut ? <span className="tag">生成中断</span> : null}
                      </div>

                      {entry.tools && entry.tools.length > 0 ? (
                        <div className="turn-tools">
                          {entry.tools.map((trace, i) => (
                            <div key={i} className="turn-tool">
                              <span className="st">{trace.ok ? "✓" : "!"}</span>
                              <span>{traceSummary(trace)}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}

                      {body ? (
                        <div className="turn-body">
                          <Markdown>{body}</Markdown>
                        </div>
                      ) : null}

                      {cut ? (
                        <div className="turn-tool">
                          <span className="st">!</span>
                          <span>
                            这一轮没生成完。{cut} 重发一次就好，已经说过的都还在。
                          </span>
                        </div>
                      ) : null}
                    </article>
                  );
                })}

                {/* 本地临时消息：发出去就上屏，服务端落库后自动让位给正式记录。 */}
                {pendingUser !== null ? (
                  <article className="turn turn-user">
                    <div className="turn-role">
                      <span>我</span>
                      <span>{clock(pendingUser.at)}</span>
                    </div>
                    <div className="turn-body">
                      <Markdown>{pendingUser.content}</Markdown>
                    </div>
                  </article>
                ) : null}

                {busy || streaming !== "" ? (
                  <article className="turn turn-ai">
                    <div className="turn-role">
                      <span>训练师</span>
                      <span>{PHASE_TEXT[phase] || "正在回应"}</span>
                    </div>

                    {traces.length > 0 ? (
                      <div className="turn-tools">
                        {traces.map((trace, i) => (
                          <div key={i} className="turn-tool">
                            <span className="st">{trace.ok ? "✓" : "!"}</span>
                            <span>{traceSummary(trace)}</span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    {toolNote ? (
                      <div className="turn-tool">
                        <span className="st">i</span>
                        <span>{toolNote}</span>
                      </div>
                    ) : null}

                    {streaming !== "" ? (
                      <div className="turn-body cursor">
                        <Markdown>{streaming}</Markdown>
                      </div>
                    ) : (
                      <div className="turn-body">
                        <span className="typing" />
                      </div>
                    )}
                  </article>
                ) : null}

                <div ref={bottomRef} />
              </div>
            )}
            </div>
          </div>

          {/* 输入区贴在底部，不用滚到底才能打字。 */}
          <div className="composer-dock">
            <div className="composer-box" style={READING}>
              {completed ? (
                <div className="composer-row">
                  <span className="composer-note">
                    这次训练已经结束了。想再练同一个题目，就新建一场。
                  </span>
                  <Link
                    href="/trainer/new"
                    className="vs-btn on"
                    style={{ marginLeft: "auto" }}
                  >
                    新建训练
                  </Link>
                </div>
              ) : (
                <>
                  <textarea
                    ref={inputRef}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                    placeholder="说出你的想法、判断或疑问…（⌘/Ctrl + Enter 发送，Shift + Enter 换行）"
                    disabled={sending}
                    rows={2}
                  />
                  <div className="composer-row">
                    <span className="composer-note">
                      {sending
                        ? PHASE_TEXT[phase] || "训练师正在读你说的"
                        : `已答 ${answered} 轮`}
                    </span>
                    <button
                      className="composer-send"
                      onClick={send}
                      disabled={sending || input.trim() === ""}
                      aria-label="发送"
                      title="发送（⌘/Ctrl + Enter）"
                    >
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={1.7}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        width={16}
                        height={16}
                        aria-hidden="true"
                      >
                        <path d="M5 12 20.5 4.5 13 20l-1.8-6.2z" />
                        <path d="m11.2 13.8 3.4-3.4" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {dialog}
    </div>
  );
}
