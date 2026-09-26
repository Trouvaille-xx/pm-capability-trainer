"use client";

import Link from "next/link";

/** 找不到的页面（比如手输了一个不存在的会话 id）。 */
export default function NotFound() {
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>没有这个页面</h1>
        </div>
      </div>

      <div className="notice notice-info">
        你要找的内容不存在，可能是链接过期，或者这条记录已经被删掉了。
      </div>

      <div className="row">
        <Link href="/" className="btn btn-primary">
          回到概览
        </Link>
        <Link href="/trainer" className="btn">
          去看训练记录
        </Link>
      </div>
    </div>
  );
}
