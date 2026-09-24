"use client";

/**
 * 梯形档案标签（Folder Tabs）
 *
 * 形态来自用户给的参考稿，三条规则照搬：
 * 1. 形状 —— clip-path 切出「上窄下宽」梯形，左右各内收 10px
 * 2. 尺寸 —— 所有标签等宽等高，选中后完全不变形（不会跳）
 * 3. 选中 —— 底色换成与工作区相同，并向下多探 1px 盖掉边框线，
 *            看起来像「从工作区里长出来的一张卡片」
 *
 * 配色不再用参考稿的四种彩色，改成克制的灰阶差异：
 * 未选中的标签靠 --c（浅灰底）互相区分，选中后退成白色与面板连成一体。
 * 理由：这个平台一屏内最多 8-9 个标签，四色系会太花；
 * 而且彩色标签会跟状态色（掌握度 good/warn）打架，语义会混。
 */

export interface FolderTab {
  id: string;
  label: string;
  /** 可选的计数角标，例如「全部领域 20」 */
  count?: number;
}

export function FolderTabs({
  tabs,
  active,
  onSelect,
}: {
  tabs: FolderTab[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="folder">
      <div className="folder-tabs" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={active === tab.id}
            className={`folder-tab${active === tab.id ? " on" : ""}`}
            onClick={() => onSelect(tab.id)}
            title={tab.label}
          >
            <span className="folder-tab-label">{tab.label}</span>
            {typeof tab.count === "number" ? (
              <span className="folder-tab-count">{tab.count}</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  );
}
