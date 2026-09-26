import { describe, expect, it } from "vitest";

import { toPublicSettings } from "@/lib/settings";
import { DEFAULT_AI_SETTINGS } from "@/lib/store";

describe("toPublicSettings", () => {
  it("绝不回传任何密钥明文", () => {
    const publicSettings = toPublicSettings({
      ...DEFAULT_AI_SETTINGS,
      apiKey: "sk-super-secret",
      webSearch: {
        enabled: true,
        provider: "tavily",
        apiKey: "tvly-secret",
        maxResults: 5,
      },
      mcpServers: [
        {
          id: "m1",
          name: "GitHub",
          url: "https://mcp.example.com/mcp",
          token: "ghp-secret",
          enabled: true,
        },
      ],
    });

    const serialized = JSON.stringify(publicSettings);
    // 密钥的值一个都不能出现
    expect(serialized).not.toContain("sk-super-secret");
    expect(serialized).not.toContain("tvly-secret");
    expect(serialized).not.toContain("ghp-secret");
    // 承载密钥的字段本身也不该存在（注意 "apiKeySet" / "hasToken" 是允许的）
    expect(publicSettings).not.toHaveProperty("apiKey");
    expect(publicSettings.webSearch).not.toHaveProperty("apiKey");
    for (const server of publicSettings.mcpServers) {
      expect(server).not.toHaveProperty("token");
    }
  });

  it("用布尔量表达「配没配」", () => {
    const publicSettings = toPublicSettings({
      ...DEFAULT_AI_SETTINGS,
      apiKey: "sk-x",
      webSearch: { enabled: false, provider: "bing", apiKey: "", maxResults: 5 },
      mcpServers: [
        { id: "a", name: "有令牌", url: "https://a/mcp", token: "t", enabled: true },
        { id: "b", name: "无令牌", url: "https://b/mcp", token: "", enabled: true },
      ],
    });

    expect(publicSettings.apiKeySet).toBe(true);
    expect(publicSettings.webSearch.hasKey).toBe(false);
    expect(publicSettings.mcpServers.map((s) => s.hasToken)).toEqual([true, false]);
  });

  it("保留非密钥字段，便于设置页回显", () => {
    const publicSettings = toPublicSettings({
      ...DEFAULT_AI_SETTINGS,
      baseURL: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      companyName: "某某公司",
    });

    expect(publicSettings.baseURL).toBe("https://api.deepseek.com/v1");
    expect(publicSettings.model).toBe("deepseek-chat");
    expect(publicSettings.companyName).toBe("某某公司");
  });
});
