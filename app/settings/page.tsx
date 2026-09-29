"use client";

/**
 * 辅助系统（设置）
 *
 * 这一页是「工具」，不是内容。所以不用便签墙那一套，改成印刷品的填表版式：
 * - 左侧一条极窄的章节索引（像书的目录），当前位置用朱砂
 * - 右侧下划线式填空，不是描边圆角输入框
 * - 开关是方的、无色的，靠位置和填充表达开 / 关
 * - 状态是方括号里的文字（[正常] / [空]），不用彩色圆点
 *
 * 安全：GET /api/settings **不回传任何密钥明文**，只回「配没配」的布尔量
 * （apiKeySet / hasKey / hasToken）。所以密钥输入框平时是空的、只显示占位提示：
 * 不填 = 不改动原值，只有点「清除」才会真的清掉。密钥因此永远不出服务端。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  MODES,
  PROMPT_MODULES,
  PROMPT_SCOPES,
  SCENARIOS,
  promptScopeName,
  scopeName,
} from "@/lib/catalog";
import { apiGet, apiSend } from "@/lib/client";
import { plainSummary } from "@/lib/board";
import { ConfirmDialog } from "@/components/Modal";
import { PROVIDER_LABELS } from "@/lib/websearch";
import type {
  PublicAISettings,
  PublicMCPServer,
  PromptScope,
  PromptTemplate,
  WebSearchProvider,
} from "@/lib/types";

/* ------------------------------------------------------------------ *
 * 表单校验：和 app/api/settings/route.ts 的规则保持一致。
 * 在本地先挡一道，用户不用等一次失败的请求才知道哪里错了。
 * ------------------------------------------------------------------ */

const KEY_MIN = 64;
const KEY_MAX = 200000;

function baseUrlIssue(value: string): string {
  return /^https?:\/\//i.test(value.trim())
    ? ""
    : "接口地址需要以 http:// 或 https:// 开头";
}

function mcpUrlIssue(value: string): string {
  return /^https?:\/\//i.test(value.trim())
    ? ""
    : "MCP 地址需要以 http:// 或 https:// 开头";
}

/** 表单里所有控件都存字符串：数字用字符串才能中途为空。
 *  密钥不在这里——服务端不回传密钥，它由 secretDrafts 单独管（见下）。 */
interface AIForm {
  baseURL: string;
  model: string;
  temperature: string;
  maxTokens: string;
  companyName: string;
}

function toForm(settings: PublicAISettings): AIForm {
  return {
    baseURL: settings.baseURL,
    model: settings.model,
    temperature: String(settings.temperature),
    maxTokens: String(settings.maxTokens),
    companyName: settings.companyName,
  };
}

function formIssues(form: AIForm): string[] {
  const issues: string[] = [];
  if (baseUrlIssue(form.baseURL)) issues.push(baseUrlIssue(form.baseURL));
  if (form.model.trim() === "") issues.push("模型名不能为空");

  const temperature = Number(form.temperature);
  if (!Number.isFinite(temperature) || temperature < 0 || temperature > 2) {
    issues.push("温度需要在 0 到 2 之间");
  }

  const maxTokens = Number(form.maxTokens);
  if (
    !Number.isFinite(maxTokens) ||
    maxTokens < KEY_MIN ||
    maxTokens > KEY_MAX
  ) {
    issues.push(`最大输出长度需要在 ${KEY_MIN} 到 ${KEY_MAX} 之间`);
  }

  return issues;
}

/** 提示词里能用的变量，与 src/lib/prompts.ts 的 buildVars 保持一致。 */
const PROMPT_VARIABLES: { name: string; desc: string }[] = [
  { name: "company_name", desc: "设置里填的公司名，留空时为「本公司」" },
  { name: "product_name", desc: "本次训练的题目" },
  { name: "product_type", desc: "产品类型：C端 / B端 / AI功能 / 完整产品" },
  { name: "analysis_goal", desc: "这次拆解的目标" },
  { name: "current_step", desc: "当前进行到第几步" },
  { name: "current_date", desc: "今天的日期，形如 2026-02-14" },
];

/**
 * 一条模板什么时候会生效。
 *
 * 说明文字统一从 catalog 的 PROMPT_SCOPES 里取（每项自带 when），
 * 不在这里再写一份 —— 加新 scope 时只改一处。
 * 找不到时退回一句诚实的「未接进拼装流程」，而不是空白让人猜。
 */
function scopeWhen(scope: PromptScope): string {
  return (
    PROMPT_SCOPES.find((s) => s.id === scope)?.when ?? "未接进拼装流程"
  );
}

const PRESETS: { name: string; baseURL: string; model: string; note: string }[] = [
  {
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
    note: "官方端点",
  },
  {
    name: "OpenCode Zen Go",
    baseURL: "https://opencode.ai/zen/go/v1",
    model: "deepseek-v4.1-flash",
    note: "需 $10/月订阅，密钥在 opencode.ai/auth",
  },
  {
    name: "DeepSeek 官方",
    baseURL: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
    note: "官方端点",
  },
  {
    name: "本地 Ollama",
    baseURL: "http://localhost:11434/v1",
    model: "qwen2.5",
    note: "无需密钥，离线可用",
  },
];

/** 概要统计只用于「数据与备份」一章，不占用主要接口。 */
interface DataStats {
  methodology: number;
  sessions: number;
  captures: number;
}

