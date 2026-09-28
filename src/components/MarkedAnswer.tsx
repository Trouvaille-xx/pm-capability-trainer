"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * 渲染 AI 回答的正文，并把 <<关键点>> 渲染成朱砂。
 *
 * 做法：先把 <<x>> 换成一个用私用区字符包起来的标记，交给 Markdown 正常解析，
 * 再用自定义组件把那个标记替换回朱砂 <span>。
 *
 * 为什么不是「按 <<>> 切开、逐段交给 Markdown」：那样一次 <<>> 会把所在段落
 * 劈成两半，标记两侧的文本各自变成一个块级 div —— 段落中间的关键点会被顶到
 * 单独一行，排版直接散架。走「先转义再还原」这条路，标记始终在段内。
 *
 * 为什么不用 <mark> 标签做中转：模型输出的正文里本来就有别的尖括号
 * （比较符、泛型、代码片段），先转一道再交给解析器，那些内容会被当标签吃掉。
 * 私用区字符在正常文本里不会出现，Markdown 也不会动它，来回都是无损的。
 */

/** 私用区字符，正文里不可能自然出现，用来做标记定界符。 */
const OPEN = "";
const CLOSE = "";

/**
 * 把 <<x>> 转成私用区定界的形式。
 *
 * 未闭合的 << 原样保留（流式输出时常见），所以生成过程中也安全。
 */
function encodeMarks(text: string): string {
  let out = "";
  let rest = text ?? "";

  while (rest !== "") {
    const open = rest.indexOf("<<");
    if (open === -1) {
      out += rest;
      break;
    }
    const close = rest.indexOf(">>", open + 2);
    if (close === -1) {
      // 还没闭合，剩下的原样输出
      out += rest;
      break;
    }
    out += rest.slice(0, open);
    const inner = rest.slice(open + 2, close).trim();
    // 空的 <<>> 直接丢掉标记，不留空 span
    out += inner === "" ? "" : `${OPEN}${inner}${CLOSE}`;
    rest = rest.slice(close + 2);
  }

  return out;
}

/**
 * 把带私用区定界符的一行文本渲染成 React 节点。
 * 定界符之间的内容包成朱砂 span，其余原样。
 */
function renderMarks(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let rest = text;
  let key = 0;

  while (rest !== "") {
    const open = rest.indexOf(OPEN);
    if (open === -1) {
      if (rest !== "") nodes.push(rest);
      break;
    }
    const close = rest.indexOf(CLOSE, open + 1);
    if (close === -1) {
      nodes.push(rest);
      break;
    }
    if (open > 0) nodes.push(rest.slice(0, open));
    nodes.push(
      <span className="answer-mark" key={key++}>
        {rest.slice(open + 1, close)}
      </span>,
    );
    rest = rest.slice(close + 1);
  }

  return nodes;
}

/** 递归处理 React 子节点：字符串里的定界符换成朱砂 span，其余节点保持原样。 */
function mapChildren(children: React.ReactNode): React.ReactNode {
  if (typeof children === "string") {
    return children.includes(OPEN) ? renderMarks(children) : children;
  }
  if (Array.isArray(children)) {
    return children.map((child, index) => {
      const mapped = mapChildren(child);
      return typeof mapped === "object" && mapped !== null && "key" in mapped
        ? mapped
        : <span key={index}>{mapped}</span>;
    });
  }
  return children;
}

export function MarkedAnswer({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children: text, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener">
              {text}
            </a>
          ),
          /* 逐元素接住定界符。p / li / strong / td 都要覆盖 ——
             关键点可能出现在段落、列表、加粗、表格里。 */
          p: ({ children: c }) => <p>{mapChildren(c)}</p>,
          li: ({ children: c }) => <li>{mapChildren(c)}</li>,
          strong: ({ children: c }) => <strong>{mapChildren(c)}</strong>,
          em: ({ children: c }) => <em>{mapChildren(c)}</em>,
          td: ({ children: c }) => <td>{mapChildren(c)}</td>,
          th: ({ children: c }) => <th>{mapChildren(c)}</th>,
          h1: ({ children: c }) => <h1>{mapChildren(c)}</h1>,
          h2: ({ children: c }) => <h2>{mapChildren(c)}</h2>,
          h3: ({ children: c }) => <h3>{mapChildren(c)}</h3>,
          h4: ({ children: c }) => <h4>{mapChildren(c)}</h4>,
        }}
      >
        {encodeMarks(children)}
      </ReactMarkdown>
    </div>
  );
}
