/**
 * 线索板的便签角度。
 *
 * 要求两条：每个条目的角度都不一样（不能撞），
 * 且同一条目每次打开都是同一个角度（便于位置记忆）。
 *
 * 做法：先生成一批互不相同的候选角度，再按 id 的哈希排序分配。
 * 直接拿随机数会让每次渲染都换位置，那不是「板」，是动画。
 */

const TILT_MIN = 2.5; // 太小的角度看起来像渲染错误，避开
const TILT_MAX = 8;

/**
 * 【为什么把上限从 15 降到 8】
 *
 * 便签现在是一行多个的自适应网格：窗口宽时一行能排到 7-8 张，
 * 单张宽度掉到 ~280px、高度 ~320px。
 * 15° 旋转会让 320px 高的纸盒在水平方向外扩约 2×(h/2)×sin15° ≈ 83px ——
 * 比卡片之间的列间距还大，于是相邻便签的角互相压过去，
 * 整面墙读起来是「歪斜」而不是「一板贴上去的纸」。
 *
 * 8° 时外扩约 44px，仍明显能看出每张角度不同（要求：角度互不重复、
 * 同一条目固定不变），但不会越界压到邻居。
 * 角度差异靠「互不相同」体现，不靠「足够大」体现。
 */

/** 生成 n 个互不相同的角度，正负交替。 */
export function tiltPool(n: number): number[] {
  if (n <= 0) return [];
  const span = TILT_MAX - TILT_MIN;
  const steps = Math.max(1, Math.floor((n - 1) / 2));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const sign = i % 2 === 0 ? 1 : -1;
    const rank = Math.floor(i / 2);
    out.push(sign * (TILT_MIN + (span * rank) / steps));
  }
  return out.map((v) => Math.round(v * 10) / 10);
}

/** FNV-1a：稳定、够散，且不依赖任何运行时状态。 */
export function hashId(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 给一组条目分配角度，返回 id → deg 的映射。
 * 同一次渲染里不会有两张便签角度相同。
 */
export function assignTilts(items: { id: string }[]): Record<string, number> {
  const n = items.length;
  if (n === 0) return {};
  const pool = tiltPool(n);
  const order = items
    .map((it, i) => ({ i, key: hashId(it.id) }))
    .sort((a, b) => a.key - b.key)
    .map((o) => o.i);

  const map: Record<string, number> = {};
  order.forEach((itemIndex, rank) => {
    map[items[itemIndex].id] = pool[rank];
  });
  return map;
}

/** 得到一个便签的 inline style。角度按 id 定，不随渲染变化。 */
export function tiltStyle(deg: number): React.CSSProperties {
  return { "--tilt": `${deg}deg` } as React.CSSProperties;
}

/**
 * 便签摘要：把 markdown 标记剥掉，只留能读的字。
 *
 * 便签正文是纯文本节点，不渲染 markdown，所以标记会**原样露出来**——
 * 实测训练师便签上就出现过 `把范围砍到一刻**` 这种字面星号。
 *
 * 注意不能只剥行首：`**粗体**` 是成对出现在句子中间的，
 * 只处理 `^[>#*\-\s]+` 会把它整段留下。所以这里全量剥。
 */
export function plainSummary(input: string, limit = 120): string {
  return input
    .replace(/```[\s\S]*?```/g, " ") // 代码块整体去掉
    .replace(/`([^`]*)`/g, "$1") // 行内代码：留内容，去反引号
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1") // 链接：留文字
    .replace(/^\s{0,3}#{1,6}\s+/gm, "") // 标题
    .replace(/^\s*[-*+]\s+/gm, "") // 无序列表符
    .replace(/^\s*\d+[.、)]\s+/gm, "") // 有序列表符
    .replace(/^\s*>\s?/gm, "") // 引用
    .replace(/\*\*|__/g, "") // 粗体（成对，落在句中）
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2") // 斜体 *x*
    /* 斜体 _x_ 只在词边界上生效：名字里的下划线（snake_case_name）
       是标识符，不是标记 —— 见了就吃会把变量名改成 snakecasename。 */
    .replace(
      /(^|[\s（(【「，。、：；!？])_([^_\n]+)_(?=$|[\s）)】」,.:;!?，。、：；])/g,
      "$1$2",
    )
    .replace(/~~/g, "") // 删除线
    .replace(/^\s*([-*_]\s*){3,}$/gm, " ") // 分隔线
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, limit);
}
