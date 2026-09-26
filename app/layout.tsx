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
    /* 浏览器扩展（比如 Scribe 录制器、各种翻译/主题插件）会在 React
       接管之前往 <html> 上写自己的属性，React 会因此报 hydration
       mismatch。这个属性不归我们管，也没法在服务端渲染出来，
       所以对 <html> 自身关掉这项检查 —— 注意只影响这一个元素，
       子树里的真实 mismatch 照样会报。 */
    <html lang="zh-CN" suppressHydrationWarning>
      <body>
        <div className="shell">
          <Nav />
          <main className="content">{children}</main>
        </div>
      </body>
    </html>
  );
}
