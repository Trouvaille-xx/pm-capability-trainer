/**
 * 产品经理能力训练平台 —— 领域模型
 *
 * 四个模块的持久化结构都在这里集中定义，供服务端存储层、
 * API 路由与前端组件共用。
 */

export type ID = string;

/* ------------------------------------------------------------------ *
 * 模块一：记录总结（图书 / 文章 / 笔记思考）
 * ------------------------------------------------------------------ */

export type CaptureKind = "book" | "article" | "note";

export type CaptureStatus = "inbox" | "doing" | "done";

export interface Capture {
  id: ID;
  kind: CaptureKind;
  title: string;
  /** 图书/文章作者 */
  author: string;
  /** 文章链接、图书出版社等信息 */
  source: string;
  status: CaptureStatus;
  tags: string[];
  /** 内容总结 */
  summary: string;
  /** 关键要点 */
  keyPoints: string[];
  /** 笔记思考：我从中想到了什么 */
  thoughts: string;
  /** 1-5 星，0 表示未评分 */
  rating: number;
  /** 关联的方法论领域，用于和方法论库互链 */
  domains: string[];
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ *
 * 模块二：方法论 / 知识点学习
 * ------------------------------------------------------------------ */

export interface MethodologyCard {
  id: ID;
  /** 心理学 / 经济学 / 商业与战略 …… 见 catalog.ts 的 DOMAINS */
  domain: string;
  title: string;
  /** 一句话定义 */
  oneLiner: string;
  /** 展开说明：原理 */
  detail: string;
  /**
   * 边界：这个原理在什么条件下不成立 / 会减弱。
   *
   * 以前和「常见误区」一起被写在 detail 的文字里（「…。边界：…。常见误区：…」），
   * 读起来是一坨连续段落，翻回去找边界很费劲。拆成独立字段后各成一节。
   */
  boundary: string;
  /** 常见误区：最容易用错的地方 */
  pitfalls: string;
  /** 在产品工作里怎么用 */
  howToUse: string;
  /** 具体例子 */
  example: string;
  /** 这张卡适合在哪些训练场景里用 */
  scenarios: TrainingScenario[];
  /** 来源：关联的记录总结 */
  sourceCaptureIds: ID[];
  /**
   * 来源的文字补充（书名、文章链接、谁说的）。
   *
   * 为什么不只用 sourceCaptureIds：那是指向本平台「记录总结」的引用，
   * 而知识点的来源常常在站外（一本书、一篇文章）。两者都要能表达。
   */
  sourceNote: string;
  builtin: boolean;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ *
 * 模块三：AI 训练师
 * ------------------------------------------------------------------ */

export type TrainingScenario =
  | "product-teardown"
  | "requirement-research"
  | "process-design";

/**
 * 场景的分步流程。
 *
 * 有些场景是有固定推进顺序的（比如产品拆解要走 8 步），
 * 训练时需要知道「现在在第几步」「这一步该交付什么」。
 * 没有分步流程的场景可以不定义。
 */
export interface ScenarioStep {
  /** 从 1 开始的步号，用于提示词里的 {current_step} */
  id: number;
  name: string;
  /** 这一步完成后用户应该交出什么 */
  deliverable: string;
  /** 引导用户去哪里获取信息 */
  whereToGet: string;
}

/**
 * 场景的评分表。
 *
 * 不同场景的评分口径不一样：产品拆解是 10 个维度各 5 分（总分 50），
 * 其它场景用百分制。把评分表放到场景定义里，报告生成时注入提示词，
 * 这样模型必须按这张表打分，不会自创维度。
 */
export interface ScenarioRubricItem {
  dimension: string;
  /** 该维度满分 */
  max: number;
  /** 评分标准说明 */
  criteria: string;
}

export type TrainingMode =
  /** AI 助教引导：给框架、做示范、带你走完 */
  | "assistant"
  /** AI Grill：高强度质询，专挑漏洞 */
  | "grill"
  /** 苏格拉底追问：只提问不给答案 */
  | "socratic"
  /** 完全独立训练：0 AI 介入，事后批改 */
  | "solo";

export interface TranscriptEntry {
  role: "user" | "assistant";
  content: string;
  at: string;
  /** 这一轮里 AI 调用过的工具（联网搜索 / MCP），用于在界面上展示「查了什么」 */
  tools?: ToolTrace[];
}

/**
 * 一次工具调用的记录。
 * 训练是「过程导向」的，所以 AI 查了什么、查到几条，值得留在对话里。
 */
export interface ToolTrace {
  /** 工具名，如 web_search 或 mcp__github__search_repos */
  name: string;
  /** 展示用简述：搜索词、或 MCP 工具的入参摘要 */
  detail: string;
  /** 结果摘要：命中条数或前几条标题 */
  result: string;
  ok: boolean;
}

export interface ReportScore {
  /** 评分维度名，必须来自场景的评分表 */
  dimension: string;
  score: number;
  /** 该维度满分。产品拆解是 5，其它场景是 100 */
  max: number;
  comment: string;
}

export interface TrainingReport {
  /** 总体评价 */
  summary: string;
  /** 总分（各维度之和） */
  overall: number;
  /** 总分满分。产品拆解是 50，其它场景是 100 */
  overallMax: number;
  /** 等级：优秀 / 良好 / 及格 / 需要重新拆解 */
  grade: string;
  scores: ReportScore[];
  /** 做得好的地方 */
  strengths: string[];
  /** 待改进的地方 */
  improvements: string[];
  /** 可执行的建议 */
  suggestions: string[];
  /** 下一步练什么 */
  nextSteps: string[];
  /** 用户给这份报告打的标签，便于日后检索 */
  tags?: string[];
  generatedAt: string;
}

export interface TrainingSession {
  id: ID;
  scenario: TrainingScenario;
  mode: TrainingMode;
  /** 本次训练的题目 / 拆解对象 */
  topic: string;
  status: "active" | "completed";
  transcript: TranscriptEntry[];
  /** 完全独立训练模式下的作答 */
  submission: string;
  report?: TrainingReport;
  /* ---- 与「记录总结」「方法论」的联动 ---- */
  /**
   * 本次训练基于哪条记录总结展开。
   * 有了它，「读书 → 训练」才真正接上：训练时会把这
   * 条记录的总结与要点注入提示词作为素材。
   */
  captureId?: ID;
  /** 本次训练显式指定的方法论卡片，会作为「可用方法论」注入提示词 */
  methodologyCardIds?: ID[];
  /** 这次训练是从哪次训练的报告建议里开出来的（血缘） */
  retryOf?: ID;
  /* ---- 分步场景（如产品拆解）用到的字段 ---- */
  /** 产品类型：C端 / B端 / AI功能 / 完整产品 */
  productType?: string;
  /** 这次拆解是为了达成什么 */
  analysisGoal?: string;
  /** 当前进行到第几步（从 1 开始）。无分步流程的场景为 0 */
  currentStep?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * 训练列表用的轻量投影。
 *
 * 列表页只需要题目、场景、分数这些摘要，不需要整份 transcript。
 * 会话多了之后按完整对象拉列表会很沉，所以列表走 ?view=list。
 */
export type TrainingSessionListItem = Omit<
  TrainingSession,
  "transcript" | "submission"
> & {
  /** 已发生的对话轮数 */
  turnCount: number;
  /** 独立作答的字数 */
  submissionLength: number;
};

/* ------------------------------------------------------------------ *
 * 模块四：辅助系统
 * ------------------------------------------------------------------ */

export type WebSearchProvider =
  /** 抓 cn.bing.com 的结果页；国内可直连，无需密钥 */
  | "bing"
  /** 无需密钥，但国内多数网络不可达 */
  | "duckduckgo"
  /** 统一检索网关，匿名即可用（按 IP 限流 + 每日免费额度），填 Key 额度更高 */
  | "anysearch"
  | "tavily"
  | "serper"
  | "brave";

export interface WebSearchSettings {
  enabled: boolean;
  provider: WebSearchProvider;
  apiKey: string;
  /** 每次搜索取几条结果 */
  maxResults: number;
}

/**
 * MCP 服务器配置。
 *
 * 只支持 Streamable HTTP 传输：本地 stdio 服务器需要 spawn 子进程，
 * 在一个 Next.js 服务里托管生命周期和权限都太脆，所以先不做。
 */
export interface MCPServer {
  id: ID;
  name: string;
  /** MCP 端点，例如 https://mcp.example.com/mcp */
  url: string;
  /** 作为 Authorization: Bearer 发送，留空则不带 */
  token: string;
  enabled: boolean;
}

export interface AISettings {
  /** OpenAI 兼容端点，例如 https://api.openai.com/v1 */
  baseURL: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  /**
   * 训练师自称的公司名。
   * 提示词里的 {company_name} 会替换成它，例如
   * 「你是 XX 公司的 AI 产品经理训练师」。
   */
  companyName: string;
  /** 联网搜索：让 AI 能基于训练题目和对话去查外部资料 */
  webSearch: WebSearchSettings;
  /** 已配置的 MCP 服务器 */
  mcpServers: MCPServer[];
}

/* ------------------------------------------------------------------ *
 * 对外投影：回给浏览器的设置绝不能带密钥明文
 *
 * 前端只需要知道「配没配」（用来做空态拦截与占位提示），
 * 不需要、也不应该拿到密钥本身。写入仍然走完整字段。
 * ------------------------------------------------------------------ */

export type PublicWebSearchSettings = Omit<WebSearchSettings, "apiKey"> & {
  /** 是否已配置密钥（不回传密钥本身） */
  hasKey: boolean;
};

export type PublicMCPServer = Omit<MCPServer, "token"> & {
  /** 是否已配置访问令牌（不回传令牌本身） */
  hasToken: boolean;
};

export type PublicAISettings = Omit<
  AISettings,
  "apiKey" | "webSearch" | "mcpServers"
> & {
  /** 是否已配置模型密钥（不回传密钥本身） */
  apiKeySet: boolean;
  webSearch: PublicWebSearchSettings;
  mcpServers: PublicMCPServer[];
};

/** 题库模块的 AI 操作，各有自己的系统提示词。 */
export type QuestionPromptScope =
  | "question-classify"
  | "question-answer"
  | "question-readings"
  | "question-review";

/**
 * 方法论模块的 AI 操作。
 *
 * 拆成两条是因为它们要做的事正好相反：一条只提问、不生成（澄清），
 * 一条只补空字段、不提问（补全）。合成一条会让「这一轮该不该输出内容」
 * 变成要靠上下文猜的事，模型很容易在第一轮就把答案写出来。
 */
export type MethodologyPromptScope =
  | "methodology-clarify"
  | "methodology-generate";

/** 提示词服务于哪个功能模块。列表的第一层分组。 */
export type PromptModule = "训练师" | "题库" | "方法论" | "报告";

/**
 * 提示词的作用域。
 *
 * 训练时的系统提示词由「场景块 + 模式块 + 通用约束」拼装而成，三者都能单独调整，
 * 所以用户可以把「AI Grill 的质询强度」和「产品拆解的框架」分开改。
 *
 * 题库 / 方法论 / 报告是各自独立的一次调用，不参与拼装，一个 scope 对应一处调用。
 * 它们出现在这里，是为了让「AI 在哪里被用到」和「提示词在哪里能改」是同一张表 ——
 * 而不是一半能在界面上改、一半埋在代码里。
 */
export type PromptScope =
  | TrainingScenario
  | TrainingMode
  | QuestionPromptScope
  | MethodologyPromptScope
  | "report"
  | "chat";

export interface PromptTemplate {
  id: ID;
  name: string;
  scope: PromptScope;
  /** 仅当 scope 为训练场景且需要区分模式时使用 */
  mode?: TrainingMode;
  system: string;
  enabled: boolean;
  builtin: boolean;
  /**
   * 播种/上次升级时，内置文案的内容指纹。
   *
   * 用来区分「用户没动过的内置模板」和「用户改过的」：只有前者
   * 才允许被新版内置文案覆盖。不存历史全文，一个短指纹就够 ——
   * 只要和当前种子不一致，就说明这中间有人改过（用户改的，或旧版种子）。
   */
  seedHash?: string;
  createdAt: string;
  updatedAt: string;
}

/* ------------------------------------------------------------------ *
 * 模块五：题库
 *
 * 面试真题 / 别人的提问 / 自己想的问题。核心不是「记录」，
 * 而是「先自己答一遍，再看 AI 怎么答，然后比差在哪」。
 * 所以我的回答和 AI 回答是两个平级的主角，其余三块是配角。
 * ------------------------------------------------------------------ */

export type QuestionKind = "interview" | "thinking" | "other";

export type QuestionStatus = "open" | "answered" | "archived";

/** 「相关知识」里的一条。 */
export interface RelatedConcept {
  /** 概念名，通常能在方法论库里找到同名卡片 */
  term: string;
  /** 一句话解释：它跟这道题的关系 */
  gloss: string;
  /** 关联到的方法论卡片 id（AI 归类时自动匹配，可能为空） */
  cardId?: ID;
}

/** 「推荐阅读」里的一条。 */
export interface ReadingItem {
  title: string;
  /** 来源：站点、书名、作者 */
  source: string;
  url: string;
  /** 为什么推荐它 —— 把搜索结果变成「针对这道题的建议」 */
  why: string;
}

/**
 * 「我的回答」的评分。
 *
 * 四个维度固定，各 25 分，总分 100 —— 固定而不是让 AI 自创，
 * 是为了让不同题目之间可比：只有维度一样，概览页才能把它们放在一起看趋势。
 * 和训练报告（TrainingReport）是两套东西：那个评「一次训练过程」，
 * 这个只评「一道题的作答」，所以结构更轻。
 */
export interface AnswerReview {
  /** 四维度得分 */
  scores: { dimension: string; score: number; max: number; comment: string }[];
  /** 总分（各维度之和，满分 100） */
  overall: number;
  /** 两三句总评：先说做成了什么，再点最关键的问题 */
  summary: string;
  /** 具体怎么改，2-4 条，每条要能立刻上手 */
  suggestions: string[];
  /** 评分用的模型与时间，用来判断这条评分是不是过时了 */
  at: string;
}

export interface Question {
  id: ID;
  /** 题目本身 */
  prompt: string;
  /** 分类。默认由 AI 归类，也可手动改 */
  kind: QuestionKind;
  status: QuestionStatus;
  /** 出处：公司名 / 面试官 / 「自己想的」 */
  source: string;
  /** AI 归类出的领域，取自 catalog 的 DOMAINS */
  domains: string[];
  tags: string[];

  /** 块二：我的回答 */
  myAnswer: string;
  myAnsweredAt: string;

  /** 块三：AI 回答 */
  aiAnswer: string;
  aiAnsweredAt: string;
  /** AI 回答是否正在生成 —— 跨刷新保留，避免关掉页面丢掉进度 */
  aiGenerating?: boolean;

  /** 块四：相关知识 */
  related: RelatedConcept[];

  /** 块五：推荐阅读 */
  readings: ReadingItem[];

  /** 我对这道题的作答的评分（基于 myAnswer 生成，可反复重评） */
  review?: AnswerReview;

  /** AI 归类/生成失败时的原因，用来在页面上如实说明 */
  lastError?: string;

  createdAt: string;
  updatedAt: string;
}
