---
name: board-ui
description: 产品经理能力训练平台的前端风格约束。写或改这个项目的任何界面（页面、组件、CSS）时必须先读它——它记录的是**有意禁掉的默认写法**，以及 token、组件类名、动效与无障碍的既有约定。触发场景：新增/修改 app/ 下的页面或 src/components/ 下的组件、改 app/globals.css、加 UI 元素（按钮/表单/标签/弹窗/空态）、做布局或响应式调整、写动效。
---

# 线索板设计系统（v5）—— 前端风格约束

调性：**一个人用的练功房，不是后台管理系统**。材料是纸——便签、批注、页边。
界面该像一板贴着便签的纸，而不是仪表盘或应用外壳。

## 一、纪律：这些是「有意禁掉」，不是疏忽

改这个项目最容易犯的错，是把通用后台那套默认写法带进来。
以下每一条都在 `app/globals.css` 顶部写明了原因，**不要"顺手优化"回去**：

| 禁 | 原因 |
|---|---|
| 等宽字体做小标签 | monospace 微标签是「模板感」的第一来源 |
| 元信息用 `·` 串起来 | 读起来像模板占位符 |
| 链接文字后面加 `→` | 同上 |
| 等大等圆角的卡片网格 | 那是后台管理系统的形状 |
| 深色主题 | 纸的隐喻不成立 |
| 左侧 B 端目录树导航 | 这是个人工具，不是管理台 |
| 装饰性 eyebrow 小标签 | 用 `.blk-label` / `.section-label` 这类**有信息意义**的标签 |
| 逐卡 hover 淡入 | 动效要**一次编排好的整体动作**（用 `--spring`），不是每个元素各动各的 |

另外两条容易误伤的：

- **圆角一律为 0**。`--r-*` 系列在 `:root` 里先定义刻度、随后统一归零（印刷品不切圆角）。
  **新增任何圆角 token 都要同步归零**——`--r-md` 就是漏了一条，导致个别元素残留 12px。
- **不用 `--sh-*` 做层次**。层次靠底色和描边（`--rule` / `--rule-2` / `--paper-2`），
  只有便签的 `--sh-note` 例外（那是「纸微微离开板面」）。

**文案：不写解释性备注。** 界面上只留两类文字——

1. **影响操作的**：取值范围、安全声明、三态说明（「留空即不改动，清除要点按钮」）
2. **用户看不出来的**：需要手工填写的格式要求、可用变量清单

**「解释了等于没解释」的一句都不要**——最典型的是「A 和 B 一起保存」这类自述，
以及把两个字段的联动关系复述一遍的说明。
判断标准一句话：**这句删了，会让人做错事吗？** 会 → 留；不会 → 删。

## 二、Token（一律用变量，不要写死颜色）

```css
/* 纸与板：板比纸深，纸才能读成「一张纸」 */
--board: #efece6   --paper: #ffffff   --paper-2: #faf8f4   --rail-bg: #e9e5de

/* 墨：暖黑，不是蓝黑 */
--ink: #14120f     --ink-2: #56514a   --ink-3: #8c857a    --ink-4: #b5aea2

/* 描边：属于板的线 */
--rule: #dad4c9    --rule-2: #e9e5de

/* 朱砂：唯一的强调色 */
--mark / --brand: #b33a2b   --brand-ink: #8a2b1f   --brand-soft: #f7ece9

/* 语义色：也收敛到低饱和 */
--good: #2f6b4a    --warn: #8a6d1f    --bad: #b33a2b

/* 记号（全站「边注竖线」母题的高度阶梯）—— 详见下一节 */
--mark-thick: 2px   /* 所有记号的线宽，恒定 */
--mark-xs: 10px     /* 分类标签、.note-tags、表单字段名 */
--mark-sm: 13px     /* 小节标题、模块名 */
--mark-lg: 20px     /* 页面大标题（h1::before 实际用 0.82em 跟字号走）*/

/* 动效 */
--ease: cubic-bezier(0.22, 1, 0.36, 1)      /* 常规过渡 */
--spring: cubic-bezier(0.34, 1.4, 0.64, 1)  /* 便签/整体位移 */
--rail-dur: 0.34s
```

字体：标题 `--serif`（书卷气），正文 `--sans`（屏幕可读）。**别给正文用衬线。**

## 三、记号语言：全站的边注竖线

这是现在**最普遍**的视觉母题。几乎每个「标签 / 小标题 / 字段名」前面都有一根
短竖线（`::before`，宽度恒为 `--mark-thick`，高度取下面的阶梯）：

