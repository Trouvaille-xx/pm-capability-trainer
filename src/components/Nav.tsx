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

  /* 手机端的抽屉：和 open 不是一回事。
     open 改的是「栏的宽度」（桌面端内容会让位）；
     抽屉是浮层，盖在内容上、点遮罩收起。两种形态各自独立。 */
  const [drawerOpen, setDrawerOpen] = useState(false);

  /* 换页就收起抽屉 —— 否则点完导航它还盖在上面，得再点一次才看得到内容 */
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

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
    <>
      {/* 手机端的顶栏：汉堡 + 品牌名。桌面端由 CSS 隐藏。
          为什么汉堡而不是底部标签栏：导航有 6 项，底部栏放不下，
          而其中「辅助系统」是设置类的次要入口，塞进底部反而拉低主次。 */}
      <header className="mobile-bar">
        <button
          type="button"
          className="mobile-menu"
          aria-label="打开导航"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.8}
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
        <span className="mobile-brand">能力训练平台</span>
      </header>

      {drawerOpen ? (
        <div
          className="nav-scrim"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <aside
        className={`sidebar${open ? " open" : ""}${drawerOpen ? " drawer-open" : ""}`}
      >
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
        {/* 两个状态用同一套图形，只把箭头翻转方向。
            这个按钮改的是「栏的宽度」，所以画的是栏本身（左侧已填充的窄条），
            而不是汉堡/叉（那是「菜单开关」的隐喻，跟变宽变窄不是一回事）。

            之前两个状态画的是不同的图形（展开态右侧有三条横线、收起态只有一条），
            切换时线条会凭空出现 / 消失，按钮看起来在「动」。
            现在形状完全一致：收起时箭头朝右（点一下会把栏推宽），
            展开时同一根箭头朝左。
            实现上用 transform 翻转同一个 svg，而不是写两份路径 ——
            两份图形迟早会改歪，翻转则保证它的位置与形状严格不变。 */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={
            open
              ? { transform: "scaleX(-1)" }
              : undefined
          }
        >
          <rect
            x="2.5"
            y="4"
            width="7"
            height="16"
            fill="currentColor"
            opacity="0.32"
            stroke="none"
          />
          <path d="M14.2 12h7.3" />
          <path d="m18.9 9.1 2.9 2.9-2.9 2.9" />
        </svg>
        <span className="rail-toggle-label">{open ? "收起" : "展开"}</span>
      </button>

      {/* 底部说明：展开态显示内容，收起态渲染成等高的空盒。
          为什么不干脆在收起态不渲染：这块在收起/展开按钮的下方，
          它一旦不存在，按钮就失去「被顶到栏底」的依靠，会落到
          「紧贴导航下方」的位置（实测 y 从 712 跳到 313）。
          所以收起态保留一个**同高的空盒**：它不渲染文字，也就不会
          像以前那样被 68px 宽度折行撑到 270px；高度由 CSS 固定，
          两种状态一致，按钮因此稳定停在栏底。 */}
      <div className="sidebar-foot" aria-hidden={!open}>
        {open ? (
          <>
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
          </>
        ) : null}
      </div>
      </aside>
    </>
  );
}
