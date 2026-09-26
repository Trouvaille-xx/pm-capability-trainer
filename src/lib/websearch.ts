/**
 * 联网搜索。
 *
 * 支持五种来源：
 * - bing：抓 cn.bing.com 的结果页，不需要密钥，国内可直连（默认）
 * - duckduckgo：不需要密钥，直接抓 HTML 结果页。国内多数网络不可达
 * - tavily / serper / brave：需要各自的 API Key，结果更稳定
 *
 * 和 MCP 一样，这里绝不抛异常给上层：搜不到就返回空数组，
 * 让训练继续跑下去，而不是因为一次搜索失败打断对话。
 */

import type { WebSearchSettings } from "./types";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export const PROVIDER_LABELS: Record<
  WebSearchSettings["provider"],
  { name: string; needsKey: boolean; hint: string }
> = {
  bing: {
    name: "Bing 国际版（免费）",
    needsKey: false,
    hint: "抓 cn.bing.com 的公开结果页，国内网络可直连，不需要密钥。推荐先用它。",
  },
  duckduckgo: {
    name: "DuckDuckGo（免费）",
    needsKey: false,
    hint: "不需要密钥，但国内多数网络无法直连，可能一直搜索失败。",
  },
  tavily: {
    name: "Tavily",
    needsKey: true,
    hint: "为 AI 检索设计的搜索 API，返回带正文摘要的结果，质量最好。",
  },
  serper: {
    name: "Serper",
    needsKey: true,
    hint: "Google 搜索结果 API，覆盖广。",
  },
  brave: {
    name: "Brave Search",
    needsKey: true,
    hint: "独立索引，隐私友好；国内网络可能不可达。",
  },
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const TIMEOUT_MS = 15000;

/** 去掉标签、解开常见实体，得到可以塞进提示词的纯文本。 */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** DuckDuckGo 的结果链接是跳转地址，需要把真实 URL 取出来。 */
function decodeDdgUrl(href: string): string {
  const match = href.match(/[?&]uddg=([^&]+)/);
  if (match) {
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return href;
    }
  }
  return href.startsWith("//") ? `https:${href}` : href;
}

/**
 * 抓 cn.bing.com 的结果页。
 *
 * 这是国内网络下唯一「不需要密钥又能直连」的选项，
 * 所以作为默认来源。解析依赖 Bing 的 b_algo 结构，
 * 改版时可能失效 —— 到时候换 Tavily / Serper 即可。
 */
