"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * 页面级错误边界。
 *
 * 之前任何一次渲染异常都会直接白屏；现在兜住并给一个「重试」出口。
 * 细节留在浏览器控制台，界面上只说人话。
 *
 * 注意 prop 名：Next 16.3 起推荐 `retry()`（重新取数并重渲染），
 * `reset()` 仍会传入但只清错误态、不重新取数。两个都接住，优先用 retry。
 */
export default function ErrorBoundary({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string };
  retry?: () => void;
  reset?: () => void;
}) {
  useEffect(() => {
    console.error("[ui] 页面渲染出错", error);
  }, [error]);

  const recover = retry ?? reset;

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>出了点问题</h1>
        </div>
      </div>

      <div className="notice notice-error">
        这个页面没能正常渲染。可以先重试一次；如果一直不行，把终端里的报错贴出来看看。
      </div>

      <div className="row">
        {recover ? (
          <button className="btn btn-primary" onClick={() => recover()}>
            重试
          </button>
        ) : null}
        <Link href="/" className="btn">
          回到概览
        </Link>
      </div>
    </div>
  );
}
