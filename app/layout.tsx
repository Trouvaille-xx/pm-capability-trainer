import type { Metadata } from "next";

import { Nav } from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "产品经理能力训练平台",
  description:
    "记录总结 · 方法论学习 · AI 训练师 · 辅助系统，一个闭环的产品能力训练工作台",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="shell">
          <aside className="sidebar">
            <div className="brand">
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path
                    d="M4 17.5 9.2 8.4l4.2 6.1L16.4 10l3.6 7.5"
                    stroke="currentColor"
                    strokeWidth="1.9"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="16.4" cy="10" r="1.6" fill="currentColor" />
                </svg>
              </span>
              <span className="brand-text">
                <span className="brand-title">产品能力训练师</span>
                <span className="brand-sub">PM CAPABILITY TRAINER</span>
              </span>
            </div>
            <Nav />
            <div className="sidebar-foot">
              <IconHint />
              <span>每次训练都会留下可测量的报告</span>
            </div>
          </aside>
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}

function IconHint() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={14}
      height={14}
      aria-hidden="true"
    >
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
    </svg>
  );
}
