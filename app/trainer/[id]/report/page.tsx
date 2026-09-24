"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  IconBack,
  IconChat,
  IconDownload,
  IconReport,
  IconSlides,
} from "@/components/icons";
import { ReportView } from "@/components/ReportView";
import { apiGet, apiSend } from "@/lib/client";
import { scenarioName } from "@/lib/catalog";
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
 * 报告是一次训练的产出物，值得一个独立页面：
 * 能单独分享、能回看、能打印，也不会把会话页挤得很长。
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
      await apiSend(`/api/sessions/${id}/report`, "POST");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成报告失败");
    } finally {
      setGenerating(false);
    }
  }

  if (loading) {
    return (
      <div className="stack">
        <div className="loading">加载中…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="stack">
        <div className="page-head">
          <div>
            <h1>训练报告</h1>
          </div>
          <div className="page-actions">
            <Link href="/trainer" className="btn">
              <IconBack width={14} height={14} />
              返回训练师
            </Link>
          </div>
        </div>
        <div className="folder-pane">
          <div className="empty">{error || "没有找到这次训练。"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="detail-head">
        <Link
          href={`/trainer/${session.id}`}
          className="btn btn-sm detail-back"
          title="返回这次训练的对话"
        >
          <IconBack width={14} height={14} />
          返回对话
        </Link>

        <div className="detail-title-wrap">
          <h1 className="detail-title">训练报告</h1>
          <div className="detail-meta">
            <span className="detail-meta-item">
              <IconReport width={13} height={13} />
              {scenarioName(session.scenario)}
            </span>
            <span className="detail-meta-item">
              <IconChat width={13} height={13} />
              {session.transcript.filter((m) => m.role === "user").length} 轮作答
            </span>
            <span className="detail-meta-item">{session.topic}</span>
          </div>
        </div>

        <div className="detail-actions">
          <button
            className="btn btn-sm"
            onClick={() =>
              download(
                `${safeFileName(session.topic)}-训练记录.md`,
                sessionToMarkdown(session),
              )
            }
            disabled={!session.report}
            title={
              session.report
                ? "导出完整训练记录与评分（Markdown）"
                : "先生成报告再导出"
            }
          >
            <IconDownload width={13} height={13} />
            导出 MD
          </button>
          <button
            className="btn btn-sm"
            onClick={() =>
              download(
                `${safeFileName(session.topic)}-汇报大纲.md`,
                sessionToPptOutline(session),
              )
            }
            disabled={!session.report}
            title={
              session.report
                ? "导出逐页 PPT 大纲（Markdown）"
                : "先生成报告再导出"
            }
          >
            <IconSlides width={13} height={13} />
            PPT 大纲
          </button>
          <button
            className="btn btn-sm"
            onClick={regenerate}
            disabled={generating}
            title="让 AI 重新评估一次"
          >
            {generating ? "生成中…" : session.report ? "重新生成" : "生成报告"}
          </button>
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      <div className="folder-pane">
        {session.report ? (
          <ReportView report={session.report} topic={session.topic} />
        ) : (
          <div className="empty">
            还没有报告。回到对话继续作答，或点右上「生成报告」让 AI 现在评估。
          </div>
        )}
      </div>
    </div>
  );
}
