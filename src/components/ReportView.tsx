"use client";

import { scoreTone } from "@/lib/client";
import { gradeFor } from "@/lib/catalog";
import type { TrainingReport } from "@/lib/types";

/**
 * 训练报告。
 *
 * 报告是一次训练的产出物，读法是一份批改过的作业：
 * 先给总分（一眼看到落在哪一档），再逐维度看扣在哪，
 * 最后是「下一步练什么」—— 那才是下一次训练要带走的东西。
 *
 * 版式上不用彩色进度条 + 圆角卡片：分数用字重和字号说话，
 * 维度用一条刻度线对齐，一屏只有一处朱砂。
 */

/** 维度刻度：实心部分是得分，整条是满分。不用彩色，用墨的深浅。 */
function Tick({ score, max }: { score: number; max: number }) {
  const ratio = max > 0 ? Math.max(0, Math.min(1, score / max)) : 0;
  const lost = ratio < 0.6;
  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        display: "block",
        width: "100%",
        height: 4,
        background: "var(--rule)",
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: `${ratio * 100}%`,
          background: lost ? "var(--mark)" : "var(--ink)",
        }}
      />
    </span>
  );
}

/** 报告里的一节：小标题 + 条目。条目本身是句子，不是标签云。 */
const READING = { maxWidth: 880 } as const;