| 高度 | 用在哪 |
|---|---|
| `--mark-xs` (10px) | 分类标签 `.domain`、`.note-tags`、表单字段名 `.set-field-label`、二级分组名 `.set-pgroup-name`、分段块标签 `.q-ans-label` |
| `--mark-sm` (13px) | 小节标题 `.blk-label` / `.reader-sec-label`、模块名 `.set-module-name`、侧栏当前章节 `.toc a.on` |
| `--mark-lg` (20px) | 页面大标题（`h1::before` 实际写 `0.82em`，跟着字号走，不必逐页配高度）|

**颜色分两档，别用错**：

- **朱砂** = 这一条带「内容上的主次 / 归属」→ 章节名、小节标题、关键点、当前项
- **灰 `--rule`** = 只是「这里有一项」→ 非当前的侧栏章节、二级分组名
- 悬停时灰变朱砂（`.toc a:hover::before`），是唯一的过渡

**朱砂纪律：一屏只有一处「实心强调」。** 竖线记号可以很多 —— 它们是标点，
不是强调。但**实心填色**（`--brand` 底、标签胶囊、当前项高亮）一屏只该有一处。
出现六次强调色就是没有强调。（`::selection` 是朱砂。）

**按钮不用朱砂。** 主按钮 = **墨色实底**（`.btn-primary` 是 `var(--ink)` 底 + 纸色字），
次级 = **纯文字 + 下划线**（`.btn`），危险操作才用 `.btn-danger`。
`globals.css` 里写死了理由：朱砂留给「正在进行」这类只出现一次的信号，
而按钮每一页都有。`border-radius` 一律 0，不加投影。

## 四、核心视觉母题：便签

多个列表页共用一套便签：

```html
<article class="note" style="--tilt: -0.7deg">
  <span class="note-pin" aria-hidden="true"></span>   <!-- 图钉，必须 -->
  <div class="note-domain"><!-- 分类 + [状态] --></div>
  <h2 class="note-title">…</h2>
  <div class="note-foot">…</div>
</article>
```

- **角度用 `src/lib/board.ts` 的 `assignTilts()` + `tiltStyle()`**，不要自己写随机数。
  它保证「每个条目角度都不同、且同一 id 每次都是同一个角度」（位置记忆）；
  随机数会让每次渲染换位置，那不是板，是动画。范围 `TILT_MIN/MAX = 2.5–8deg`。
- 便签上的正文用 `plainSummary()`（`src/lib/board.ts`）剥掉 markdown 标记——
  便签渲染的是纯文本，`**粗体**` 会原样露出来。
- 便签是「一次编排好的整体动作」：hover 时角度归正、阴影加深，用 `--spring`。

## 五、组件类名（不要在页面里重造）

| 用途 | 类名 |
|---|---|
| 页面骨架 | `.stack`（纵向留白）`.page-head`（标题+操作）`.page-actions` `.spacer` |
| 区块标题 | `.section-label`（带 `::after` 延伸线）`.section-title` `.section-note` `.blk-label` |
| 卡片 | `.card` `.card-tight` `.card-actions` |
| 按钮 | `.btn` `.btn-primary` `.btn-ghost` `.btn-danger` `.btn-sm`；文字按钮用 `.vs-btn` |
| 表单 | `.field` `.input` `.textarea` `.select` `.form-input` `.form-textarea` `.form-choice-chip` |
| 标签 | `.tag` + `.tag-brand/.tag-good/.tag-warn/.tag-bad`；`.state-mark`（自动补 `[ ]`） |
| 分类标签 | `.domains` / `.domain` / `.domain-code`（用 `<DomainTags>` 组件，别手写） |
| 空态 | `.empty`（行内）`.empty-board`（整块，配 `h3` + `p` + `.hint-actions`） |
| 提示条 | `.notice` + `.notice-error/.notice-good/.notice-info` |
| 弹窗 | `src/components/Modal.tsx` 的 `Modal` / `ConfirmDialog` |
| 评分刻度 | `.score-bar` / `.score-fill` / `.score-row` |
| 两列表单页 | `.setwrap`（`186px + 1fr`）`.set-field` `.set-hint` `.set-status` |
| 两级分组 + 就地编辑 | `.set-module` + `.set-pgroup`；编辑区 `.set-tpl-editor-head`（深色标题栏）`.set-tpl-body` `.set-tpl-actions`（吸底操作条） |
| 详情页（目录轨 + 正文） | `.q-shell`（两列）`.qtoc` `.lead-main` `.lead-side` `.q-body` |
| 分段信息块 | `.q-ans` + `.q-ans-guide/-main/-warn/-plain`（四档语气：轻 / 主 / 警示 / 素）；正文里的 `<<重点>>` 渲染成 `.answer-mark` |
| 加载动画 | `.q-loading` + `.q-loading-marks i`（三根朱砂竖线依次起伏；`prefers-reduced-motion` 下静止） |
| 便签状态色 | 便签上加 `.stage-done` / `.stage-doing` 换图钉颜色；不加 class = 默认灰 |
| 记号竖线 | 见 §三；`.blk-label` `.reader-sec-label` `.q-ans-label` `.set-field-label` 等都自带 `::before` |
| 附属列表 | `.source-list` / `.related-list` `.related-title` `.related-def`（列表项标题用朱砂） |
| 骨架 | `.shell` / `.sidebar`（fixed）/ `.content` / `.rail-toggle` |