async function searchBing(
  query: string,
  max: number,
): Promise<SearchResult[]> {
  const url = new URL("https://cn.bing.com/search");
  url.searchParams.set("q", query);
  // 多要几条，因为前面可能有广告或无关结果被过滤掉
  url.searchParams.set("count", String(Math.max(max * 2, 10)));
  url.searchParams.set("setlang", "zh-CN");

  const response = await fetch(url, {
    headers: {
      "user-agent": UA,
      "accept-language": "zh-CN,zh;q=0.9",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Bing 返回 HTTP ${response.status}`);
  }

  const html = await response.text();
  const results: SearchResult[] = [];

  for (const block of html.split(/<li class="b_algo"/).slice(1)) {
    const heading = block.match(/<h2[^>]*>([\s\S]*?)<\/h2>/);
    if (!heading) continue;
    const anchor = heading[1].match(/<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!anchor) continue;

    const href = anchor[1];
    const title = stripHtml(anchor[2]);
    if (title === "" || !/^https?:\/\//i.test(href)) continue;

    const snippet = block.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    results.push({
      title,
      url: href,
      snippet: stripHtml(snippet?.[1] ?? "").replace(/…?阅读更多$/, ""),
    });

    if (results.length >= max) break;
  }

  return results;
}

async function searchDuckDuckGo(
  query: string,
  max: number,
): Promise<SearchResult[]> {
  const response = await fetch("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
    },
    body: new URLSearchParams({ q: query, kl: "cn-zh" }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`DuckDuckGo 返回 HTTP ${response.status}`);
  }

  const html = await response.text();
  const results: SearchResult[] = [];

  // 每个结果块以 result__body 为单位切分
  const blocks = html.split(/<div[^>]*class="[^"]*result__body/).slice(1);
  for (const block of blocks) {
    const anchor = block.match(/<a[^>]*class="[^"]*result__a[^"]*"[^>]*>/);
    if (!anchor) continue;
    const href = anchor[0].match(/href="([^"]+)"/);
    if (!href) continue;

    const titleMatch = block.match(
      /<a[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/,
    );
    const snippetMatch = block.match(
      /class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/,
    );

    const url = decodeDdgUrl(href[1]);
    const title = stripHtml(titleMatch?.[1] ?? "");
    if (title === "" || url === "") continue;

    results.push({
      title,
      url,
      snippet: stripHtml(snippetMatch?.[1] ?? ""),
    });
    if (results.length >= max) break;
  }

  return results;
}

async function searchTavily(
  query: string,
  max: number,
  apiKey: string,
): Promise<SearchResult[]> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      max_results: max,
      search_depth: "basic",
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Tavily 返回 HTTP ${response.status}：${body.slice(0, 200)}`);
  }
  const json = (await response.json()) as {
    results?: { title?: string; url?: string; content?: string }[];
  };
  return (json.results ?? [])
    .filter((r) => typeof r.url === "string")
    .slice(0, max)
    .map((r) => ({
      title: r.title ?? r.url ?? "",
      url: r.url ?? "",
      snippet: (r.content ?? "").slice(0, 400),
    }));
}

async function searchSerper(
  query: string,
  max: number,
  apiKey: string,
): Promise<SearchResult[]> {
  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: { "content-type": "application/json", "X-API-KEY": apiKey },
    body: JSON.stringify({ q: query, num: max }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Serper 返回 HTTP ${response.status}：${body.slice(0, 200)}`);
  }
  const json = (await response.json()) as {
    organic?: { title?: string; link?: string; snippet?: string }[];
  };
  return (json.organic ?? [])
    .filter((r) => typeof r.link === "string")
    .slice(0, max)
    .map((r) => ({
      title: r.title ?? r.link ?? "",
      url: r.link ?? "",
      snippet: r.snippet ?? "",
    }));
}

async function searchBrave(
  query: string,
  max: number,
  apiKey: string,
): Promise<SearchResult[]> {
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(max));

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Brave 返回 HTTP ${response.status}：${body.slice(0, 200)}`);
  }
  const json = (await response.json()) as {
    web?: { results?: { title?: string; url?: string; description?: string }[] };
  };
  return (json.web?.results ?? [])
    .filter((r) => typeof r.url === "string")
    .slice(0, max)
    .map((r) => ({
      title: r.title ?? r.url ?? "",
      url: r.url ?? "",
      snippet: stripHtml(r.description ?? ""),
    }));
}

export interface SearchOutcome {
  ok: boolean;
  results: SearchResult[];
  /** 失败原因，用于在界面上告诉用户为什么没搜到 */
  error?: string;
}

/** 按配置执行一次搜索。 */
export async function runSearch(
  query: string,
  settings: WebSearchSettings,
): Promise<SearchOutcome> {
  const q = query.trim();
  if (q === "") return { ok: false, results: [], error: "搜索词为空" };

  const max = Math.max(1, Math.min(20, settings.maxResults || 5));

  try {
    let results: SearchResult[];
    switch (settings.provider) {
      case "tavily":
        if (!settings.apiKey) throw new Error("未填写 Tavily API Key");
        results = await searchTavily(q, max, settings.apiKey);
        break;
      case "serper":
        if (!settings.apiKey) throw new Error("未填写 Serper API Key");
        results = await searchSerper(q, max, settings.apiKey);
        break;
      case "brave":
        if (!settings.apiKey) throw new Error("未填写 Brave API Key");
        results = await searchBrave(q, max, settings.apiKey);
        break;
      case "duckduckgo":
        results = await searchDuckDuckGo(q, max);
        break;
      default:
        results = await searchBing(q, max);
    }
    return { ok: true, results };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("[websearch] 搜索失败：", message);
    return { ok: false, results: [], error: message };
  }
}

/** 把结果整理成给模型看的文本块。 */
export function renderResults(query: string, results: SearchResult[]): string {
  if (results.length === 0) return "";
  const lines = [`搜索结果（关键词：${query}）：`];
  results.forEach((r, i) => {
    lines.push(`${i + 1}. ${r.title}`);
    lines.push(`   ${r.url}`);
    if (r.snippet) lines.push(`   ${r.snippet}`);
  });
  return lines.join("\n");
}
