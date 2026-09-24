"use client";

import { scoreTone } from "@/lib/client";
import {
  IconAlert,
  IconCheck,
  IconReport,
  IconSpark,
  IconTarget,
  IconTrend,
} from "@/components/icons";
import type { TrainingReport } from "@/lib/types";

function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const ratio = max > 0 ? (score / max) * 100 : 0;
  return (
    <div className="score-bar">
      <div
        className={`score-fill ${scoreTone(ratio)}`}
        style={{ width: `${Math.max(0, Math.min(100, ratio))}%` }}
      />
    </div>
  );
}

/** 每个小节带一个图标：报告本身信息密度高，图标能帮眼睛快速定位。 */
function Bullets({
  title,
  items,
  Icon,
  tone = "brand",
}: {
  title: string;
  items: string[];
  Icon: typeof IconCheck;
  tone?: "brand" | "good" | "warn";
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <div className="detail-section-head" style={{ color: `var(--${tone})` }}>
        <Icon width={15} height={15} />
        <h2>{title}</h2>
      </div>
      <ul className="detail-list">
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

export function ReportView({
  report,
  topic,
}: {
  report: TrainingReport;
  topic: string;
}) {
  // 老报告可能没有 overallMax / grade，兜底成百分制
  const overallMax = report.overallMax && report.overallMax > 0 ? report.overallMax : 100;
  const ratio = (report.overall / overallMax) * 100;
  const tone = scoreTone(ratio);

  return (
    <div className="detail-body" style={{ maxWidth: 860 }}>
      {/* 总分区：分数是报告里最该被一眼看到的东西 */}
      <div className="card">
        <div className="row" style={{ alignItems: "flex-start", marginBottom: 6 }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <div className="row" style={{ gap: 7, marginBottom: 2 }}>
              <IconReport width={16} height={16} style={{ color: "var(--brand)" }} />
              <h2>训练报告</h2>
            </div>
            <div className="list-sub">{topic}</div>
            {report.grade ? (
              <div style={{ marginTop: 8 }}>
                <span className={`tag tag-${tone}`}>{report.grade}</span>
              </div>
            ) : null}
          </div>
          <div style={{ textAlign: "right" }}>
            <div className="big-score" style={{ color: `var(--${tone})` }}>
              {report.overall}
            </div>
            <div className="stat-label">总分 / {overallMax}</div>
          </div>
        </div>

        <p style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{report.summary}</p>
      </div>

      {report.scores.length > 0 ? (
        <section>
          <div className="detail-section-head">
            <IconTrend width={15} height={15} />
            <h2>分项评分</h2>
          </div>
          <div className="card">
            {report.scores.map((item) => (
              <div key={item.dimension} className="score-row">
                <div style={{ fontSize: 13, fontWeight: 550 }}>{item.dimension}</div>
                <ScoreBar score={item.score} max={item.max} />
                <div className="score-value">
                  {item.score}
                  <span className="score-max">/{item.max}</span>
                </div>
                {item.comment ? (
                  <div className="score-comment">{item.comment}</div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Bullets
        title="做得好的地方"
        items={report.strengths}
        Icon={IconCheck}
        tone="good"
      />
      <Bullets
        title="需要改进"
        items={report.improvements}
        Icon={IconAlert}
        tone="warn"
      />
      <Bullets title="具体建议" items={report.suggestions} Icon={IconSpark} />
      <Bullets title="下一步练什么" items={report.nextSteps} Icon={IconTarget} />
    </div>
  );
}
