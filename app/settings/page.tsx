"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { PROMPT_SCOPES, scopeName } from "@/lib/catalog";
import { apiGet, apiSend } from "@/lib/client";
import {
  IconCheck,
  IconChevronDown,
  IconGlobe,
  IconGrid,
  IconPlug,
  IconPlus,
  IconSettings,
  IconSpark,
  IconTrash,
  IconUser,
} from "@/components/icons";
import { ConfirmDialog } from "@/components/Modal";
import { PROVIDER_LABELS } from "@/lib/websearch";
import type {
  PublicAISettings,
  PublicMCPServer,
  PromptTemplate,
  WebSearchProvider,
} from "@/lib/types";

/** 提示词模板里可用的变量，与 src/lib/prompts.ts 的 buildVars 保持一致。 */
const PROMPT_VARIABLES: { name: string; desc: string }[] = [
  { name: "company_name", desc: "设置里填的公司名，留空时为「本公司」" },
  { name: "product_name", desc: "本次训练的题目" },
  { name: "product_type", desc: "产品类型：C端 / B端 / AI功能 / 完整产品" },
  { name: "analysis_goal", desc: "这次拆解的目标" },
  { name: "current_step", desc: "当前进行到第几步" },
  { name: "current_date", desc: "今天的日期，形如 2026-02-14" },
];

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

type SectionId = "ai" | "tools" | "prompts";

const SECTIONS: {
  id: SectionId;
  name: string;
  hint: string;
  Icon: typeof IconSettings;
}[] = [
  {
    id: "ai",
    name: "AI 配置",
    hint: "端点、密钥、生成参数",
    Icon: IconSettings,
  },
  {
    id: "tools",
    name: "联网与 MCP",
    hint: "外部检索能力",
    Icon: IconGlobe,
  },
  {
    id: "prompts",
    name: "提示词管理",
    hint: "场景块 / 模式块 / 通用约束",
    Icon: IconSpark,
  },
];

