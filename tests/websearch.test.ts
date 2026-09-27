import { afterEach, describe, expect, it, vi } from "vitest";

import { runSearch } from "@/lib/websearch";

/** 把 fetch 换掉，避免测试真的出网。 */
function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
    Promise.resolve(handler(url, init)),
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ANYSEARCH_SETTINGS = {
  enabled: true,
  provider: "anysearch" as const,
  apiKey: "",
  maxResults: 3,
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AnySearch 来源", () => {
  it("匿名时请求体正确，且不发送 Authorization 头", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    mockFetch((url, init) => {
      seenUrl = url;
      seenInit = init;
      return jsonResponse({
        code: 0,
        message: "success",
        data: { results: [{ title: "T", url: "https://e.com", snippet: "S" }] },
      });
    });

    const out = await runSearch("测试", ANYSEARCH_SETTINGS);

    expect(seenUrl).toBe("https://api.anysearch.com/v1/search");
    expect(seenInit?.method).toBe("POST");
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers.authorization).toBeUndefined();
    const body = JSON.parse(String(seenInit?.body));
    expect(body.query).toBe("测试");
    expect(body.max_results).toBe(3);
    expect(body.format).toBe("json");
    expect(out.ok).toBe(true);
    expect(out.results).toEqual([
      { title: "T", url: "https://e.com", snippet: "S" },
    ]);
  });

  it("填了 Key 就带 Bearer 头", async () => {
    let headers: Record<string, string> = {};
    mockFetch((_url, init) => {
      headers = init?.headers as Record<string, string>;
      return jsonResponse({ code: 0, data: { results: [] } });
    });

    await runSearch("测试", { ...ANYSEARCH_SETTINGS, apiKey: "as-abc" });

    expect(headers.authorization).toBe("Bearer as-abc");
  });

  it("官方上限是 10，传更大的 maxResults 也只请求 10", async () => {
    let body: { max_results?: number } = {};
    mockFetch((_url, init) => {
      body = JSON.parse(String(init?.body));
      return jsonResponse({ code: 0, data: { results: [] } });
    });

    await runSearch("测试", { ...ANYSEARCH_SETTINGS, maxResults: 20 });

    expect(body.max_results).toBe(10);
  });

  it("标题为空串时用 url 兜底，不产生无标题结果", async () => {
    mockFetch(() =>
      jsonResponse({
        code: 0,
        data: {
          results: [
            { title: "", url: "https://only-url.com", snippet: "" },
            { title: "正常", url: "https://ok.com", snippet: "s" },
          ],
        },
      }),
    );

    const out = await runSearch("测试", ANYSEARCH_SETTINGS);

    expect(out.results[0].title).toBe("https://only-url.com");
    expect(out.results).toHaveLength(2);
  });

  it("丢掉没有 url 的条目", async () => {
    mockFetch(() =>
      jsonResponse({
        code: 0,
        data: { results: [{ title: "没有链接", snippet: "x" }, { url: "https://a.com" }] },
      }),
    );

    const out = await runSearch("测试", ANYSEARCH_SETTINGS);

    expect(out.results).toHaveLength(1);
    expect(out.results[0].url).toBe("https://a.com");
  });

  it("401/403 区分「密钥有问题」和「没填密钥」，各给一条可操作的出路", async () => {
    mockFetch(() => new Response("nope", { status: 401 }));

    const withKey = await runSearch("测试", {
      ...ANYSEARCH_SETTINGS,
      apiKey: "bad",
    });
    const noKey = await runSearch("测试", ANYSEARCH_SETTINGS);

    expect(withKey.ok).toBe(false);
    expect(withKey.error).toContain("密钥无效或已停用");
    expect(noKey.error).toContain("补一个密钥");
  });

  it("业务码非 0 也算失败", async () => {
    mockFetch(() => jsonResponse({ code: 4001, message: "bad query" }));

    const out = await runSearch("测试", ANYSEARCH_SETTINGS);

    expect(out.ok).toBe(false);
    expect(out.error).toContain("bad query");
  });
});