**布局原语**：`.row` `.stack` `.grid .grid-2/3/4`。改间距优先用它们，别写 inline style——
但本项目**允许必要的 inline style**（个别排版微调），
因为设计系统刻意不做「工具类全家桶」。判断标准：**能复用的进 CSS，一次性的可以 inline。**

## 六、无障碍：这些已经是既有标准，别退化

- 图标组件一律 `aria-hidden` + `focusable="false"`（见 `src/components/icons.tsx`）。
- 只用 `:focus-visible` 做焦点环（`outline: 2px solid var(--mark)`），
  不要用 `:focus`——鼠标点击不该出现焦点环。
- **每个动效都要有 `prefers-reduced-motion` 覆盖**。项目里已有 6 处这样的块
  （全局一处 `*` 兜底 + 各模块各自一处），新增过渡/动画时同步补上。
- 可点击的便签用 `role="button"` + `tabIndex={0}` + Enter/Space 处理（照抄列表页写法）。
- 装饰性元素（图钉、刻度、竖线）必须 `aria-hidden="true"`。
- 有悬停才显示的信息（如目录文字），键盘 `:focus-within` 也要能显示。

## 七、改布局前先量，别猜

这个项目**有多处「看着像小问题、其实是布局根因」的坑**，靠推理容易改错方向。
改侧栏、网格、sticky 这类布局时，先用 Playwright 量两种状态的几何位置：

```js
// playwright 已装在项目里（devDependency），chromium 内核也在
const { chromium } = require("playwright");
const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await p.evaluate(() =>
  [...document.querySelector(".sidebar").children].map((el) => {
    const r = el.getBoundingClientRect();
    return `${el.className} y=${Math.round(r.y)} h=${Math.round(r.height)}`;
  })
);
```

**已踩过的坑，别重复**：

- `position: absolute` 把一个 flex 项移出文档流 → 空出的空间会被**下一个 flex 项接走**，位置照样跳。要「不占位」就用「不渲染」或固定高度。
- `min-height` 压不住内容撑高（它只是**下限**）。
- 覆盖规则里写 `margin: 0` 会把基类的 **`margin: auto` 一起抹掉**（`margin: 0` 是四值简写）。
- 给人看的位置跳动，**根因常在别处**：侧栏按钮「上下移动」的真因是
  `.nav` 是 `flex: 1`（吃掉剩余空间，所以它的高度取决于兄弟块），
  加上底部块在窄栏里折行从 52px 涨到 272px。
- dev 模式有 Next 开发浮层，Playwright 直接 `click()` 会被它挡住；
  用 `page.evaluate(() => el.click())` 绕过。

## 八、断点

**主断点是 `900px`**（绝大多数响应式规则都在这里），另外 `1080px`、`1180px`、
`860px` 各有零星使用。`1360px` / `1060px` 用于版心宽度上限的判断。

**优先复用这些既有断点。** 需要新断点前先想清楚：
这个项目是单人用的笔记本工具，加 `1440px` 这类大屏断点通常没有意义。

响应式判断看**内容栏还剩多少**，而不是「视口够不够放版心」：
`.content` 的 padding 是 `38px 40px 90px`，侧栏是 fixed 的 68px（展开 200px），
所以内容栏宽度 = 视口 − 68（或 200）− 80。

## 九、写完必须验

```bash
npm run typecheck    # 必须过
npm test             # 104 个单测，全过
npm run build        # 注意：先停 dev server
```

视觉改动**必须实测两种状态**（展开/收起、悬停/不悬停、空/有内容），
不要只截一张图就认为对了——这个项目的位置跳动问题都是"单看一张图没问题"。
