"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { ReportView } from "@/components/ReportView";
import { apiGet, apiSend, formatDate } from "@/lib/client";
import { modeName, scenarioName, scenarioSteps } from "@/lib/catalog";
import {
  safeFileName,
  sessionToMarkdown,
  sessionToPptOutline,
} from "@/lib/export";
import type { TrainingSession } from "@/lib/types";

/** 触发一次浏览器下载。 */
function download(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * 训练报告页。
 *
 * 报告是一次训练的产出物，值得一个独立页面：能单独分享、能回看、
 * 能导出，也不会把会话页挤得很长。
 */
export default function ReportPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [session, setSession] = useState<TrainingSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    try {
      setSession(await apiGet<TrainingSession>(`/api/sessions/${id}`));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function regenerate() {
    setGenerating(true);
    setError("");
    try {
      /* 接口返回的是更新后的整条 TrainingSession，不是单独的 report。 */
      await apiSend(`/api/sessions/${id}/report`, "POST");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成报告失败");
    } finally {
      setGenerating(false);
    }
  }

  if (loading) return <div className="loading">加载中…</div>;

  if (!session) {
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <h1>训练报告</h1>
            <p className="lede">{error || "没有找到这次训练。"}</p>
          </div>
          <div className="page-actions">
            <Link href="/trainer" className="vs-btn">
              回到全部训练
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const steps = scenarioSteps(session.scenario);
  const answered = session.transcript.filter((m) => m.role === "user").length;
  const ready = Boolean(session.report);

  return (
    <div className="stack">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>训练报告</h1>
          <p className="lede">
            <Link href={`/trainer/${session.id}`}>
              <span style={{ textDecoration: "underline" }}>{session.topic}</span>
            </Link>
            <br />
            {scenarioName(session.scenario)}，{modeName(session.mode)}，已答 {answered} 轮
            {steps.length > 0
              ? `，进行到第 ${Math.min(Math.max(session.currentStep || 1, 1), steps.length)} 步`
              : ""}
            。最近改动 {formatDate(session.updatedAt)}。
          </p>
        </div>

        <div className="page-actions">
          <button
            className="vs-btn"
            onClick={() =>
              download(
                `${safeFileName(session.topic)}-训练记录.md`,
                sessionToMarkdown(session),
              )
            }
            disabled={!ready}
            title={ready ? "导出完整训练记录与评分" : "先生成报告再导出"}
          >
            导出记录
          </button>
          <button
            className="vs-btn"
            onClick={() =>
              download(
                `${safeFileName(session.topic)}-汇报大纲.md`,
                sessionToPptOutline(session),
              )
            }
            disabled={!ready}
            title={ready ? "导出逐页 PPT 大纲" : "先生成报告再导出"}
          >
            PPT 大纲
          </button>
          <button
            className="vs-btn on"
            onClick={regenerate}
            disabled={generating}
            title="让训练师重新评一次"
          >
            {generating ? "正在评…" : ready ? "重新生成" : "生成报告"}
          </button>
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      {session.report ? (
        <ReportView report={session.report} topic={session.topic} />
      ) : (
        <div className="empty-board">
          <h3>还没有报告</h3>
          <p>
            报告是训练结束时由训练师按评分表打的分。
            回到对话继续作答，或者直接点右上「生成报告」让它现在评。
          </p>
          <div className="hint-actions">
            <Link href={`/trainer/${session.id}`}>回到对话</Link>
            <button className="go" onClick={regenerate} disabled={generating}>
              {generating ? "正在评…" : "现在生成报告"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
