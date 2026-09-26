/**
 * 设置投影。
 *
 * 独立的纯函数模块（不碰 node:fs），因为服务端路由与前端页面都要用同一套
 * 「对外的设置长什么样」的约定。核心不变量：**回给浏览器的对象里绝不能有密钥**。
 */

import type {
  AISettings,
  PublicAISettings,
  PublicMCPServer,
  PublicWebSearchSettings,
} from "./types";

/** 把内部设置（含密钥）投影成可以安全回给浏览器的形状。 */
export function toPublicSettings(settings: AISettings): PublicAISettings {
  const webSearch: PublicWebSearchSettings = {
    enabled: settings.webSearch.enabled,
    provider: settings.webSearch.provider,
    maxResults: settings.webSearch.maxResults,
    hasKey: settings.webSearch.apiKey.trim() !== "",
  };

  const mcpServers: PublicMCPServer[] = settings.mcpServers.map((server) => ({
    id: server.id,
    name: server.name,
    url: server.url,
    enabled: server.enabled,
    hasToken: server.token.trim() !== "",
  }));

  return {
    baseURL: settings.baseURL,
    model: settings.model,
    temperature: settings.temperature,
    maxTokens: settings.maxTokens,
    companyName: settings.companyName,
    apiKeySet: settings.apiKey.trim() !== "",
    webSearch,
    mcpServers,
  };
}
