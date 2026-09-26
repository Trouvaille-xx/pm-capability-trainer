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
/**
 * 把「行内换行」转成 Markdown 硬换行（行尾两个空格）。
 *
 * 聊天里换行是有意义的：用户分三行写的答案、模型逐行列出的交付物，
 * 都不该被 Markdown 折成一整段。
 *
 * 以前是靠容器上的 white-space: pre-wrap 保换行的，但那样一来，
 * react-markdown 在块级元素之间输出的那些换行文本节点也会被
 * 渲染成空行 —— 一个两项列表能凭空多出 70px。所以改成在
 * 源码层面加硬换行，容器恢复正常空白折叠。
 *
 * 代码块里的换行必须原样保留，遇到 ``` / ~~~ 围栏就跳过。
 */
function withHardBreaks(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let inFence = false;

  /* 行首是块级标记的行不碰：标题、列表、引用、表格、围栏。
     对它们收尾加空格没有意义，还可能改变解析结果。 */
  const isBlockStart = (line: string) =>
    /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|~~~)/.test(line);

  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      out.push(line);
      return;
    }

    const next = lines[index + 1];
    const breaks =
      !inFence &&
      line.trim() !== "" &&
      !isBlockStart(line) &&
      next !== undefined &&
      next.trim() !== "" &&
      !isBlockStart(next);

    out.push(breaks ? `${line}  ` : line);
  });

  return out.join("\n");
}

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
        {withHardBreaks(children)}
      </ReactMarkdown>
    </div>
  );
}
