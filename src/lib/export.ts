/**
 * 训练产出的导出。
 *
 * 一次训练结束后，用户应该能把它带走：
 * - Markdown：完整的训练记录 + 评分报告，可以直接贴进飞书/Notion
 * - PPT 大纲：基于同一份内容生成逐页大纲，交给 AI 或自己做成幻灯片
 *
 * 这里只负责拼字符串，不做 IO —— 下载由调用方用 Blob 触发，
 * 这样这些函数在服务端也能安全调用。
 */

import { modeName, scenarioName, scenarioSteps } from "./catalog";
import type { TrainingSession } from "./types";

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${fmtDate(iso)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 文件名里不能出现的字符统一换成短横线。 */
export function safeFileName(text: string): string {
  return (
    text
      .replace(/[\\/:*?"<>|\n\r\t]/g, "-")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 60) || "训练记录"
  );
}

/** 完整训练记录 + 评分报告，导出为 Markdown。 */
export function sessionToMarkdown(session: TrainingSession): string {
  const steps = scenarioSteps(session.scenario);
  const report = session.report;
  const lines: string[] = [];

  lines.push(`# ${scenarioName(session.scenario)}训练记录`, "");

  lines.push("## 基本信息", "");
  lines.push(`- 拆解对象：${session.topic}`);
  if (session.productType) lines.push(`- 产品类型：${session.productType}`);
  if (session.analysisGoal) lines.push(`- 拆解目标：${session.analysisGoal}`);
  lines.push(`- 训练模式：${modeName(session.mode)}`);
  lines.push(`- 训练日期：${fmtDate(session.createdAt)}`);
  if (steps.length > 0) {
    lines.push(
      `- 进度：第 ${session.currentStep ?? 1} 步 / 共 ${steps.length} 步`,
    );
  }
  lines.push("");

  if (steps.length > 0) {
    lines.push("## 训练流程", "");
    for (const s of steps) {
      lines.push(`${s.id}. **${s.name}** —— ${s.deliverable}`);
    }
    lines.push("");
  }

  lines.push("## 对话记录", "");
  if (session.mode === "solo") {
    lines.push("### 学员独立作答", "", session.submission || "（未提交内容）", "");
  } else if (session.transcript.length === 0) {
    lines.push("（没有对话记录）", "");
  } else {
    for (const entry of session.transcript) {
      lines.push(
        `### ${entry.role === "user" ? "学员" : "教练"} · ${fmtDateTime(entry.at)}`,
        "",
        entry.content,
        "",
      );
    }
  }

  if (report) {
    const max = report.overallMax && report.overallMax > 0 ? report.overallMax : 100;

    lines.push("## 评分", "");
    lines.push(
      `**总分：${report.overall} / ${max}**${
        report.grade ? ` —— ${report.grade}` : ""
      }`,
      "",
    );

    if (report.scores.length > 0) {
      lines.push("| 评分维度 | 得分 | 说明 |");
      lines.push("| --- | --- | --- |");
      for (const item of report.scores) {
        lines.push(
          `| ${item.dimension} | ${item.score}/${item.max} | ${item.comment.replace(/\|/g, "\\|")} |`,
        );
      }
      lines.push("");
    }

    if (report.summary) {
      lines.push("## 总体评价", "", report.summary, "");
    }

    const section = (title: string, items: string[]) => {
      if (items.length === 0) return;
      lines.push(`## ${title}`, "");
      for (const item of items) lines.push(`- ${item}`);
      lines.push("");
    };

    section("做得好的地方", report.strengths);
    section("需要改进", report.improvements);
    section("具体建议", report.suggestions);
    section("下一步练什么", report.nextSteps);
  }

  lines.push("---", "", `由「产品经理能力训练平台」导出 · ${fmtDate(new Date().toISOString())}`);

  return lines.join("\n");
}

/**
 * PPT 大纲。
 *
 * 按「一页一个要点」组织：先封面，再逐步展开训练流程，
 * 最后是评分与改进项。用户拿这份大纲可以让 AI 直接生成幻灯片。
 */
export function sessionToPptOutline(session: TrainingSession): string {
  const steps = scenarioSteps(session.scenario);
  const report = session.report;
  const lines: string[] = [];

  lines.push(`# ${scenarioName(session.scenario)} · 汇报大纲`, "");
  lines.push(`> 拆解对象：${session.topic}`);
  if (session.productType) lines.push(`> 产品类型：${session.productType}`);
  if (session.analysisGoal) lines.push(`> 拆解目标：${session.analysisGoal}`);
  lines.push("");

  lines.push("## 封面", "");
  lines.push(`- 标题：${session.topic}`);
  lines.push(`- 副标题：${scenarioName(session.scenario)}`);
  lines.push(`- 日期：${fmtDate(session.createdAt)}`);
  lines.push("");

  if (steps.length > 0) {
    lines.push("## 目录", "");
    for (const s of steps) lines.push(`- ${s.id}. ${s.name}`);
    lines.push("");
  }

  /* 每一步一页。学员在对话里的回答已经包含在各页要点里，
     这里只把该步的交付物作为「本页应回答的问题」列出来。 */
  steps.forEach((s, index) => {
    lines.push(`## 第 ${index + 2} 页：${s.name}`, "");
    lines.push(`- 本页要回答：${s.deliverable}`);
    lines.push(`- 信息来源：${s.whereToGet}`);
    lines.push("- 要点：（从对话记录里提炼 2-3 条）");
    lines.push("");
  });

  if (report) {
    const max = report.overallMax && report.overallMax > 0 ? report.overallMax : 100;
    const pageNo = steps.length + 2;

    lines.push(`## 第 ${pageNo} 页：评分总览`, "");
    lines.push(
      `- 总分：${report.overall} / ${max}${report.grade ? `（${report.grade}）` : ""}`,
    );
    for (const item of report.scores) {
      lines.push(`- ${item.dimension}：${item.score}/${item.max}`);
    }
    lines.push("");

    if (report.strengths.length > 0) {
      lines.push(`## 第 ${pageNo + 1} 页：做得好的地方`, "");
      for (const item of report.strengths) lines.push(`- ${item}`);
      lines.push("");
    }
    if (report.improvements.length > 0) {
      lines.push(`## 第 ${pageNo + 2} 页：需要改进`, "");
      for (const item of report.improvements) lines.push(`- ${item}`);
      lines.push("");
    }
    if (report.suggestions.length > 0) {
      lines.push(`## 第 ${pageNo + 3} 页：下一步行动`, "");
      for (const item of report.suggestions) lines.push(`- ${item}`);
      lines.push("");
    }
  }

  return lines.join("\n");
}
