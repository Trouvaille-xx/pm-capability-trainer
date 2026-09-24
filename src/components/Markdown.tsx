"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * 渲染模型输出的 Markdown。
 *
 * 训练师会输出标题、列表、表格、代码块、加粗结论，
 * 直接当纯文本显示会变成一堆星号和井号，很难读。
 *
 * remark-gfm 打开表格、删除线、任务列表这些 GitHub 扩展语法 ——
 * 评分表和竞品对比经常是表格，必须支持。
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 外链一律新窗口打开，避免把训练页顶掉
          a: ({ children: text, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener">
              {text}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
