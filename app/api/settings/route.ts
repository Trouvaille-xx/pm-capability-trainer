import { assertSameOrigin, fail, handle, ok, readBody } from "@/lib/api";
import { toPublicSettings } from "@/lib/settings";
import { newId, readSettings, writeSettings } from "@/lib/store";
import type { AISettings, MCPServer, WebSearchProvider } from "@/lib/types";

export const dynamic = "force-dynamic";

const WEB_SEARCH_PROVIDERS: WebSearchProvider[] = [
  "bing",
  "duckduckgo",
  "tavily",
  "serper",
  "brave",
];

export async function GET() {
  return handle(async () => {
    /* 本地单人应用，设置页需要回显——但密钥不回显。
       只回传「配没配」的布尔量，明文留在 data/settings.json 里。 */
    const settings = await readSettings();
    return ok(toPublicSettings(settings));
  });
}

export async function PUT(request: Request) {
  return handle(async () => {
    assertSameOrigin(request);

    const body = await readBody<AISettings>(request);
    const current = await readSettings();
    const changes: Partial<AISettings> = {};

    if (body.baseURL !== undefined) {
      const baseURL = String(body.baseURL).trim();
      if (baseURL === "") return fail("Base URL 不能为空");
      if (!/^https?:\/\//i.test(baseURL)) return fail("Base URL 需要以 http:// 或 https:// 开头");
      changes.baseURL = baseURL.replace(/\/+$/, "");
    }
    /* 密钥采用「三态」语义：不传 = 保持原值，传空串 = 清除，传值 = 更新。
       前端因此不需要（也拿不到）回显明文。 */
    if (body.apiKey !== undefined) changes.apiKey = String(body.apiKey).trim();
    if (body.companyName !== undefined) {
      // 允许留空，留空时提示词里的 {company_name} 会退回默认值
      changes.companyName = String(body.companyName).trim().slice(0, 60);
    }

    if (body.webSearch !== undefined) {
      const input = body.webSearch ?? ({} as AISettings["webSearch"]);
      const provider = WEB_SEARCH_PROVIDERS.includes(input.provider)
        ? input.provider
        : current.webSearch.provider;
      const maxResults = Number(input.maxResults);
      changes.webSearch = {
        enabled: input.enabled === true,
        provider,
        apiKey:
          input.apiKey !== undefined
            ? String(input.apiKey).trim()
            : current.webSearch.apiKey,
        maxResults:
          Number.isFinite(maxResults) && maxResults >= 1 && maxResults <= 20
            ? Math.round(maxResults)
            : current.webSearch.maxResults,
      };
    }

    if (body.mcpServers !== undefined) {
      if (!Array.isArray(body.mcpServers)) {
        return fail("MCP 服务器列表格式不正确");
      }
      // 按 id 取回原令牌，未提供 token 字段的服务器保持原令牌不变
      const tokenById = new Map(
        current.mcpServers.map((server) => [server.id, server.token]),
      );
      const servers: MCPServer[] = [];
      for (const raw of body.mcpServers) {
        if (!raw || typeof raw !== "object") continue;
        const url = String(raw.url ?? "").trim();
        const name = String(raw.name ?? "").trim();
        if (url === "" && name === "") continue;
        if (url !== "" && !/^https?:\/\//i.test(url)) {
          return fail(`MCP 服务器「${name || url}」的地址需要以 http:// 或 https:// 开头`);
        }
        const id = String(raw.id ?? "").trim() || newId("mcp");
        servers.push({
          id,
          name: name || url,
          url,
          token:
            raw.token !== undefined
              ? String(raw.token).trim()
              : (tokenById.get(id) ?? ""),
          enabled: raw.enabled !== false,
        });
      }
      changes.mcpServers = servers;
    }
    if (body.model !== undefined) {
      const model = String(body.model).trim();
      if (model === "") return fail("模型名不能为空");
      changes.model = model;
    }
    if (body.temperature !== undefined) {
      const t = Number(body.temperature);
      if (!Number.isFinite(t) || t < 0 || t > 2) return fail("temperature 需在 0 到 2 之间");
      changes.temperature = t;
    }
    if (body.maxTokens !== undefined) {
      const m = Number(body.maxTokens);
      if (!Number.isFinite(m) || m < 64 || m > 200000) {
        return fail("maxTokens 需在 64 到 200000 之间");
      }
      changes.maxTokens = Math.round(m);
    }

    const settings = await writeSettings(changes);
    return ok(toPublicSettings(settings));
  });
}
