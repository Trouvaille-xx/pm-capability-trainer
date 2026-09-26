"use client";

import "./globals.css";

/**
 * 最外层兜底：根布局自身崩了才会走到这里，所以必须自己渲染 html/body。
 * 样式也要手动引入——根布局被替换掉了。
 *
 * 同 app/error.tsx：Next 16.3 起优先用 `retry()`，`reset()` 作为兜底接住。
 */
export default function GlobalError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  const recover = retry ?? reset;

  return (
    <html lang="zh-CN">
      <body>
        <div className="shell">
          <main className="content">
            <div className="stack">
              <div className="page-head">
                <div>
                  <h1>应用没能启动</h1>
                </div>
              </div>
              <div className="notice notice-error">
                发生了未捕获的错误。检查终端日志，必要时删掉 data/ 目录重来（数据会丢失）。
              </div>
              <div className="row">
                {recover ? (
                  <button className="btn btn-primary" onClick={() => recover()}>
                    重试
                  </button>
                ) : null}
              </div>
              {error.digest ? (
                <div className="hint">错误标识：{error.digest}</div>
              ) : null}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
