"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";

import {
  IconCapture,
  IconDashboard,
  IconMethodology,
  IconSettings,
  IconTrainer,
} from "@/components/icons";

const LINKS: {
  href: string;
  label: string;
  hint: string;
  Icon: ComponentType<SVGProps<SVGSVGElement>>;
}[] = [
  {
    href: "/",
    label: "概览",
    hint: "整体进度与最近动态",
    Icon: IconDashboard,
  },
  {
    href: "/capture",
    label: "记录总结",
    hint: "图书 / 文章 / 笔记思考",
    Icon: IconCapture,
  },
  {
    href: "/methodology",
    label: "方法论",
    hint: "跨领域知识点卡片",
    Icon: IconMethodology,
  },
  {
    href: "/trainer",
    label: "AI 训练师",
    hint: "三个场景 · 四种模式",
    Icon: IconTrainer,
  },
  {
    href: "/settings",
    label: "辅助系统",
    hint: "AI 配置与提示词",
    Icon: IconSettings,
  },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="nav">
      <div className="nav-group-label">工作台</div>
      {LINKS.map(({ href, label, hint, Icon }) => {
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
          >
            <span className="nav-icon">
              <Icon width={17} height={17} />
            </span>
            <span className="nav-label">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
