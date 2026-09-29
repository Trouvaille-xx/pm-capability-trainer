/**
 * 读一个流式文本响应：控制帧 + 正文。
 *
 * 协议与 /api/sessions/[id]/message 和 /api/questions/[id]/answer 共用：
 * - 控制帧：以  开头的一整行 JSON，用来报阶段（thinking / writing）
 * - 正文：其余字节，边收边上屏
 * - 中途失败：服务端在正文尾部追加 `[生成中断] 原因`，HTTP 仍是 200
 *
 * 抽出来是因为题库页、方法论页都要用同一套解析。
 * （题库详情页里那份是内联的、逻辑承重，暂不动；新代码一律用这里的。）
 */

/**
 * 控制帧前缀（ASCII 的记录分隔符 RS）。
 *
 * 用 String.fromCharCode 而不是直接写这个字符：它是个不可见控制字符，
 * 直接字面量写在源码里，任何一次「规范化换行 / 去控制字符」的工具链
 * 都可能把它悄悄吃掉，而且坏了不报错 —— 表现为控制帧永远解析不出来。
 */
export const CTRL = String.fromCharCode(30);

/** 流中途失败时服务端追加的标记。 */
export const INTERRUPT = "[生成中断]";

/** 从正文里拆出「真正的正文」和「中断原因」。 */
export function splitInterrupt(content: string): { body: string; cut: string } {
  const at = content.indexOf(INTERRUPT);
  if (at < 0) return { body: content, cut: "" };
  return {
    body: content.slice(0, at).trimEnd(),
    cut: content
      .slice(at + INTERRUPT.length)
      .trim()
      .replace(/^[：:]\s*/, ""),
  };
}

export interface StreamHandlers {
  /** 收到控制帧时回调（阶段名由服务端定） */
  onPhase?: (phase: string) => void;
  /** 正文每增长一次回调，参数是**累积**的全文 */
  onDelta: (text: string) => void;
}

/**
 * 读完整个流，返回正文全文。
 *
 * 注意：即使服务端中途失败（HTTP 200 + 正文里带 `[生成中断]`），
 * 这个函数也不抛错 —— 它把带标记的全文原样返回，由调用方用
 * `splitInterrupt` 自己判断。因为「流断了」和「请求没起来」是两回事，
 * 前者已经有内容了，不该当失败丢掉。
 */
export async function readTextStream(
  response: Response,
  handlers: StreamHandlers,
): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      /* 先把控制帧摘出来（它们总是完整的单行）。帧没接收完就先留着等下一片；
         坏帧直接丢，不影响正文。 */
      while (buffer.startsWith(CTRL)) {
        const newline = buffer.indexOf("\n");
        if (newline === -1) break;
        const line = buffer.slice(1, newline);
        buffer = buffer.slice(newline + 1);
        try {
          const frame = JSON.parse(line) as { type?: string; phase?: string };
          if (frame.type === "status" && frame.phase) handlers.onPhase?.(frame.phase);
        } catch {
          // 坏帧丢掉
        }
      }

      if (buffer !== "" && !buffer.startsWith(CTRL)) {
        text += buffer;
        buffer = "";
        handlers.onDelta(text);
      }
    }
  } finally {
    reader.releaseLock();
  }

  return text;
}
