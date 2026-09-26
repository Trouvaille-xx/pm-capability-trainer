/**
 * 统一的 SVG 图标集。
 *
 * 设计约定（改图标时请遵守，否则视觉会散）：
 * - 24×24 视框，线性描边，stroke-width 1.7，round 端点与连接
 * - 颜色一律用 currentColor，由父级文字色决定
 * - 不写死尺寸，宽高由 CSS 控制
 *
 * 之所以不再用 ◎ ✎ ❖ 这类文字符号：它们的字重、基线、视觉重心各不相同，
 * 在不同字体下还会变形，放在一起明显不齐。
 */

import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

/** 概览：仪表盘 */
export function IconDashboard(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="7.5" height="8.5" rx="2" />
      <rect x="13.5" y="3" width="7.5" height="5.5" rx="2" />
      <rect x="13.5" y="11.5" width="7.5" height="9.5" rx="2" />
      <rect x="3" y="14.5" width="7.5" height="6.5" rx="2" />
    </Icon>
  );
}

/** 记录总结：文档加笔 */
export function IconCapture(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M13.5 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h5" />
      <path d="M9 8h5" />
      <path d="M9 12h3" />
      <path d="M17.8 13.3a1.9 1.9 0 0 1 2.7 2.7L16 20.5l-3.2.7.7-3.2z" />
    </Icon>
  );
}

/** 方法论：层叠卡片 */
export function IconMethodology(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3 3.5 7.2 12 11.4l8.5-4.2z" />
      <path d="M3.5 12.2 12 16.4l8.5-4.2" />
      <path d="M3.5 16.9 12 21.1l8.5-4.2" />
    </Icon>
  );
}

/** AI 训练师：目标靶心 */
export function IconTrainer(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.6" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** 辅助系统：滑块 */
export function IconSettings(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 8h9" />
      <path d="M17 8h3" />
      <path d="M4 16h4" />
      <path d="M12 16h8" />
      <circle cx="15" cy="8" r="2.2" />
      <circle cx="10" cy="16" r="2.2" />
    </Icon>
  );
}

/** 新建 / 添加 */
export function IconPlus(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </Icon>
  );
}

/** 搜索 */
export function IconSearch(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Icon>
  );
}

/** 发送 */
export function IconSend(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12 20.5 4.5 13 20l-1.8-6.2z" />
      <path d="m11.2 13.8 3.4-3.4" />
    </Icon>
  );
}

/** 返回 */
export function IconBack(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19 12H5" />
      <path d="m11 6-6 6 6 6" />
    </Icon>
  );
}

/** 编辑 */
export function IconEdit(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" />
      <path d="M14.5 6.5 17.5 9.5" />
    </Icon>
  );
}

/** 删除 */
export function IconTrash(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16" />
      <path d="M9 7V5h6v2" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10.5 11v5" />
      <path d="M13.5 11v5" />
    </Icon>
  );
}

/** 折叠箭头 */
export function IconChevronDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6 9.5 6 6 6-6" />
    </Icon>
  );
}

/** 报告：柱状图 */
export function IconReport(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-7" />
      <path d="M22 20H2" />
    </Icon>
  );
}

/** 对话 */
export function IconChat(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M20 12a7.5 7.5 0 0 1-10.9 6.7L4 20l1.3-4.1A7.5 7.5 0 1 1 20 12z" />
    </Icon>
  );
}

/** 完成 / 勾选 */
export function IconCheck(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m5 12.5 4.5 4.5L19 7" />
    </Icon>
  );
}

/** 警告 / 提示 */
export function IconAlert(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v5" />
      <path d="M12 16h.01" />
    </Icon>
  );
}

/** 书本 */
export function IconBook(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 5.5A2 2 0 0 1 6 3.5h13v15H6a2 2 0 0 0-2 2z" />
      <path d="M4 18.5A2 2 0 0 1 6 16.5h13" />
    </Icon>
  );
}

/** 文章 */
export function IconArticle(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 8h8" />
      <path d="M8 12h8" />
      <path d="M8 16h5" />
    </Icon>
  );
}

/** 笔记思考：灯泡 */
export function IconNote(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9.5 17.5 9 20h6l-.5-2.5" />
      <path d="M12 3a6 6 0 0 0-3.6 10.8c.4.3.6.8.6 1.2h6c0-.4.2-.9.6-1.2A6 6 0 0 0 12 3z" />
    </Icon>
  );
}