const SECTIONS: { id: string; name: string }[] = [
  { id: "ai", name: "AI 配置" },
  { id: "prompt", name: "提示词管理" },
  { id: "search", name: "联网搜索" },
  { id: "mcp", name: "MCP 服务" },
  { id: "data", name: "数据与备份" },
];

export default function SettingsPage() {
  /* ---------------- 设置 ---------------- */

  const [settings, setSettings] = useState<PublicAISettings | null>(null);
  const [form, setForm] = useState<AIForm | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  /**
   * 密钥草稿。服务端不回传明文密钥，所以输入框平时是空的、只显示占位提示。
   *
   * 约定：**没这个 key = 不改动原值**；值为空串 = 清除（只有「清除」按钮会这样写）。
   * 这样「把输入框删空」只会退回「不改动」，不会误清密钥。
   */
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});

  function setSecretDraft(key: string, value: string) {
    setSecretDrafts((prev) => {
      const next = { ...prev };
      if (value === "") delete next[key];
      else next[key] = value;
      return next;
    });
    setDirty(true);
  }

  function clearSecretDraft(key: string) {
    setSecretDrafts((prev) => ({ ...prev, [key]: "" }));
    setDirty(true);
  }

  /* ---------------- 提示词 ---------------- */

  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ id: string; name: string; system: string }>({
    id: "",
    name: "",
    system: "",
  });
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptMessage, setPromptMessage] = useState("");
  const [pendingDelete, setPendingDelete] = useState(false);
  const [newScope, setNewScope] = useState<PromptScope>("chat");

  /* ---------------- 主题目之外的辅助状态 ---------------- */

  const [active, setActive] = useState<string>("ai");
  const [presetName, setPresetName] = useState("");
  const [probe, setProbe] = useState<string>("");
  const [stats, setStats] = useState<DataStats | null>(null);
  const [statsError, setStatsError] = useState("");

  const shipped = useRef<{ temperature: number; maxTokens: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const [ai, list] = await Promise.all([
        apiGet<PublicAISettings>("/api/settings"),
        apiGet<PromptTemplate[]>("/api/prompts"),
      ]);
      setSettings(ai);
      setForm(toForm(ai));
      setSecretDrafts({});
      shipped.current = {
        temperature: ai.temperature,
        maxTokens: ai.maxTokens,
      };
      setPrompts(list);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "设置加载失败");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /* 章节索引：当前项跟滚动走，点一下滚过去。 */
  useEffect(() => {
    const nodes = SECTIONS.map((s) => document.getElementById(s.id)).filter(
      (el): el is HTMLElement => el !== null,
    );
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px" },
    );
    for (const node of nodes) observer.observe(node);
    return () => observer.disconnect();
  }, [settings !== null]);

  /** 「数据与备份」的条目数。数不出来就先不显示数字，不阻塞这一页。 */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      async function count(url: string): Promise<number | null> {
        try {
          const value = await apiGet<unknown>(url);
          return Array.isArray(value) ? value.length : null;
        } catch {
          return null;
        }
      }

      const [methodology, sessions, captures] = await Promise.all([
        count("/api/methodology"),
        count("/api/sessions"),
        count("/api/captures"),
      ]);
      if (cancelled) return;
      if (methodology === null || sessions === null || captures === null) {
        setStatsError("有文件读不出来");
        return;
      }
      setStats({ methodology, sessions, captures });
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---------------- 派生 ---------------- */

  const issues = form ? formIssues(form) : [];
  const ready = issues.length === 0;

  /**
   * 两级分组：先按功能模块，再按模块内的细分。
   *
   * 模板条数从 9 涨到 12 之后，一层的平铺列表开始难找东西 ——
   * 而且「题库」这三条跟训练那几条本来就不是一回事，
   * 混在一张单子里会让人以为它们也参与训练拼装。
   */
  const promptModules = useMemo(() => {
    return PROMPT_MODULES.map((mod) => {
      const scopesInModule = PROMPT_SCOPES.filter((s) => s.module === mod.id);
      const groups = Array.from(new Set(scopesInModule.map((s) => s.group)));
      return {
        module: mod.id,
        lead: mod.lead,
        groups: groups
          .map((group) => ({
            group,
            items: prompts.filter(
              (p) => scopesInModule.find((s) => s.id === p.scope)?.group === group,
            ),
          }))
          .filter((g) => g.items.length > 0),
        count: scopesInModule.filter((s) =>
          prompts.some((p) => p.scope === s.id),
        ).length,
      };
    }).filter((m) => m.count > 0);
  }, [prompts]);

  const openPrompt = prompts.find((p) => p.id === openId) ?? null;
  const webSearch = settings?.webSearch ?? null;
  /* 有些来源是「密钥可选」（例如 AnySearch 不填也能用），
     这类也要显示密钥输入框，但要说明可以不填。 */
  const webSearchKeyField = webSearch
    ? PROVIDER_LABELS[webSearch.provider].needsKey ||
      PROVIDER_LABELS[webSearch.provider].keyOptional === true
    : false;
  const webSearchKeyRequired = webSearch
    ? PROVIDER_LABELS[webSearch.provider].needsKey
    : false;
  const disabledPrompts = prompts.filter((p) => !p.enabled).length;
  const enabledServers = settings?.mcpServers.filter((s) => s.enabled).length ?? 0;

  /* ---------------- 操作 ---------------- */

  function patchForm(patch: Partial<AIForm>) {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
    setFeedback("");
    setFailed(false);
  }

  /** 改一个不落盘的字段（联网搜索 / MCP），等按保存才写。 */
  function patchSettings(patch: Partial<PublicAISettings>) {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
    setDirty(true);
    setFeedback("");
    setFailed(false);
  }

  /**
   * 保存。
   *
   * 服务端对顶层字段做深合并，对 webSearch 是整体替换，所以除了密钥，
   * 其余字段要一次发全。
   *
   * 密钥采取「三态」：请求体里**不出现** = 保持原值，出现空串 = 清除，
   * 出现值 = 更新。所以这里只把用户真的动过的那几个放进请求体。
   */
  async function saveSettings() {
    if (!settings || !form) return;
    if (!ready) {
      setFeedback(issues[0]);
      setFailed(true);
      return;
    }

    setPublishing(true);
    setFeedback("");
    setFailed(false);
    try {
      const keyDraft = secretDrafts.apiKey;
      const searchDraft = secretDrafts.webSearch;

      const next = await apiSend<PublicAISettings>("/api/settings", "PUT", {
        baseURL: form.baseURL.trim(),
        ...(keyDraft !== undefined ? { apiKey: keyDraft } : {}),
        model: form.model.trim(),
        temperature: Number(form.temperature),
        maxTokens: Math.round(Number(form.maxTokens)),
        companyName: form.companyName,
        webSearch: {
          enabled: settings.webSearch.enabled,
          provider: settings.webSearch.provider,
          maxResults: settings.webSearch.maxResults,
          ...(searchDraft !== undefined ? { apiKey: searchDraft } : {}),
        },
        mcpServers: settings.mcpServers.map((server) => {
          const draft = secretDrafts[`mcp:${server.id}`];
          return draft !== undefined ? { ...server, token: draft } : server;
        }),
      });

      // 服务端会把 baseURL 末尾的斜杠去掉、公司名截到 60 字，
      // 回填真实值，免得界面上显示的和存的不一样。
      setSettings(next);
      setForm(toForm(next));
      setSecretDrafts({});
      shipped.current = {
        temperature: next.temperature,
        maxTokens: next.maxTokens,
      };
      setDirty(false);
      setFeedback("已保存。");
      setFailed(false);
    } catch (e) {
      setFeedback(e instanceof Error ? e.message : "保存失败");
      setFailed(true);
    } finally {
      setPublishing(false);
    }
  }

  /** 草稿（还没保存的改动）直接丢掉，回到磁盘上的那份。 */
  function discardChanges() {
    if (!settings) return;
    setForm(toForm(settings));
    setSecretDrafts({});
    setDirty(false);
    setFeedback("");
    setFailed(false);
  }

  async function testConnection() {
    setTesting(true);
    setFeedback("");
    setFailed(false);
    try {
      const result = await apiSend<{ ok: boolean; reply: string }>(
        "/api/settings/test",
        "POST",
      );
      setProbe(`上次测试：可用，回应「${result.reply}」`);
    } catch (e) {
      setProbe("上次测试：失败");
      setFailed(true);
      setFeedback(e instanceof Error ? e.message : "连接测试失败");
    } finally {
      setTesting(false);
    }
  }

  /* ---- 联网搜索 ---- */

  function patchWebSearch(patch: Partial<PublicAISettings["webSearch"]>) {
    if (!settings) return;
    patchSettings({ webSearch: { ...settings.webSearch, ...patch } });
  }

  /* ---- MCP ---- */

  function addServer() {
    if (!settings) return;
    const server: PublicMCPServer = {
      id: `mcp_${Math.random().toString(36).slice(2, 9)}`,
      name: "",
      url: "",
      enabled: true,
      hasToken: false,
    };
    patchSettings({ mcpServers: [...settings.mcpServers, server] });
  }

  function updateServer(id: string, patch: Partial<PublicMCPServer>) {
    if (!settings) return;
    patchSettings({
      mcpServers: settings.mcpServers.map((s) =>
        s.id === id ? { ...s, ...patch } : s,
      ),
    });
  }

  function removeServer(id: string) {
    if (!settings) return;
    patchSettings({
      mcpServers: settings.mcpServers.filter((s) => s.id !== id),
    });
    // 顺带丢掉这个服务还没保存的令牌草稿
    setSecretDrafts((prev) => {
      const next = { ...prev };
      delete next[`mcp:${id}`];
      return next;
    });
  }

  /* ---- 提示词 ---- */

  function openEditor(template: PromptTemplate) {
    setOpenId(template.id);
    setDraft({
      id: template.id,
      name: template.name,
      system: template.system,
    });
    setPromptMessage("");
  }

  function closeEditor() {
    setOpenId(null);
    setPromptMessage("");
  }

  async function savePrompt() {
    const template = openPrompt;
    if (!template) return;
    // 防止列表在这期间刷新过，导致把 A 的草稿写到 B 上
    if (draft.id !== template.id) return;

    if (draft.name.trim() === "") {
      setPromptMessage("模板名称不能为空");
      return;
    }
    if (draft.system.trim() === "") {
      setPromptMessage("提示词内容不能为空");
      return;
    }

    setSavingPrompt(true);
    setPromptMessage("");
    try {
      const updated = await apiSend<PromptTemplate>(
        `/api/prompts/${template.id}`,
        "PATCH",
        {
          name: draft.name.trim(),
          system: draft.system,
          // 注意：PATCH 的规则是 body.enabled === true。
          // 这里必须显式带上当前值，否则这一条会被静默停用。
          enabled: template.enabled,
        },
      );
      setPrompts((prev) =>
        prev.map((p) => (p.id === updated.id ? updated : p)),
      );
      setPromptMessage("已保存。下一次训练立即生效。");
    } catch (e) {
      setPromptMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingPrompt(false);
    }
  }

  /**
   * 启用 / 停用一条模板。
   * 两个接口对 enabled 的读法不一样（POST 是 !== false，PATCH 是 === true），
   * 所以这里永远发一个真正的布尔值，不做省略。
   */
  async function setPromptEnabled(template: PromptTemplate, enabled: boolean) {
    setPromptMessage("");
    try {
      const updated = await apiSend<PromptTemplate>(
        `/api/prompts/${template.id}`,
        "PATCH",
        { enabled },
      );
      setPrompts((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    } catch (e) {
      setPromptMessage(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function createPrompt() {
    const scope = newScope;
    setPromptMessage("");
    try {
      const created = await apiSend<PromptTemplate>("/api/prompts", "POST", {
        scope,
        name: `${promptScopeName(scope)}的自定义块`,
        system: "在这里写系统提示词。",
        enabled: true,
      });
      setPrompts((prev) => [...prev, created]);
      setActive("prompt");
      openEditor(created);
    } catch (e) {
      setPromptMessage(e instanceof Error ? e.message : "新建失败");
    }
  }

  async function deletePrompt() {
    const template = openPrompt;
    if (!template) return;
    try {
      await apiSend(`/api/prompts/${template.id}`, "DELETE");
      setPrompts((prev) => prev.filter((p) => p.id !== template.id));
      setPendingDelete(false);
      closeEditor();
    } catch (e) {
      setPendingDelete(false);
      setPromptMessage(e instanceof Error ? e.message : "删除失败");
    }
  }

  /* ---------------- 渲染 ---------------- */

  if (error && !settings) {
    return (
      <div className="stack" style={{ maxWidth: 1120 }}>
        <header className="page-head">
          <h1>辅助系统</h1>
        </header>
        <div className="notice notice-error">{error}</div>
        <div className="set-actions">
          <button type="button" onClick={() => void load()}>
            重新读取
          </button>
        </div>
      </div>
    );
  }

  if (!settings || !form) {
    return (
      <div className="stack" style={{ maxWidth: 1120 }}>
        <header className="page-head">
          <h1>辅助系统</h1>
        </header>
        <div className="loading">读取设置中…</div>
      </div>
    );
  }

  const temperatureShipped = shipped.current?.temperature;
  const maxTokensShipped = shipped.current?.maxTokens;

  return (
    <div className="setwrap">
      {/* 章节索引：像书的目录，纯文字。朱砂只出现在当前这一行。 */}
      <nav className="toc" aria-label="章节">
        <span className="toc-label">章节</span>
        {SECTIONS.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            className={active === section.id ? "on" : undefined}
            aria-current={active === section.id ? "true" : undefined}
            onClick={(event) => {
              event.preventDefault();
              setActive(section.id);
              document
                .getElementById(section.id)
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            {section.name}
          </a>
        ))}
      </nav>

      <div>
        {/* ============================ AI 配置 ============================ */}
        <section className="section" id="ai">
          <div className="section-head">
            <h2 className="section-title">AI 配置</h2>
            <span className={`set-status${ready ? "" : " bad"}`}>
              {ready ? "当前填写可用" : issues[0]}
            </span>
          </div>

          <div className="set-field">
            <label className="set-field-label" htmlFor="set-mode">
              填写方式
            </label>
            <select
              id="set-mode"
              className="set-select"
              value={presetName}
              onChange={(event) => {
                const preset = PRESETS.find((p) => p.name === event.target.value);
                setPresetName(event.target.value);
                if (preset) {
                  patchForm({ baseURL: preset.baseURL, model: preset.model });
                }
              }}
            >
              <option value="">自己填，或选一个常见的端点</option>
              {PRESETS.map((preset) => (
                <option key={preset.name} value={preset.name}>
                  {preset.name} —— {preset.note}
                </option>
              ))}
            </select>
          </div>

          <div className="set-field">
            <label className="set-field-label" htmlFor="set-base">
              接口地址 <span className="req">*</span>
            </label>
            <input
              id="set-base"
              className="set-input set-input-key"
              value={form.baseURL}
              spellCheck={false}
              onChange={(event) => patchForm({ baseURL: event.target.value })}
              placeholder="https://api.openai.com/v1"
            />
          </div>

          <div className="set-field">
            <label className="set-field-label" htmlFor="set-model">
              模型 <span className="req">*</span>
            </label>
            <input
              id="set-model"
              className="set-input set-input-key"
              value={form.model}
              spellCheck={false}
              onChange={(event) => patchForm({ model: event.target.value })}
              placeholder="deepseek-v4.1-flash"
            />
          </div>

          <div className="set-field">
            <span className="set-field-label">
              API Key{" "}
              <span className="set-status">
                {secretDrafts.apiKey === ""
                  ? "保存后清除"
                  : settings?.apiKeySet
                    ? "已配置"
                    : "未配置"}
              </span>
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <input
                id="set-key"
                aria-label="API Key"
                className="set-input set-input-key"
                type="password"
                autoComplete="new-password"
                value={secretDrafts.apiKey ?? ""}
                onChange={(event) => setSecretDraft("apiKey", event.target.value)}
                placeholder={
                  settings?.apiKeySet ? "已配置 · 留空表示不修改" : "sk-…"
                }
              />
              {settings?.apiKeySet && secretDrafts.apiKey === undefined ? (
                <button
                  type="button"
                  className="go"
                  onClick={() => clearSecretDraft("apiKey")}
                >
                  清除
                </button>
              ) : null}
            </div>
            <div className="set-hint">
              只保存在本机 data/settings.json，不会上传到任何地方。
              出于安全不再回显明文：留空就是不改动，想清掉请点「清除」。
            </div>
          </div>

          <div className="set-field">
            <label className="set-field-label" htmlFor="set-temp">
              温度
            </label>
            <input
              id="set-temp"
              className="set-input set-input-num"
              type="number"
              min={0}
              max={2}
              step={0.1}
              value={form.temperature}
              onChange={(event) => patchForm({ temperature: event.target.value })}
            />
            <div className="set-hint">
              训练对话建议 0.6；报告评分由系统固定在 0.3。
              {temperatureShipped !== undefined
                ? ` 已保存的值是 ${temperatureShipped}。`
                : ""}
            </div>
          </div>

          <div className="set-field">
            <label className="set-field-label" htmlFor="set-max">
              最大输出长度
            </label>
            <input
              id="set-max"
              className="set-input set-input-num"
              type="number"
              min={KEY_MIN}
              max={KEY_MAX}
              step={1}
              value={form.maxTokens}
              onChange={(event) => patchForm({ maxTokens: event.target.value })}
            />
            <div className="set-hint">
              单次回复的上限，可填 64 到 200000。
              {maxTokensShipped !== undefined
                ? ` 已保存的值是 ${maxTokensShipped}。`
                : ""}
            </div>
          </div>

          <div className="set-field">
            <label className="set-field-label" htmlFor="set-company">
              公司名称（提示词里的 {"{company_name}"}）
            </label>
            <input
              id="set-company"
              className="set-input"
              value={form.companyName}
              onChange={(event) => patchForm({ companyName: event.target.value })}
              placeholder="留空时为「本公司」"
            />
          </div>

          <div className="set-actions">
            <button
              type="button"
              className="go"
              onClick={() => void saveSettings()}
              disabled={publishing || !ready}
            >
              {publishing ? "保存中…" : "保存"}
            </button>
            <button type="button" onClick={() => void testConnection()} disabled={testing}>
              {testing ? "测试中…" : "测试连接"}
            </button>
            {dirty ? (
              <button type="button" onClick={discardChanges}>
                撤回到已保存的
              </button>
            ) : null}
            <span className={`set-status${failed || issues.length > 0 ? " bad" : ""}`}>
              {feedback || probe || (dirty ? "改动还没有落盘" : "与已保存的一致")}
            </span>
          </div>
        </section>

        {/* ============================ 提示词管理 ============================ */}
        <section className="section" id="prompt">
          <div className="section-head">
            <h2 className="section-title">提示词管理</h2>
            <span className="set-status">
              {prompts.length} 条，{disabledPrompts} 条已停用
            </span>
          </div>

          {/* 先讲清楚「AI 在这套产品里被用在哪几处」，
              用户才能把某一条提示词和某一次真实调用对上号 */}
          <div className="set-hint" style={{ marginTop: 0 }}>
            产品里用到 AI 的地方一共有四块，每块的提示词都能在这里改：
            <br />
            <span style={{ color: "var(--ink-3)" }}>
              <b>训练师</b>——场景块 + 模式块 + 通用约束按顺序拼成一条系统提示词，
              用在整个训练对话里；其中「当前步骤指引 / 你的输入素材 / 选中的方法论」
              是训练开始时按你的选择自动带上的，不在这里配。
              <br />
              <b>题库</b>——归类、AI 回答、AI 评分、推荐阅读各调一次模型，各自一条，互不影响。
              <br />
              <b>方法论</b>——写知识点时先提问澄清，再补全空字段；两步各一条。
              <br />
              <b>报告</b>——训练结束批改出一份评估报告。
            </span>
            <br />
            每一条都能单独改、单独停用。停用后它在对应的调用里不再生效。
          </div>

          {promptMessage && !openPrompt ? (
            <div className="set-hint" style={{ marginTop: 0, marginBottom: 4 }}>
              {promptMessage}
            </div>
          ) : null}

          {promptModules.map(({ module, lead, groups }) => (
            <div key={module} className="set-module">
              <div className="set-module-head">
                <span className="set-module-name">{module}</span>
                <span className="set-module-lead">{lead}</span>
              </div>

              {groups.map(({ group, items }) => (
                <div key={group} className="set-pgroup">
                  <div className="set-pgroup-name">{group}</div>

                  {items.map((template) => {
                    const open = openId === template.id;
                    return (
                      /* 就地展开：列表和编辑区是同一个组件，选完不用往下滚。
                         收起时是一行「标题 —— 元信息」，展开后原地下沉成表单。 */
                      <div key={template.id} className="set-tpl-wrap">
                        <button
                          type="button"
                      className="set-tpl"
                      aria-expanded={open}
                      onClick={() => (open ? closeEditor() : openEditor(template))}
                    >
                      <span
                        className="set-tpl-main"
                        style={{
                          flexDirection: "column",
                          alignItems: "flex-start",
                          gap: 3,
                        }}
                      >
                        <span
                          style={{
                            display: "flex",
                            alignItems: "baseline",
                            gap: 12,
                          }}
                        >
                          <span className="set-tpl-title">{template.name}</span>
                          <span className="set-tpl-meta">
                            {scopeWhen(template.scope)}
                          </span>
                        </span>
                        {/* 收起时给一行内容预览：不展开也能知道它大概写了什么 */}
                        <span
                          style={{
                            fontSize: 12.5,
                            color: "var(--ink-4)",
                            maxWidth: 620,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {plainSummary(template.system, 60)}
                        </span>
                      </span>
                      <span className="set-tpl-meta">
                        {template.builtin ? "内置" : "自定义"}
                        {template.enabled ? "" : "，已停用"}
                        {`　${template.system.length} 字符`}
                      </span>
                    </button>

                    {open ? (
                      <div className="set-tpl-body">
                        {/* 编辑区开头就说清「你在改哪一条」——
                            长文本滚下去之后，头顶那行列表标题是看不见的 */}
                        <div className="set-tpl-editor-head">
                          <span className="set-tpl-editor-label">正在编辑</span>
                          <span className="set-tpl-editor-name">
                            {template.name}
                          </span>
                          <span className="set-tpl-meta">
                            {scopeWhen(template.scope)}
                          </span>
                        </div>

                        <div className="set-field">
                          <label className="set-field-label" htmlFor="tpl-name">
                            模板名称
                          </label>
                          <input
                            id="tpl-name"
                            className="set-input"
                            value={draft.name}
                            onChange={(event) =>
                              setDraft({ ...draft, name: event.target.value })
                            }
                          />
                        </div>

                        <div className="set-field">
                          <label className="set-field-label" htmlFor="tpl-system">
                            系统提示词
                          </label>
                          <textarea
                            id="tpl-system"
                            className="set-textarea"
                            style={{ minHeight: 260, lineHeight: 1.7 }}
                            value={draft.system}
                            spellCheck={false}
                            onChange={(event) =>
                              setDraft({ ...draft, system: event.target.value })
                            }
                          />
                          <div className="set-hint">
                            {promptScopeName(template.scope)}。
                            可用变量：
                            {PROMPT_VARIABLES.map((v) => ` {${v.name}}`).join(" ")}。
                            请求前会被替换成真实值，写错名字的变量会原样留在提示词里。
                          </div>
                        </div>

                        <div className="set-switch-row">
                          <div>
                            <div className="set-switch-text">启用这一条</div>
                            <div className="set-switch-sub">
                              停用后它在对应的调用里不再生效，内容仍然保留。
                            </div>
                          </div>
                          <button
                            type="button"
                            className={`set-switch${template.enabled ? " on" : ""}`}
                            role="switch"
                            aria-checked={template.enabled}
                            aria-label="启用这一条"
                            onClick={() =>
                              void setPromptEnabled(template, !template.enabled)
                            }
                          />
                        </div>

                        {/* 操作条吸在编辑区底部：长提示词滚下去之后也点得到保存 */}
                        <div className="set-tpl-actions">
                          <button
                            type="button"
                            className="go"
                            onClick={() => void savePrompt()}
                            disabled={savingPrompt}
                          >
                            {savingPrompt ? "保存中…" : "保存这一条"}
                          </button>
                          <button type="button" onClick={closeEditor}>
                            收起
                          </button>
                          <span className="spacer" />
                          <button type="button" onClick={() => setPendingDelete(true)}>
                            删除这条
                          </button>
                        </div>

                        {promptMessage ? (
                          <div className="set-hint">{promptMessage}</div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
                </div>
              ))}
            </div>
          ))}

          <div className="set-actions">
            <select
              className="set-select"
              style={{ width: "auto", minWidth: 230 }}
              value={newScope}
              aria-label="新模板的作用域"
              onChange={(event) => setNewScope(event.target.value as PromptScope)}
            >
              {PROMPT_SCOPES.map((scope) => (
                <option key={scope.id} value={scope.id}>
                  {scope.module} ／ {scope.group} ／ {scope.name}
                </option>
              ))}
            </select>
            <button type="button" className="go" onClick={() => void createPrompt()}>
              新建一条模板
            </button>
            {promptMessage && !openPrompt ? (
              <span className="set-status bad">{promptMessage}</span>
            ) : null}
          </div>

          <div className="set-hint" style={{ marginTop: 14 }}>
            内置模板删掉后不会被自动补回来；想恢复就在上面新建一条同名作用域的模板。
          </div>
        </section>

        {/* ============================ 联网搜索 ============================ */}
        <section className="section" id="search">
          <div className="section-head">
            <h2 className="section-title">联网搜索</h2>
            <span className="set-status">
              {webSearch?.enabled ? "已启用" : "未启用"}
            </span>
          </div>

          <div className="set-switch-row">
            <div>
              <div className="set-switch-text">让训练师可以联网查资料</div>
              <div className="set-switch-sub">
                开启后，训练师会在需要时搜索，并把查到的东西留痕在对话里。
              </div>
            </div>
            <button
              type="button"
              className={`set-switch${webSearch?.enabled ? " on" : ""}`}
              role="switch"
              aria-checked={webSearch?.enabled ?? false}
              aria-label="让训练师可以联网查资料"
              onClick={() => patchWebSearch({ enabled: !webSearch?.enabled })}
            />
          </div>

          <div className="set-field">
            <label className="set-field-label" htmlFor="set-provider">
              搜索服务商
            </label>
            <select
              id="set-provider"
              className="set-select"
              value={webSearch?.provider ?? "bing"}
              onChange={(event) =>
                patchWebSearch({
                  provider: event.target.value as WebSearchProvider,
                })
              }
            >
              {(Object.keys(PROVIDER_LABELS) as WebSearchProvider[]).map((id) => {
                const label = PROVIDER_LABELS[id];
                const tag = label.needsKey
                  ? "需要密钥"
                  : label.keyOptional
                    ? "密钥可选"
                    : "免费";
                return (
                  <option key={id} value={id}>
                    {label.name}（{tag}）
                  </option>
                );
              })}
            </select>
          </div>

          {webSearchKeyField ? (
            <div className="set-field">
              <span className="set-field-label">
                搜索 API Key{" "}
                <span className="set-status">
                  {secretDrafts.webSearch === ""
                    ? "保存后清除"
                    : webSearch?.hasKey
                      ? "已配置"
                      : webSearchKeyRequired
                        ? "未配置"
                        : "未配置（不填也能用）"}
                </span>
              </span>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <input
                  aria-label="搜索 API Key"
                  className="set-input set-input-key"
                  type="password"
                  autoComplete="new-password"
                  value={secretDrafts.webSearch ?? ""}
                  onChange={(event) =>
                    setSecretDraft("webSearch", event.target.value)
                  }
                  placeholder={
                    webSearch?.hasKey ? "已配置 · 留空表示不修改" : "只保存在本机"
                  }
                />
                {webSearch?.hasKey && secretDrafts.webSearch === undefined ? (
                  <button
                    type="button"
                    className="go"
                    onClick={() => clearSecretDraft("webSearch")}
                  >
                    清除
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="set-field">
            <label className="set-field-label" htmlFor="set-maxresults">
              每次最多取几条
            </label>
            <input
              id="set-maxresults"
              className="set-input set-input-num"
              type="number"
              min={1}
              max={20}
              step={1}
              value={webSearch?.maxResults ?? 5}
              onChange={(event) =>
                patchWebSearch({ maxResults: Number(event.target.value) })
              }
            />
            <div className="set-hint">可填 1 到 20。条数越多，注入提示词的内容越长。</div>
          </div>

          <div className="set-actions">
            <button
              type="button"
              className="go"
              onClick={() => void saveSettings()}
              disabled={publishing || !ready}
            >
              {publishing ? "保存中…" : "保存"}
            </button>
            {/* 只在「这个服务商必须有密钥但还没填」时出声。
                没话可说时就留空，不写「和 AI 配置一起保存」这类
                解释了等于没解释的备注。 */}
            <span className="set-status">
              {webSearchKeyRequired && !webSearch?.hasKey
                ? "这个服务商必须填密钥，没填就会搜索失败"
                : ""}
            </span>
          </div>
        </section>

        {/* ============================ MCP 服务 ============================ */}
        <section className="section" id="mcp">
          <div className="section-head">
            <h2 className="section-title">MCP 服务</h2>
            <span className="set-status">
              {settings.mcpServers.length} 个，{enabledServers} 个已启用
            </span>
          </div>

          {settings.mcpServers.length === 0 ? (
            <div className="empty-board">
              <h3>还没有挂载 MCP 服务</h3>
              <p>
                挂载后，训练师可以调用这些工具去查资料、读文件、访问你的其他系统。
                只支持 Streamable HTTP 传输的地址。
              </p>
              <div className="set-actions" style={{ justifyContent: "center", marginTop: 0 }}>
                <button type="button" className="go" onClick={addServer}>
                  添加一个服务
                </button>
              </div>
            </div>
          ) : (
            <>
              {settings.mcpServers.map((server, index) => (
                <div key={server.id} className="set-field">
                  <span className="set-field-label">
                    第 {index + 1} 个服务{" "}
                    <span className="set-status">
                      {server.enabled ? "已启用" : "已停用"}
                    </span>
                  </span>

                  <input
                    className="set-input"
                    value={server.name}
                    aria-label={`第 ${index + 1} 个服务的名称`}
                    onChange={(event) =>
                      updateServer(server.id, { name: event.target.value })
                    }
                    placeholder="名称，例如 GitHub"
                  />

                  <div style={{ height: 18 }} />

                  <input
                    className="set-input set-input-key"
                    value={server.url}
                    spellCheck={false}
                    aria-label={`第 ${index + 1} 个服务的地址`}
                    onChange={(event) =>
                      updateServer(server.id, { url: event.target.value })
                    }
                    placeholder="https://mcp.example.com/mcp"
                  />
                  <div className="set-hint">{mcpUrlIssue(server.url)}</div>

                  <div style={{ height: 18 }} />

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <input
                      className="set-input set-input-key"
                      type="password"
                      autoComplete="new-password"
                      value={secretDrafts[`mcp:${server.id}`] ?? ""}
                      aria-label={`第 ${index + 1} 个服务的访问令牌`}
                      onChange={(event) =>
                        setSecretDraft(`mcp:${server.id}`, event.target.value)
                      }
                      placeholder={
                        server.hasToken
                          ? "令牌已配置 · 留空表示不修改"
                          : "访问令牌，可留空"
                      }
                    />
                    {server.hasToken &&
                    secretDrafts[`mcp:${server.id}`] === undefined ? (
                      <button
                        type="button"
                        className="go"
                        onClick={() => clearSecretDraft(`mcp:${server.id}`)}
                      >
                        清除
                      </button>
                    ) : null}
                  </div>
                  <div className="set-hint">
                    作为 Authorization: Bearer 发送，留空则不带。
                    {secretDrafts[`mcp:${server.id}`] === ""
                      ? " 保存后清除。"
                      : server.hasToken
                        ? " 已配置。"
                        : ""}
                  </div>

                  <div className="set-switch-row">
                    <div>
                      <div className="set-switch-text">启用这个服务</div>
                      <div className="set-switch-sub">
                        停用后不再把它的工具交给模型。
                      </div>
                    </div>
                    <button
                      type="button"
                      className={`set-switch${server.enabled ? " on" : ""}`}
                      role="switch"
                      aria-checked={server.enabled}
                      aria-label={`启用第 ${index + 1} 个服务`}
                      onClick={() =>
                        updateServer(server.id, { enabled: !server.enabled })
                      }
                    />
                  </div>

                  <div className="set-actions" style={{ marginTop: 18 }}>
                    <button type="button" onClick={() => removeServer(server.id)}>
                      移除这个服务
                    </button>
                    <span className="set-status">
                      名称为空的条目保存时会被丢掉
                    </span>
                  </div>
                </div>
              ))}

              <div className="set-actions">
                <button type="button" onClick={addServer}>
                  再加一个服务
                </button>
              </div>
            </>
          )}

          <div className="set-actions">
            <button
              type="button"
              className="go"
              onClick={() => void saveSettings()}
              disabled={publishing || !ready}
            >
              {publishing ? "保存中…" : "保存"}
            </button>
          </div>
        </section>

        {/* ============================ 数据与备份 ============================ */}
        <section className="section" id="data">
          <div className="section-head">
            <h2 className="section-title">数据与备份</h2>
            <span className="set-status">data/ 目录</span>
          </div>

          <div className="set-switch-row">
            <div>
              <div className="set-switch-text">
                方法论词条{stats ? `（${stats.methodology} 条）` : ""}
              </div>
              <div className="set-switch-sub">data/methodology.json</div>
            </div>
            <span className={`set-status${stats ? "" : " bad"}`}>
              {stats ? "正常" : statsError || "读取中"}
            </span>
          </div>

          <div className="set-switch-row">
            <div>
              <div className="set-switch-text">
                训练场次{stats ? `（${stats.sessions} 场）` : ""}
              </div>
              <div className="set-switch-sub">data/sessions.json</div>
            </div>
            <span className={`set-status${stats ? "" : " bad"}`}>
              {stats ? "正常" : statsError || "读取中"}
            </span>
          </div>

          <div className="set-switch-row">
            <div>
              <div className="set-switch-text">
                记录总结{stats ? `（${stats.captures} 条）` : ""}
              </div>
              <div className="set-switch-sub">
                data/captures.json{stats && stats.captures === 0 ? "，还没有记录" : ""}
              </div>
            </div>
            <span
              className={`set-status${
                stats && stats.captures > 0 ? "" : " bad"
              }`}
            >
              {stats ? (stats.captures > 0 ? "正常" : "空") : statsError || "读取中"}
            </span>
          </div>

          <div className="set-switch-row">
            <div>
              <div className="set-switch-text">
                提示词模板（{prompts.length} 条）
              </div>
              <div className="set-switch-sub">data/prompts.json</div>
            </div>
            <span className="set-status">正常</span>
          </div>

          <div className="set-switch-row">
            <div>
              <div className="set-switch-text">接口密钥</div>
              <div className="set-switch-sub">
                保存在 data/settings.json，这个目录已在 .gitignore 里
              </div>
            </div>
            <span className="set-status">
              {settings?.apiKeySet ? "已配置" : "未配置"}
            </span>
          </div>

          <div className="set-actions">
            <button
              type="button"
              className="go"
              onClick={() => {
                setActive("ai");
                document
                  .getElementById("ai")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
            >
              去 AI 配置
            </button>
            <span className="set-status">
              导出和恢复还没有接上接口，先用 data/ 目录直接备份
            </span>
          </div>
        </section>

        {error ? <div className="notice notice-error">{error}</div> : null}
      </div>

      <ConfirmDialog
        open={pendingDelete}
        title="删除提示词模板"
        message="内置模板删掉之后，重启不会自动恢复；要恢复得手动清掉 data/prompts.json。确定删除这一条吗？"
        onConfirm={() => void deletePrompt()}
        onCancel={() => setPendingDelete(false)}
      />
    </div>
  );
}