export default function SettingsPage() {
  const [section, setSection] = useState<SectionId>("ai");

  const [settings, setSettings] = useState<PublicAISettings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  /**
   * 密钥草稿。服务端不再回传明文密钥，所以输入框平时是空的、只显示占位提示。
   * 约定：**没有这个 key = 不改动原值**；值为空串 = 清除（只有「清除」按钮会这样写）。
   * 这样「用户把输入框删空」只会退回「不改动」，不会误清密钥。
   */
  const [secretDrafts, setSecretDrafts] = useState<Record<string, string>>({});
  const [aiMessage, setAiMessage] = useState<{ tone: string; text: string } | null>(
    null,
  );
  const [error, setError] = useState("");

  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [activePromptId, setActivePromptId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; system: string }>({
    name: "",
    system: "",
  });
  const [savingPrompt, setSavingPrompt] = useState(false);
  const [promptMessage, setPromptMessage] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const load = useCallback(async () => {
    try {
      const [ai, list] = await Promise.all([
        apiGet<PublicAISettings>("/api/settings"),
        apiGet<PromptTemplate[]>("/api/prompts"),
      ]);
      setSettings(ai);
      setPrompts(list);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const found = prompts.find((p) => p.id === activePromptId);
    if (found) setDraft({ name: found.name, system: found.system });
  }, [activePromptId, prompts]);

  const activePrompt = prompts.find((p) => p.id === activePromptId) ?? null;

  /**
   * 按「块」分组：场景块 / 模式块 / 其它。
   *
   * 注意不能按 scope 分组——每个模板各自就是一个 scope，
   * 按 scope 分会得到 9 组、每组 1 条，等于给每行都加一个标题。
   * 真正有意义的分组是它们所属的「块」（拼装时的三个组成部分）。
   */
  const promptGroups = useMemo(() => {
    const order = ["场景块", "模式块", "其它"];
    const names = Array.from(
      new Set(PROMPT_SCOPES.map((s) => s.group)),
    ).sort((a, b) => order.indexOf(a) - order.indexOf(b));

    return names
      .map((group) => ({
        group,
        items: prompts.filter((p) => {
          const scope = PROMPT_SCOPES.find((s) => s.id === p.scope);
          return scope?.group === group;
        }),
      }))
      .filter((g) => g.items.length > 0);
  }, [prompts]);

  /* ---- 密钥草稿：只在用户真的动过输入框时才存在 ---- */

  function setSecretDraft(key: string, value: string) {
    setSecretDrafts((prev) => {
      const next = { ...prev };
      // 删空输入框 = 放弃修改，而不是「清除密钥」
      if (value === "") delete next[key];
      else next[key] = value;
      return next;
    });
  }

  function clearSecretDraft(key: string) {
    setSecretDrafts((prev) => ({ ...prev, [key]: "" }));
  }

  /* ---- MCP 服务器的增删改（都只改本地状态，点保存才落盘）---- */

  function addServer() {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            mcpServers: [
              ...prev.mcpServers,
              {
                id: `mcp_${Math.random().toString(36).slice(2, 9)}`,
                name: "",
                url: "",
                enabled: true,
                hasToken: false,
              },
            ],
          }
        : prev,
    );
  }

  function updateServer(id: string, patch: Partial<PublicMCPServer>) {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            mcpServers: prev.mcpServers.map((s) =>
              s.id === id ? { ...s, ...patch } : s,
            ),
          }
        : prev,
    );
  }

  function removeServer(id: string) {
    setSettings((prev) =>
      prev
        ? { ...prev, mcpServers: prev.mcpServers.filter((s) => s.id !== id) }
        : prev,
    );
    setSecretDrafts((prev) => {
      const next = { ...prev };
      delete next[`mcp:${id}`];
      return next;
    });
  }

  async function saveSettings() {
    if (!settings) return;
    setSaving(true);
    setAiMessage(null);
    try {
      const keyDraft = secretDrafts.apiKey;
      const searchDraft = secretDrafts.webSearch;

      /* 只把「用户真的改过的密钥」放进请求体：没出现的字段服务端会保留原值。 */
      const payload = {
        ...settings,
        ...(keyDraft !== undefined ? { apiKey: keyDraft } : {}),
        webSearch: {
          ...settings.webSearch,
          ...(searchDraft !== undefined ? { apiKey: searchDraft } : {}),
        },
        mcpServers: settings.mcpServers.map((server) => {
          const draft = secretDrafts[`mcp:${server.id}`];
          return draft !== undefined ? { ...server, token: draft } : server;
        }),
      };

      const next = await apiSend<PublicAISettings>(
        "/api/settings",
        "PUT",
        payload,
      );
      setSettings(next);
      setSecretDrafts({});
      setAiMessage({ tone: "notice-good", text: "已保存。" });
    } catch (e) {
      setAiMessage({
        tone: "notice-error",
        text: e instanceof Error ? e.message : "保存失败",
      });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setAiMessage(null);
    try {
      await apiSend("/api/settings/test", "POST");
      setAiMessage({ tone: "notice-good", text: "连接正常，模型可调用。" });
    } catch (e) {
      setAiMessage({
        tone: "notice-error",
        text: e instanceof Error ? e.message : "连接失败",
      });
    } finally {
      setTesting(false);
    }
  }

  async function createPrompt() {
    try {
      const created = await apiSend<PromptTemplate>("/api/prompts", "POST", {
        scope: "chat",
        name: "新模板",
        system: "在这里写系统提示词。",
      });
      await load();
      setActivePromptId(created.id);
      setSection("prompts");
    } catch (e) {
      setError(e instanceof Error ? e.message : "新建失败");
    }
  }

  async function savePrompt() {
    if (!activePrompt) return;
    setSavingPrompt(true);
    setPromptMessage("");
    try {
      await apiSend(`/api/prompts/${activePrompt.id}`, "PATCH", {
        name: draft.name,
        system: draft.system,
      });
      setPrompts((prev) =>
        prev.map((p) =>
          p.id === activePrompt.id
            ? { ...p, name: draft.name, system: draft.system }
            : p,
        ),
      );
      setPromptMessage("已保存。下一次训练立即生效。");
    } catch (e) {
      setPromptMessage(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingPrompt(false);
    }
  }

  async function togglePrompt(template: PromptTemplate) {
    try {
      const next = await apiSend<PromptTemplate>(
        `/api/prompts/${template.id}`,
        "PATCH",
        { enabled: !template.enabled },
      );
      setPrompts((prev) => prev.map((p) => (p.id === next.id ? next : p)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function resetPrompt() {
    if (!activePrompt) return;
    try {
      await apiSend(`/api/prompts/${activePrompt.id}`, "DELETE");
      setActivePromptId(null);
      setConfirmingDelete(false);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>设置</h1>
        </div>
      </div>

      {error ? <div className="notice notice-error">{error}</div> : null}

      <div className="settings-shell">
        {/* 左：分组导航。设置项多了以后，一页平铺会找不到东西 */}
        <nav className="settings-nav">
          {SECTIONS.map(({ id, name, hint, Icon }) => (
            <button
              key={id}
              className={`settings-nav-item${section === id ? " active" : ""}`}
              onClick={() => setSection(id)}
            >
              <span className="settings-nav-icon">
                <Icon width={16} height={16} />
              </span>
              <span className="settings-nav-text">
                {name}
                <span className="settings-nav-hint">{hint}</span>
              </span>
            </button>
          ))}
        </nav>

        {/* 右：内容面板 */}
        <div className="settings-panel">
          {section === "ai" ? (
            <>
              <div className="settings-group">
                <div className="settings-group-head">
                  <IconSettings width={15} height={15} />
                  <h2>接入方式</h2>
                </div>
                <div className="settings-group-sub">
                  任何 OpenAI 兼容端点都可以。密钥只保存在本机{" "}
                  <code className="mono">data/settings.json</code>，该目录已在
                  .gitignore 中。
                </div>

                <div className="row" style={{ gap: 6 }}>
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.name}
                      className="tag"
                      style={{ cursor: "pointer" }}
                      title={preset.note}
                      onClick={() =>
                        setSettings((prev) =>
                          prev
                            ? {
                                ...prev,
                                baseURL: preset.baseURL,
                                model: preset.model,
                              }
                            : prev,
                        )
                      }
                    >
                      {preset.name}
                    </button>
                  ))}
                </div>
              </div>

              {settings ? (
                <>
                  <div className="settings-group">
                    <div className="settings-group-head">
                      <IconGrid width={15} height={15} />
                      <h2>端点与密钥</h2>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-label">
                        Base URL
                        <small>需要包含 /v1</small>
                      </div>
                      <div className="settings-row-body">
                        <input
                          className="input mono"
                          value={settings.baseURL}
                          onChange={(e) =>
                            setSettings({ ...settings, baseURL: e.target.value })
                          }
                          placeholder="https://example.com/v1"
                        />
                        <div className="hint">
                          平台会自动追加 /chat/completions
                        </div>
                      </div>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-label">
                        模型名
                        <small>该端点支持的 ID</small>
                      </div>
                      <div className="settings-row-body">
                        <input
                          className="input mono"
                          value={settings.model}
                          onChange={(e) =>
                            setSettings({ ...settings, model: e.target.value })
                          }
                          placeholder="deepseek-v4.1-flash"
                        />
                      </div>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-label">
                        API Key
                        <small>仅存本机，不回显</small>
                      </div>
                      <div className="settings-row-body">
                        <div className="row" style={{ gap: 8 }}>
                          <input
                            className="input mono"
                            style={{ flex: 1, minWidth: 200 }}
                            type="password"
                            value={secretDrafts.apiKey ?? ""}
                            onChange={(e) =>
                              setSecretDraft("apiKey", e.target.value)
                            }
                            placeholder={
                              settings.apiKeySet ? "已配置 · 留空表示不修改" : "sk-…"
                            }
                          />
                          {settings.apiKeySet &&
                          secretDrafts.apiKey === undefined ? (
                            <button
                              className="btn btn-sm"
                              onClick={() => clearSecretDraft("apiKey")}
                            >
                              清除
                            </button>
                          ) : null}
                          {secretDrafts.apiKey === "" ? (
                            <span className="tag tag-bad">保存后将清除</span>
                          ) : null}
                        </div>
                        <div className="hint">
                          {settings.apiKeySet
                            ? "密钥已保存在本机，出于安全不再回显。不填写则保持不变。"
                            : "尚未配置密钥。填入后点「保存配置」。"}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="settings-group">
                    <div className="settings-group-head">
                      <IconSpark width={15} height={15} />
                      <h2>生成参数</h2>
                    </div>

                    <div className="settings-pair">
                      <div className="field">
                        <label>temperature：{settings.temperature}</label>
                        <input
                          type="range"
                          min={0}
                          max={2}
                          step={0.1}
                          value={settings.temperature}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              temperature: Number(e.target.value),
                            })
                          }
                        />
                        <div className="hint">
                          训练对话建议 0.6，报告评分由系统固定为 0.3
                        </div>
                      </div>
                      <div className="field">
                        <label>maxTokens</label>
                        <input
                          className="input"
                          type="number"
                          min={64}
                          max={200000}
                          value={settings.maxTokens}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              maxTokens: Number(e.target.value),
                            })
                          }
                        />
                        <div className="hint">单次回复上限</div>
                      </div>
                    </div>
                  </div>

                  {/* 提示词里的 {company_name} 取自这里 */}
                  <div className="settings-group">
                    <div className="settings-group-head">
                      <IconUser width={15} height={15} />
                      <h2>训练师身份</h2>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-label">
                        公司名
                        <small>用于提示词变量</small>
                      </div>
                      <div className="settings-row-body">
                        <input
                          className="input"
                          value={settings.companyName}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              companyName: e.target.value,
                            })
                          }
                          placeholder="留空则显示为「本公司」"
                        />
                        <div className="hint">
                          提示词里的 {"{company_name}"} 会替换成它，例如
                          「你是 XX 的 AI产品经理训练师」
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="row">
                    <button
                      className="btn btn-primary"
                      onClick={saveSettings}
                      disabled={saving}
                    >
                      <IconCheck width={14} height={14} />
                      {saving ? "保存中…" : "保存配置"}
                    </button>
                    <button className="btn" onClick={test} disabled={testing}>
                      {testing ? "测试中…" : "测试连接"}
                    </button>
                  </div>

                  {aiMessage ? (
                    <div className={`notice ${aiMessage.tone}`}>
                      {aiMessage.text}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="loading">加载中…</div>
              )}
            </>
          ) : section === "tools" ? (
            <>
              {settings ? (
                <>
                  <div className="settings-group">
                    <div className="settings-group-head">
                      <IconGlobe width={15} height={15} />
                      <h2>联网搜索</h2>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-label">
                        开关
                        <small>训练中可用</small>
                      </div>
                      <div className="settings-row-body">
                        <label className="switch">
                          <input
                            type="checkbox"
                            checked={settings.webSearch.enabled}
                            onChange={(e) =>
                              setSettings({
                                ...settings,
                                webSearch: {
                                  ...settings.webSearch,
                                  enabled: e.target.checked,
                                },
                              })
                            }
                          />
                          <span className="switch-track" aria-hidden="true">
                            <span className="switch-thumb" />
                          </span>
                          <span className="switch-text">
                            {settings.webSearch.enabled ? "已启用" : "已关闭"}
                          </span>
                        </label>
                        <div className="hint">
                          开启后，AI 可以围绕训练题目和你的回答主动检索外部资料，
                          并在回答里引用来源。
                        </div>
                      </div>
                    </div>

                    <div className="settings-row">
                      <div className="settings-row-label">
                        搜索来源
                        <small>决定结果质量</small>
                      </div>
                      <div className="settings-row-body">
                        <select
                          className="select"
                          value={settings.webSearch.provider}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              webSearch: {
                                ...settings.webSearch,
                                provider: e.target.value as WebSearchProvider,
                              },
                            })
                          }
                        >
                          {(
                            Object.keys(PROVIDER_LABELS) as WebSearchProvider[]
                          ).map((id) => (
                            <option key={id} value={id}>
                              {PROVIDER_LABELS[id].name}
                              {PROVIDER_LABELS[id].needsKey ? " · 需密钥" : ""}
                            </option>
                          ))}
                        </select>
                        <div className="hint">
                          {PROVIDER_LABELS[settings.webSearch.provider].hint}
                        </div>
                      </div>
                    </div>

                    {PROVIDER_LABELS[settings.webSearch.provider].needsKey ? (
                      <div className="settings-row">
                        <div className="settings-row-label">搜索 API Key</div>
                        <div className="settings-row-body">
                          <div className="row" style={{ gap: 8 }}>
                            <input
                              className="input"
                              style={{ flex: 1, minWidth: 200 }}
                              type="password"
                              value={secretDrafts.webSearch ?? ""}
                              onChange={(e) =>
                                setSecretDraft("webSearch", e.target.value)
                              }
                              placeholder={
                                settings.webSearch.hasKey
                                  ? "已配置 · 留空表示不修改"
                                  : "只保存在本机"
                              }
                            />
                            {settings.webSearch.hasKey &&
                            secretDrafts.webSearch === undefined ? (
                              <button
                                className="btn btn-sm"
                                onClick={() => clearSecretDraft("webSearch")}
                              >
                                清除
                              </button>
                            ) : null}
                            {secretDrafts.webSearch === "" ? (
                              <span className="tag tag-bad">保存后将清除</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="settings-row">
                      <div className="settings-row-label">
                        每次取几条
                        <small>1 – 20</small>
                      </div>
                      <div className="settings-row-body">
                        <input
                          className="input"
                          type="number"
                          min={1}
                          max={20}
                          style={{ maxWidth: 120 }}
                          value={settings.webSearch.maxResults}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              webSearch: {
                                ...settings.webSearch,
                                maxResults: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </div>
                    </div>
                  </div>

                  <div className="settings-group">
                    <div className="row" style={{ marginBottom: 4 }}>
                      <div className="settings-group-head" style={{ flex: 1 }}>
                        <IconPlug width={15} height={15} />
                        <h2>MCP 服务器</h2>
                      </div>
                      <button className="btn btn-sm" onClick={addServer}>
                        <IconPlus width={14} height={14} />
                        添加服务器
                      </button>
                    </div>

                    {settings.mcpServers.length === 0 ? (
                      <div className="empty">
                        还没有配置 MCP 服务器。加上之后，AI 就能调用它提供的工具。
                      </div>
                    ) : (
                      <div className="stack" style={{ gap: 10 }}>
                        {settings.mcpServers.map((server, index) => (
                          <div key={server.id} className="mcp-card">
                            <div className="mcp-card-head">
                              <span className="mcp-index">
                                {index + 1}
                              </span>
                              <input
                                className="input"
                                value={server.name}
                                onChange={(e) =>
                                  updateServer(server.id, {
                                    name: e.target.value,
                                  })
                                }
                                placeholder="名称，例如 GitHub"
                              />
                              <label className="switch switch-sm">
                                <input
                                  type="checkbox"
                                  checked={server.enabled}
                                  onChange={(e) =>
                                    updateServer(server.id, {
                                      enabled: e.target.checked,
                                    })
                                  }
                                />
                                <span
                                  className="switch-track"
                                  aria-hidden="true"
                                >
                                  <span className="switch-thumb" />
                                </span>
                              </label>
                              <button
                                className="btn btn-sm btn-ghost"
                                onClick={() => removeServer(server.id)}
                                title="移除这个服务器"
                              >
                                <IconTrash width={13} height={13} />
                              </button>
                            </div>

                            <input
                              className="input"
                              value={server.url}
                              onChange={(e) =>
                                updateServer(server.id, { url: e.target.value })
                              }
                              placeholder="MCP 端点，例如 https://mcp.example.com/mcp"
                            />
                            <div className="row" style={{ gap: 8 }}>
                              <input
                                className="input"
                                style={{ flex: 1 }}
                                type="password"
                                value={secretDrafts[`mcp:${server.id}`] ?? ""}
                                onChange={(e) =>
                                  setSecretDraft(
                                    `mcp:${server.id}`,
                                    e.target.value,
                                  )
                                }
                                placeholder={
                                  server.hasToken
                                    ? "访问令牌已配置 · 留空表示不修改"
                                    : "访问令牌（可选，作为 Bearer 发送）"
                                }
                              />
                              {server.hasToken &&
                              secretDrafts[`mcp:${server.id}`] === undefined ? (
                                <button
                                  className="btn btn-sm"
                                  onClick={() =>
                                    clearSecretDraft(`mcp:${server.id}`)
                                  }
                                >
                                  清除
                                </button>
                              ) : null}
                              {secretDrafts[`mcp:${server.id}`] === "" ? (
                                <span className="tag tag-bad">保存后将清除</span>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="hint" style={{ marginTop: 10 }}>
                      支持 Streamable HTTP 传输的 MCP 服务器。训练时会把它们提供的
                      工具一并交给模型，由模型自己决定要不要调用。
                    </div>
                  </div>

                  <div className="row">
                    <button
                      className="btn btn-primary"
                      onClick={saveSettings}
                      disabled={saving}
                    >
                      <IconCheck width={14} height={14} />
                      {saving ? "保存中…" : "保存配置"}
                    </button>
                  </div>

                  {aiMessage ? (
                    <div className={`notice ${aiMessage.tone}`}>
                      {aiMessage.text}
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="loading">加载中…</div>
              )}
            </>
          ) : (
            <>
              <div className="settings-group">
                <div className="row" style={{ marginBottom: 4 }}>
                  <div className="settings-group-head" style={{ flex: 1 }}>
                    <IconSpark width={15} height={15} />
                    <h2>提示词模板</h2>
                  </div>
                  <button className="btn btn-sm" onClick={createPrompt}>
                    <IconPlus width={14} height={14} />
                    新建模板
                  </button>
                </div>
                <div className="settings-group-sub">
                  点任意一条就地展开编辑；停用的块不参与拼装。
                </div>

                {/* 模板里能用的变量。写提示词时照着填，请求前会被替换成真实值。 */}
                <div className="prompt-vars">
                  <span className="prompt-vars-label">可用变量</span>
                  {PROMPT_VARIABLES.map((v) => (
                    <span
                      key={v.name}
                      className="prompt-var"
                      title={v.desc}
                    >
                      {`{${v.name}}`}
                    </span>
                  ))}
                </div>

                <div className="stack" style={{ gap: 18 }}>
                  {promptGroups.map(({ group, items }) => (
                    <div key={group}>
                      <div className="prompt-group-label">
                        {group}
                        <span className="prompt-group-count">
                          {items.length}
                        </span>
                      </div>
                      <div className="stack" style={{ gap: 6 }}>
                        {items.map((template) => {
                          const open = activePromptId === template.id;
                          return (
                            /* 就地展开：列表和编辑区合成一个组件。
                               之前把编辑器放在列表下方，选完还得往下滚才能编辑，
                               是最难用的一种做法。 */
                            <div
                              key={template.id}
                              className={`acc${open ? " open" : ""}`}
                            >
                              <button
                                className="acc-head"
                                onClick={() =>
                                  setActivePromptId(open ? null : template.id)
                                }
                                aria-expanded={open}
                              >
                                <span className="acc-chevron">
                                  <IconChevronDown width={14} height={14} />
                                </span>
                                <span className="acc-head-text">
                                  <span className="acc-title">
                                    {template.name}
                                  </span>
                                  {!open ? (
                                    <span className="acc-preview">
                                      {template.system.slice(0, 70)}…
                                    </span>
                                  ) : null}
                                </span>
                                <span className="acc-tags">
                                  {template.builtin ? (
                                    <span className="tag">内置</span>
                                  ) : null}
                                  {!template.enabled ? (
                                    <span className="tag tag-bad">已停用</span>
                                  ) : null}
                                </span>                              </button>

                              {open ? (
                                <div className="acc-body">
                                  {promptMessage ? (
                                    <div className="notice notice-good">
                                      {promptMessage}
                                    </div>
                                  ) : null}

                                  <div className="field">
                                    <label>模板名称</label>
                                    <input
                                      className="input"
                                      value={draft.name}
                                      onChange={(e) =>
                                        setDraft({
                                          ...draft,
                                          name: e.target.value,
                                        })
                                      }
                                    />
                                  </div>

                                  <div className="field">
                                    <label>系统提示词</label>
                                    <textarea
                                      className="textarea acc-textarea"
                                      value={draft.system}
                                      onChange={(e) =>
                                        setDraft({
                                          ...draft,
                                          system: e.target.value,
                                        })
                                      }
                                    />
                                    <div className="hint">
                                      作用域：{scopeName(template.scope)} ·{" "}
                                      {draft.system.length} 字符 · 改完下一次训练生效
                                    </div>
                                  </div>

                                  <div className="row">
                                    <button
                                      className="btn btn-primary"
                                      onClick={savePrompt}
                                      disabled={savingPrompt}
                                    >
                                      <IconCheck width={14} height={14} />
                                      {savingPrompt ? "保存中…" : "保存"}
                                    </button>
                                    <button
                                      className="btn"
                                      onClick={() => togglePrompt(template)}
                                    >
                                      {template.enabled
                                        ? "停用这一块"
                                        : "启用这一块"}
                                    </button>
                                    <div className="spacer" />
                                    <button
                                      className="btn btn-danger"
                                      onClick={() => setConfirmingDelete(true)}
                                    >
                                      <IconTrash width={13} height={13} />
                                      删除
                                    </button>
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmingDelete}
        title="删除提示词模板"
        message="内置模板无法自动还原。删除后需要手动删掉 data/prompts.json 才能恢复默认，确定继续？"
        onConfirm={resetPrompt}
        onCancel={() => setConfirmingDelete(false)}
      />
    </div>
  );
}