function Section({
  title,
  lead,
  items,
  markFirst = false,
}: {
  title: string;
  lead: string;
  items: string[];
  markFirst?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    /* 这些条目是句子，限宽到一行 30 来个汉字；和总体评价同一个阅读栏。 */
    <section style={{ marginTop: 34, ...READING }}>
      <h2
        style={{
          fontFamily: "var(--serif)",
          fontSize: 17,
          fontWeight: 600,
          marginBottom: 4,
        }}
      >
        {title}
      </h2>
      <p
        style={{
          fontSize: 13,
          color: "var(--ink-3)",
          lineHeight: 1.8,
          marginBottom: 14,
        }}
      >
        {lead}
      </p>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 0,
        }}
      >
        {items.map((item, index) => (
          <li
            key={index}
            style={{
              position: "relative",
              padding: "11px 0 11px 20px",
              borderTop: "1px solid var(--rule-2)",
              fontSize: 14.5,
              lineHeight: 1.85,
              color: "var(--ink-2)",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                position: "absolute",
                left: 2,
                top: 20,
                width: 5,
                height: 1,
                background: "var(--ink-4)",
              }}
            />
            {markFirst && index === 0 ? (
              <strong style={{ color: "var(--ink)", fontWeight: 600 }}>
                {item}
              </strong>
            ) : (
              item
            )}
          </li>
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
  /* 老报告可能没有 overallMax / grade，兜底成百分制。 */
  const overallMax =
    report.overallMax && report.overallMax > 0 ? report.overallMax : 100;
  const ratio = overallMax > 0 ? (report.overall / overallMax) * 100 : 0;
  const tone = scoreTone(ratio);
  const grade = report.grade || gradeFor(report.overall, overallMax);

  const weakest = [...report.scores].sort(
    (a, b) => a.score / (a.max || 1) - b.score / (b.max || 1),
  )[0];

  return (
    /* 整块铺满版心。报告是长文，但外层不该再套一层窄容器 ——
       那样右侧会空掉一大片，看起来像页面没做满。
       需要限宽的只有真正成段的正文（见 READING）。 */
    <div style={{ width: "100%" }}>
      {/* ---- 卷首：总分说了算 ---- */}
      <header
        style={{
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "space-between",
          gap: 26,
          flexWrap: "wrap",
          paddingBottom: 20,
          borderBottom: "2px solid var(--ink)",
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <h1
            style={{
              fontFamily: "var(--serif)",
              fontSize: 30,
              fontWeight: 600,
              lineHeight: 1.25,
            }}
          >
            {topic}
          </h1>
          <p
            style={{
              fontSize: 13,
              color: "var(--ink-3)",
              marginTop: 8,
              lineHeight: 1.8,
            }}
          >
            训练师按这次训练的评分表打了 {report.scores.length} 个维度，
            总分 {report.overall} 分（满分 {overallMax}）。
            {weakest && ratio < 100
              ? ` 扣得最狠的是「${weakest.dimension}」。`
              : ""}
          </p>
        </div>

        <div style={{ flex: "0 0 auto", textAlign: "right" }}>
          <div
            style={{
              fontFamily: "var(--serif)",
              fontSize: 54,
              fontWeight: 600,
              lineHeight: 1,
              letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {report.overall}
            <span
              style={{
                fontSize: 16,
                color: "var(--ink-4)",
                fontWeight: 400,
                marginLeft: 4,
              }}
            >
              / {overallMax}
            </span>
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 13,
              color: tone === "bad" ? "var(--mark)" : "var(--ink-2)",
              fontWeight: 600,
            }}
          >
            {grade}
          </div>
        </div>
      </header>

      {/* ---- 总体评价 ---- */}
      {report.summary ? (
        <section style={{ marginTop: 28, ...READING }}>
          <p
            style={{
              fontSize: 16,
              lineHeight: 1.95,
              color: "var(--ink)",
              whiteSpace: "pre-wrap",
              margin: 0,
            }}
          >
            {report.summary}
          </p>
        </section>
      ) : null}

      {/* ---- 分项评分 ---- */}
      {report.scores.length > 0 ? (
        <section style={{ marginTop: 40 }}>
          <h2
            style={{
              fontFamily: "var(--serif)",
              fontSize: 17,
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            分项评分
          </h2>
          <p
            style={{
              fontSize: 13,
              color: "var(--ink-3)",
              lineHeight: 1.8,
              marginBottom: 8,
            }}
          >
            刻度是这一项的满分。落在后半段的用朱砂标出来。
          </p>

          <div>
            {report.scores.map((item) => (
              <div
                key={item.dimension}
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(120px, 168px) 1fr 54px",
                  alignItems: "center",
                  gap: 16,
                  padding: "13px 0 11px",
                  borderTop: "1px solid var(--rule-2)",
                }}
              >
                <span
                  style={{
                    fontSize: 13.5,
                    color: "var(--ink)",
                    fontWeight: 550,
                    lineHeight: 1.5,
                  }}
                >
                  {item.dimension}
                </span>

                <Tick score={item.score} max={item.max} />

                <span
                  style={{
                    textAlign: "right",
                    fontVariantNumeric: "tabular-nums",
                    fontSize: 14,
                    fontWeight: 600,
                  }}
                >
                  {item.score}
                  <span
                    style={{ fontSize: 11.5, color: "var(--ink-4)", fontWeight: 400 }}
                  >
                    /{item.max}
                  </span>
                </span>

                {item.comment ? (
                  <span
                    style={{
                      gridColumn: "1 / -1",
                      fontSize: 12.5,
                      lineHeight: 1.75,
                      color: "var(--ink-3)",
                      paddingTop: 2,
                    }}
                  >
                    {item.comment}
                  </span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Section
        title="做得好的地方"
        lead="这些是这次已经成立的做法，下次直接复用。"
        items={report.strengths}
      />
      <Section
        title="需要改进"
        lead="这里是扣分点。每一条都对应上面某个维度的失分。"
        items={report.improvements}
        markFirst
      />
      <Section
        title="具体建议"
        lead="照着改就能加分的动作。"
        items={report.suggestions}
      />
      <Section
        title="下一步练什么"
        lead="下次开新训练时，直接拿这条当题目。"
        items={report.nextSteps}
        markFirst
      />

      <p
        style={{
          marginTop: 40,
          paddingTop: 14,
          borderTop: "1px dashed var(--rule)",
          fontSize: 12,
          color: "var(--ink-4)",
          ...READING,
        }}
      >
        报告生成于 {report.generatedAt ? report.generatedAt.slice(0, 10) : "—"}
        ，重新生成会覆盖这一份。
      </p>
    </div>
  );
}
