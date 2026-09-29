"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { CAPTURE_KINDS, DOMAINS, captureKindName } from "@/lib/catalog";
import { apiGet, apiSend } from "@/lib/client";
import { DomainTags } from "@/components/DomainTags";
import type { Capture, CaptureDigest } from "@/lib/types";

/**
 * 记录的编辑页 —— 「贴原文 → AI 读一遍 → 自己再写思考」。
 *
 * 为什么把这段从弹窗搬出来：弹窗只适合「填完就走」的短表单。
 * 而这个流程里有三件重活 —— 贴一段长原文、等 AI 读、看结果再逐项决定 ——
 * 塞进弹窗会一直滚动，还会在关闭时丢掉已经生成的东西。
 *
 * 分工：
 * - 原文框是**临时的**，不落库。生成的摘记已经把它提炼过了，留着原文没用。
 * - 总结 / 要点 / 标签 / 领域由 AI 产出，但都可以在保存前改。
 * - 笔记思考是留给他自己的，AI 不碰。
 */

type Phase = "idle" | "thinking" | "writing";

export default function CaptureEditPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params.id;

  const [capture, setCapture] = useState<Capture | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  /** 临时原文，不落库 */
  const [raw, setRaw] = useState("");
  const [aiReady, setAiReady] = useState<boolean | null>(null);
  const [digesting, setDigesting] = useState(false);
  const [digestError, setDigestError] = useState("");
  const [digestNote, setDigestNote] = useState("");

  /** 可编辑字段 */
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<Capture["kind"]>("note");
  const [author, setAuthor] = useState("");
  const [source, setSource] = useState("");
  const [summary, setSummary] = useState("");
  const [points, setPoints] = useState("");
  const [tags, setTags] = useState("");
  const [domains, setDomains] = useState<string[]>([]);
  const [thoughts, setThoughts] = useState("");

  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const hydrate = useCallback((c: Capture) => {
    setTitle(c.title);
    setKind(c.kind);
    setAuthor(c.author);
    setSource(c.source);
    setSummary(c.summary);
    setPoints(c.keyPoints.join("\n"));
    setTags(c.tags.join("，"));
    setDomains(c.domains);
    setThoughts(c.thoughts);
  }, []);

  const load = useCallback(async () => {
    try {
      // 接口没有「按 id 取一条」，和详情页一样拉全表再找
      const list = await apiGet<Capture[]>("/api/captures");
      if (!alive.current) return;
      const found = list.find((c) => c.id === id) ?? null;
      if (!found) {
        setError("没有找到这条记录，它可能已经被删除了。");
      } else {
        setCapture(found);
        hydrate(found);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      if (alive.current) setLoading(false);
    }
  }, [id, hydrate]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const s = await apiGet<{ apiKeySet: boolean }>("/api/settings");
        if (alive.current) setAiReady(s.apiKeySet);
      } catch {
        // 读不到就当未知，不拦人
      }
    })();
  }, []);

  /** 让 AI 读一遍原文，产出总结 / 要点 / 标签 / 领域。 */
  async function digest() {
    if (raw.trim().length < 20) {
      setDigestError("原文太短了（不到 20 字），先贴一段真正要整理的内容。");
      return;
    }
    setDigesting(true);
    setDigestError("");
    setDigestNote("");
    try {
      const d = await apiSend<CaptureDigest>("/api/captures/digest", "POST", {
        title,
        kind,
        author,
        source,
        raw,
      });
      if (!alive.current) return;

      /* 【只补空的】和「方法论补全」同一条规矩：
         他已经写过的内容，AI 不覆盖 —— 有总结说明他提炼过，那是他的判断。 */
      const filled: string[] = [];
      if (summary.trim() === "" && d.summary) {
        setSummary(d.summary);
        filled.push("总结");
      }
      if (points.trim() === "" && d.keyPoints.length > 0) {
        setPoints(d.keyPoints.join("\n"));
        filled.push("要点");
      }
      if (tags.trim() === "" && d.tags.length > 0) {
        setTags(d.tags.join("，"));
        filled.push("标签");
      }
      if (domains.length === 0 && d.domains.length > 0) {
        setDomains(d.domains);
        filled.push("领域");
      }

      setDigestNote(
        filled.length > 0
          ? `AI 补了：${filled.join("、")}。都可以改，看着不对就直接动手。`
          : "你已经写过这些了，AI 没有覆盖。" +
              (d.summary ? `它读出的总结是：${d.summary}` : ""),
      );
    } catch (e) {
      if (!alive.current) return;
      setDigestError(e instanceof Error ? e.message : "生成失败");
    } finally {
      if (alive.current) setDigesting(false);
    }
  }

  async function save() {
    if (title.trim() === "") {
      setSaveError("标题不能空。");
      return;
    }
    setSaving(true);
    setSaveError("");
    try {
      await apiSend<Capture>(`/api/captures/${id}`, "PATCH", {
        title: title.trim(),
        kind,
        author: author.trim(),
        source: source.trim(),
        summary,
        keyPoints: points
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean),
        tags: tags
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean),
        domains,
        thoughts,
      });
      router.push(`/capture/${id}`);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存失败");
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="stack">
        <div className="loading">加载中…</div>
      </div>
    );
  }

  if (error || !capture) {
    return (
      <div className="stack">
        <div className="empty-board">
          <h3>这条记录不在了</h3>
          <p>{error || "可能已经被删掉，或者链接里的编号不对。"}</p>
          <div className="hint-actions">
            <Link href="/capture" className="go">
              回到便签墙
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>整理这条记录</h1>
          <p className="lede">
            贴一段原文让 AI 读，它给出总结、要点和建议标签；你再补上自己的想法。
          </p>
        </div>
        <div className="page-actions">
          <Link href={`/capture/${id}`} className="board-bar-btn">
            取消
          </Link>
          <button
            type="button"
            className="board-bar-btn go"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "保存中…" : "保存"}
          </button>
        </div>
      </div>

      {saveError ? <div className="notice notice-error">{saveError}</div> : null}

      <div className="cap-edit">
        <div className="field">
          <label>标题</label>
          <input
            className="form-input"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="书名 / 文章标题 / 一句话把这个念头说完"
          />
        </div>

        <div className="field">
          <label>类型</label>
          <div className="form-choice">
            {CAPTURE_KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                className="form-choice-chip"
                data-on={kind === k.id}
                title={k.blurb}
                onClick={() => setKind(k.id)}
              >
                {k.name}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-2">
          <div className="field">
            <label>作者</label>
            <input
              className="form-input"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>
          <div className="field">
            <label>出处</label>
            <input
              className="form-input"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="链接 / 出版社"
            />
          </div>
        </div>

        {/* ---------------- 原文 + AI ---------------- */}
        <div className="cap-raw">
          <div className="field">
            <label>
              原文
              <span className="blk-hint">
                临时用，不保存 —— 生成的摘记已经把它提炼过了
              </span>
            </label>
            <textarea
              className="form-textarea"
              style={{ minHeight: 160 }}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="把书摘、文章正文、课堂笔记贴进来，然后点「AI 读一遍」"
            />
          </div>

          <div className="mth-ai-entry">
            <button
              type="button"
              className="board-bar-btn"
              onClick={() => void digest()}
              disabled={digesting || aiReady === false}
            >
              {digesting ? "正在读…" : "AI 读一遍"}
            </button>
            <span className="blk-hint">
              {aiReady === false ? (
                <Link href="/settings" style={{ textDecoration: "underline" }}>
                  还没配置模型密钥，去辅助系统填一下
                </Link>
              ) : (
                "它会补空着的总结 / 要点 / 标签；你已经写过的它不动"
              )}
            </span>
          </div>

          {digesting ? (
            <div className="q-loading">
              <span className="q-loading-marks" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <span className="q-loading-text">正在读原文</span>
            </div>
          ) : null}
          {digestError ? (
            <div className="notice notice-error">{digestError}</div>
          ) : null}
          {digestNote ? (
            <div className="notice notice-info">{digestNote}</div>
          ) : null}
        </div>

        {/* ---------------- 摘记 ---------------- */}
        <div className="field">
          <label>内容总结</label>
          <textarea
            className="form-textarea"
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="用自己的话写；AI 生成后也可以改"
          />
        </div>

        <div className="field">
          <label>关键要点</label>
          <textarea
            className="form-textarea"
            value={points}
            onChange={(e) => setPoints(e.target.value)}
            placeholder="一行一条"
          />
          <div className="hint">一行一条，保存时按行拆开。</div>
        </div>

        <div className="field">
          <label>标签</label>
          <input
            className="form-input"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="用逗号分开，例如：留存曲线，护栏指标"
          />
        </div>

        <div className="field">
          <label>关联领域</label>
          <div className="form-choice">
            {DOMAINS.map((d) => {
              const on = domains.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  className="form-choice-chip"
                  data-on={on}
                  aria-pressed={on}
                  onClick={() =>
                    setDomains(
                      on ? domains.filter((x) => x !== d) : [...domains, d],
                    )
                  }
                >
                  {d}
                </button>
              );
            })}
          </div>
        </div>

        {/* ---------------- 他自己的那部分 ---------------- */}
        <div className="field">
          <label>
            笔记思考
            <span className="blk-hint">这一块 AI 不碰，写你自己的</span>
          </label>
          <textarea
            className="form-textarea"
            style={{ minHeight: 140 }}
            value={thoughts}
            onChange={(e) => setThoughts(e.target.value)}
            placeholder="它跟你手上的哪个具体问题有关？你打算怎么用？"
          />
        </div>

        <div className="cap-edit-meta">
          <DomainTags domains={domains} />
          <span className="blk-hint">
            {captureKindName(kind)}
            {capture.status === "inbox" ? "　·　还在收件箱" : ""}
          </span>
        </div>

        <div className="row">
          <button
            type="button"
            className="board-bar-btn go"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? "保存中…" : "保存"}
          </button>
          <Link href={`/capture/${id}`} className="board-bar-btn">
            取消
          </Link>
        </div>
      </div>
    </div>
  );
}
