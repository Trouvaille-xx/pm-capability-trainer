"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import {
  IconCapture,
  IconDashboard,
  IconMethodology,
  IconQuestions,
  IconSettings,
  IconTrainer,
} from "@/components/icons";

import type { ComponentType, SVGProps } from "react";

type NavLink = {
  href: string;
  label: string;
  hint: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
};

/**
 * 每一页一个自己的图标。
 *
 * 之前折叠态是一条宽度不同的短线（靠「长短」区分），展开态则完全没有图形。
 * 长短是抽象差别，看一眼记不住哪条对应哪页；换成图形之后，
 * 折叠时是五个可辨认的符号，展开时图标和文字并排，位置也稳定。
 * 图标定义在 components/icons.tsx，遵守那里的约定（24 视框 / 1.7 描边 / currentColor）。
 */
const LINKS: NavLink[] = [
  { href: "/", label: "概览", hint: "整体进度与最近动态", icon: IconDashboard },
  { href: "/capture", label: "记录总结", hint: "图书 / 文章 / 笔记思考", icon: IconCapture },
  { href: "/methodology", label: "方法论", hint: "跨领域知识点卡片", icon: IconMethodology },
  { href: "/trainer", label: "AI 训练师", hint: "三个场景 · 四种模式", icon: IconTrainer },
  { href: "/questions", label: "题库", hint: "面试真题与思考题", icon: IconQuestions },
  { href: "/settings", label: "辅助系统", hint: "AI 配置与提示词", icon: IconSettings },
];

const KEY = "pm-rail-open";

/**
 * 侧栏。两种形态：
 *   折叠 68px —— 只有朱砂标记和卡边，零文字
 *   展开 200px —— 完整标签
 *
 * 展开时内容区向右让位（不是浮层盖上去 —— 那会直接遮住内容）。
 * 状态存在 localStorage，刷新后保持；也响应键盘 [ 键。
 */
export function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [ready, setReady] = useState(false);

  // 初次挂载时读取上次的状态。放在 effect 里避免服务端渲染不一致。
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(KEY);
    } catch {
      saved = null;
    }
    setOpen(saved === "1");
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    document.body.classList.toggle("rail-open", open);
    try {
      localStorage.setItem(KEY, open ? "1" : "0");
    } catch {
      /* 隐私模式下写不进去，忽略 */
    }
  }, [open, ready]);

  // [ 键切换
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "[") return;
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === "function" && t.closest("input,textarea,select")) {
        return;
      }
      e.preventDefault();
      setOpen((v) => !v);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  return (
    <aside className={`sidebar${open ? " open" : ""}`}>
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
          </svg>
        </span>
        <span className="brand-text">
          <span className="brand-title">能力训练平台</span>
          <span className="brand-sub">PM CAPABILITY TRAINER</span>
        </span>
      </div>

      <nav className="nav" aria-label="主导航">
        {LINKS.map(({ href, label, hint, icon: Icon }) => {
          const active =
            href === "/"
              ? pathname === "/"
              : pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              className={`nav-link${active ? " active" : ""}`}
              title={hint}
              aria-current={active ? "page" : undefined}
            >
              <span className="nav-icon" aria-hidden="true">
                <Icon />
              </span>
              <span className="nav-label">{label}</span>
            </Link>
          );
        })}
      </nav>

      <button
        type="button"
        className="rail-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={open ? "收起侧栏（[）" : "展开侧栏（[）"}
      >
        {/* 两个状态用不同的图。
            这个按钮改的是「栏的宽度」，所以画的是栏本身，而不是汉堡/叉
            （那是「菜单开关」的隐喻，跟变宽变窄不是一回事）：
              收起 —— 左窄条已填充 + 右侧留白，加一个向左的箭头
              展开 —— 左宽条已填充 + 右侧两条内缩的线，加一个向右的箭头 */}
        {open ? (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2.5" y="4" width="7" height="16" fill="currentColor" opacity="0.32" stroke="none" />
            <path d="M14.5 8.5h7" />
            <path d="M14.5 12h5" />
            <path d="M14.5 15.5h7" />
            <path d="m14.6 9.5-2.6 2.5 2.6 2.5" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.7}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <rect x="2.5" y="4" width="7" height="16" fill="currentColor" opacity="0.32" stroke="none" />
            <path d="M14.5 12h7" />
            <path d="m19.1 9.5 2.6 2.5-2.6 2.5" />
          </svg>
        )}
        <span className="rail-toggle-label">{open ? "收起" : "展开"}</span>
      </button>

      <div className="sidebar-foot">
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
        <span>每次训练都会留下可测量的报告</span>
      </div>
    </aside>
  );
}
