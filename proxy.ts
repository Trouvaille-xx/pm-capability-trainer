import { NextResponse, type NextRequest } from "next/server";

/**
 * HTTP Basic 认证。
 *
 * 为什么需要：这个应用没有账号体系（本来就是给一个人在本机用的），
 * 但一旦放到公网，任何人都能读你的记录、题库、方法论。
 * 接口层虽然不回传密钥明文，但没有登录就等于没有防护。
 *
 * 用 Basic 而不是自建登录页：这是单人工具，不值得引入会话/密码存储/
 * 找回流程那一整套。Basic 由浏览器原生弹框，一行头就够，Nginx 也认。
 *
 * 【注意】Next 16 把 middleware 改名成了 proxy，文件与导出名都换了。
 * 见 node_modules/next/dist/docs 的 proxy.md。
 *
 * 【开关】只有设了 BASIC_AUTH_USER + BASIC_AUTH_PASS 才生效。
 * 本地开发不设这两个变量，就完全不受影响。
 */
export function proxy(request: NextRequest) {
  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASS;

  // 没配就不启用 —— 本地开发、或用户明确不想加锁时不该被拦住
  if (!user || !pass) return NextResponse.next();

  const header = request.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const decoded = safeDecode(header.slice(6));
    if (decoded && timingSafeEqual(decoded, `${user}:${pass}`)) {
      return NextResponse.next();
    }
  }

  return new NextResponse("需要登录", {
    status: 401,
    headers: {
      // 浏览器见到这个头会弹原生登录框
      "WWW-Authenticate": 'Basic realm="PM Trainer", charset="UTF-8"',
      "Cache-Control": "no-store",
    },
  });
}

/** base64 解码；坏输入返回 null 而不是抛错（请求头是外部输入）。 */
function safeDecode(value: string): string | null {
  try {
    // atob 给的是 latin1 字符串，用 TextDecoder 还原成 UTF-8
    const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
}

/**
 * 定长比较，避免按字符逐位比较时的时序差泄露密码长度/前缀。
 * 单人工具其实不必防到这个程度，但写起来就几行，没有理由不做。
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const config = {
  /* 排除静态资源：否则 CSS/JS/图片全都会被 401 拦住，页面直接白屏。
     也排除 favicon，免得每次都在网络面板里留一条 401。 */
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