/** 箭头向右：进入详情、下一步 */
export function IconArrowRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Icon>
  );
}

/** 外部/展开：从列表进入独立页面 */
export function IconExpand(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
    </Icon>
  );
}

/** 标签 */
export function IconTag(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 11.4V5a1.5 1.5 0 0 1 1.5-1.5h6.4a1.5 1.5 0 0 1 1 .4l7.4 7.4a1.5 1.5 0 0 1 0 2.1l-6.4 6.4a1.5 1.5 0 0 1-2.1 0L4 12.4a1.5 1.5 0 0 1-.5-1z" />
      <circle cx="8" cy="8" r="1.4" />
    </Icon>
  );
}

/** 日历 / 时间 */
export function IconCalendar(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 9.5h17" />
      <path d="M8 3.5v3" />
      <path d="M16 3.5v3" />
    </Icon>
  );
}

/** 列表 / 要点 */
export function IconList(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 6.5h11" />
      <path d="M9 12h11" />
      <path d="M9 17.5h11" />
      <circle cx="4.6" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.6" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="4.6" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** 火花 / 灵感：用于洞察、建议 */
export function IconSpark(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
      <path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
    </Icon>
  );
}

/** 靶心 / 目标：用于下一步建议 */
export function IconTarget(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    </Icon>
  );
}

/** 趋势向上：用于得分、成长 */
export function IconTrend(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3.5 16.5 9 11l3.5 3.5L20.5 6.5" />
      <path d="M15.5 6.5h5v5" />
    </Icon>
  );
}

/** 用户 / 人：用于角色、对象 */
export function IconUser(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </Icon>
  );
}

/** 流程 / 节点连接：用于流程设计 */
export function IconFlow(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3.5" width="6.5" height="5.5" rx="1.8" />
      <rect x="14.5" y="15" width="6.5" height="5.5" rx="1.8" />
      <path d="M6.25 9v4.5a2 2 0 0 0 2 2h6.25" />
      <path d="M12.5 12.5 14.5 15.5" />
    </Icon>
  );
}

/** 网格 / 全览：用于「全部」标签 */
export function IconGrid(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2" />
    </Icon>
  );
}

/** 保存 / 落盘 */
export function IconSave(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 3.5h11L20.5 8v12a1 1 0 0 1-1 1h-14a1 1 0 0 1-1-1v-15a1 1 0 0 1 1-1z" />
      <path d="M8 3.5v6h7v-6" />
      <path d="M8 20.5v-6h8v6" />
    </Icon>
  );
}

/** 导出 / 下载 */
export function IconDownload(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5v11" />
      <path d="M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4.5 17v2.5a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V17" />
    </Icon>
  );
}

/** 幻灯片 / PPT 大纲 */
export function IconSlides(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M12 16.5v3.5" />
      <path d="M8.5 20h7" />
      <path d="M7.5 8.5h9" />
      <path d="M7.5 12h5" />
    </Icon>
  );
}

/** 联网 / 地球 */
export function IconGlobe(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.2 2.4 3.4 5.4 3.4 8.5s-1.2 6.1-3.4 8.5c-2.2-2.4-3.4-5.4-3.4-8.5S9.8 5.9 12 3.5z" />
    </Icon>
  );
}

/** 插头 / 外部服务（MCP） */
export function IconPlug(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 3.5v5" />
      <path d="M15 3.5v5" />
      <path d="M6.5 8.5h11v3a5.5 5.5 0 0 1-5.5 5.5 5.5 5.5 0 0 1-5.5-5.5v-3z" />
      <path d="M12 17v3.5" />
    </Icon>
  );
}

/**
 * 题库：问号 + 卡片轮廓。
 *
 * 为什么不用「书本」：方法论已经是三层叠放的卡片，记录总结是文档 + 笔，
 * 再加一本书会有三个近似的方形轮廓，折叠成 68px 时根本分不出来。
 * 问号是这五个图标里唯一的曲线符号，缩到 17px 也认得出来。
 */
export function IconQuestions(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9.4 9.2a2.7 2.7 0 1 1 3.4 2.6c-.6.2-.9.7-.9 1.3v.6" />
      <path d="M11.9 16.6h.01" />
    </Icon>
  );
}
