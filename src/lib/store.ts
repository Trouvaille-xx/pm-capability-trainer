/**
 * 本地 JSON 文件存储。
 *
 * 单人本地应用，数据量很小，所以用「一个集合一个 JSON 文件」而不是数据库：
 * 零原生依赖、可直接打开查看、便于备份。所有写入都是「写临时文件再重命名」，
 * 避免进程中断留下半个文件。
 *
 * 同一集合的读改写用一个 promise 链串行化，防止并发请求互相覆盖。
 */

import { promises as fs } from "node:fs";
import path from "node:path";

import { newId, nowIso } from "./ids";
import type {
  AISettings,
  Capture,
  MethodologyCard,
  PromptTemplate,
  Question,
  TrainingSession,
} from "./types";
import { LEGACY_SEED_HASHES } from "./seed-history";
import { seedHashOf, seedMethodology, seedPrompts } from "./seed";

/** 数据目录；可用 PM_TRAINER_DATA_DIR 覆盖（测试或放到网盘时有用）。 */
export const DATA_DIR =
  process.env.PM_TRAINER_DATA_DIR ?? path.join(process.cwd(), "data");

export type CollectionName =
  | "captures"
  | "methodology"
  | "sessions"
  | "prompts"
  | "questions";

/* ------------------------------------------------------------------ *
 * 基础读写
 * ------------------------------------------------------------------ */

const locks = new Map<string, Promise<unknown>>();

/** 把同一 key 上的操作串成一条链，保证读改写不交错。 */
function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(fn, fn);
  locks.set(
    key,
    run.catch(() => undefined),
  );
  return run;
}

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function collectionPath(name: CollectionName): string {
  return path.join(DATA_DIR, `${name}.json`);
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  const value = await readJsonFileOrNull<T>(file);
  return value === null ? fallback : value;
}

/**
 * 读文件；文件不存在（ENOENT）或内容为空时返回 null。
 *
 * 与 readJsonFile 分开是为了让 readCollection 能区分「文件不存在」
 * 与「文件存在但是空数组」——前者该播种，后者是用户自己的选择。
 */
async function readJsonFileOrNull<T>(file: string): Promise<T | null> {
  try {
    const raw = await fs.readFile(file, "utf8");
    if (raw.trim() === "") return null;
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    if (error instanceof SyntaxError) {
      throw new Error(
        `数据文件 ${file} 不是合法 JSON，请修复或删除后重试：${error.message}`,
      );
    }
    throw error;
  }
}

async function writeJsonFile(file: string, value: unknown): Promise<void> {
  await ensureDataDir();
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await fs.rename(tmp, file);
}

/** 重新导出，便于路由层统一从 store 引入。 */
export { newId, nowIso };

/* ------------------------------------------------------------------ *
 * 集合访问
 * ------------------------------------------------------------------ */

interface HasId {
  id: string;
}

/**
 * 读取一个集合。
 *
 * 只在**文件还不存在**时才写入内置种子数据（提示词模板、方法论卡片），
 * 让平台一打开就有东西可用。注意不是「读到空数组就播种」——那样用户
 * 主动清空某个集合后，下次读取会被悄悄塞回内置内容，等于删不掉。
 */
export async function readCollection<K extends CollectionName>(
  name: K,
): Promise<CollectionType<K>[]> {
  return withLock(name, async () => {
    const existing = await readJsonFileOrNull<CollectionType<K>[]>(
      collectionPath(name),
    );
    if (existing === null) {
      const seeded = seedFor(name);
      if (seeded.length > 0) {
        await writeJsonFile(collectionPath(name), seeded);
        return seeded as CollectionType<K>[];
      }
      return [];
    }

    /* 已有文件：补齐「种子里有、文件里没有、而且从没出现过」的内置模板。
       为什么要这一步：新增内置提示词（比如题库那三条）时，老用户的
       data/prompts.json 里没有它们，界面上就永远看不见、也改不了。
       为什么不是简单补缺：用户可能**故意删掉**某个内置模板，直接补回来
       等于删不掉。所以删内置模板时会往 prompts-retired.json 记一笔，
       这里跳过所有被记过的 scope。

       注意 existing 为空数组时**直接放行**：空文件是用户主动清空的结果
       （见上面「删不掉的集合」那条约定），不是「缺了几条」，
       这时候补任何东西都是把删掉的东西塞回来。 */
    if (name === "prompts" && (existing as unknown[]).length > 0) {
      const backfilled = await backfillPrompts(
        existing as unknown as PromptTemplate[],
      );
      return backfilled as unknown as CollectionType<K>[];
    }

    return existing;
  });
}

/** 记录「被主动删掉的内置 scope」，免得补缺时把它们又塞回来。 */
function retiredPath(): string {
  return path.join(DATA_DIR, "prompts-retired.json");
}

async function readRetiredScopes(): Promise<string[]> {
  const value = await readJsonFileOrNull<string[]>(retiredPath());
  return Array.isArray(value) ? value : [];
}

/**
 * 把一个内置提示词的 scope 标记为「用户已删除」。
 * 由 DELETE /api/prompts/[id] 在删掉内置模板时调用。
 */
export async function retirePromptScope(scope: string): Promise<void> {
  await withLock("prompts", async () => {
    const current = await readRetiredScopes();
    if (current.includes(scope)) return;
    await writeJsonFile(retiredPath(), [...current, scope]);
  });
}

/**
 * 同步内置提示词：补齐缺的、升级「没被改过」的。
 *
 * 三件事，按优先级：
 *   1. 缺的 scope → 补上（新加的内置提示词，老用户看不到）
 *   2. 已退休的 scope → 跳过（用户主动删过，不能又塞回来）
 *   3. 内容停在历史版本的内置 → 升级成当前种子文案
 *
 * 第 3 条的判断是难点：记录的指纹和当前种子不同，可能是「旧版内置」
 * 也可能是「用户改过」，光看内容分不出来。所以维护了一份历史指纹清单
 * （见 seed-history.ts）：
 *   - 指纹在清单里 → 是历史版本的内置文案 → 升级
 *   - 指纹不在清单里 → 中间有人改过 → 保留
 *   - 还没有指纹字段（很老的数据）→ 视为没改过 → 升级
 *
 * 判断失败的代价是不对称的：漏升级只是模板停在旧版，误升级才会覆盖
 * 用户的编辑。所以清单宁可少记、不可多记。
 */
async function backfillPrompts(
  existing: PromptTemplate[],
): Promise<PromptTemplate[]> {
  const retired = new Set(await readRetiredScopes());
  const seeds = seedPrompts();
  const seedByScope = new Map(seeds.map((s) => [s.scope as string, s]));
  const present = new Set(existing.map((t) => t.scope as string));

  let changed = false;

  const synced = existing.map((t) => {
    const seed = seedByScope.get(t.scope);
    if (!seed || !t.builtin) return t;

    const currentHash = seedHashOf(seed.system);
    // 已经是当前版本 → 不用动
    if (t.seedHash === currentHash) return t;

    /* 有指纹、但对不上当前种子：只有指纹被记进历史清单时，
       才认定这是「没改过的旧版内置」。其余一律当用户改过，保留。 */
    if (t.seedHash !== undefined) {
      const legacy = LEGACY_SEED_HASHES[t.scope as string] ?? [];
      if (!legacy.includes(t.seedHash)) return t;
    }

    changed = true;
    return {
      ...t,
      name: seed.name,
      system: seed.system,
      seedHash: currentHash,
      // 升级是内容变更，更新时间要跟着走 —— 界面上靠它判断新旧
      updatedAt: new Date().toISOString(),
    };
  });

  const missing = seeds.filter(
    (s) => !present.has(s.scope as string) && !retired.has(s.scope as string),
  );
  if (missing.length > 0) changed = true;

  const next = [...synced, ...missing];
  if (changed) await writeJsonFile(collectionPath("prompts"), next);
  return changed ? next : existing;
}

/** 整体覆盖一个集合。 */
export async function writeCollection<K extends CollectionName>(
  name: K,
  items: CollectionType<K>[],
): Promise<void> {
  await withLock(name, () => writeJsonFile(collectionPath(name), items));
}

/** 新增或按 id 覆盖一条记录。 */
export async function upsert<K extends CollectionName>(
  name: K,
  item: CollectionType<K>,
): Promise<CollectionType<K>> {
  return withLock(name, async () => {
    const items = await readJsonFile<CollectionType<K>[]>(
      collectionPath(name),
      [],
    );
    const index = items.findIndex((entry) => entry.id === item.id);
    if (index >= 0) items[index] = item;
    else items.unshift(item);
    await writeJsonFile(collectionPath(name), items);
    return item;
  });
}

/** 按 id 局部更新；记录不存在时返回 null。 */
export async function patch<K extends CollectionName>(
  name: K,
  id: string,
  changes: Partial<CollectionType<K>>,
): Promise<CollectionType<K> | null> {
  return withLock(name, async () => {
    const items = await readJsonFile<CollectionType<K>[]>(
      collectionPath(name),
      [],
    );
    const index = items.findIndex((entry) => entry.id === id);
    if (index < 0) return null;
    const updated = { ...items[index], ...changes } as CollectionType<K>;
    items[index] = updated;
    await writeJsonFile(collectionPath(name), items);
    return updated;
  });
}

/**
 * 按 id 做「锁内读改写」。
 *
 * patch 只适合无竞态的局部更新。凡是「先读出来看一眼、再决定写什么」的逻辑
 * （例如往 transcript 追加一轮回答），都必须在同一把锁里完成，
 * 否则两个并发请求会各自基于同一份旧快照写回，后写的把先写的覆盖掉。
 *
 * updater 返回 null 表示放弃写入（例如记录已不存在、或校验没通过）。
 */
export async function mutate<K extends CollectionName>(
  name: K,
  id: string,
  updater: (current: CollectionType<K>) => CollectionType<K> | null,
): Promise<CollectionType<K> | null> {
  return withLock(name, async () => {
    const items = await readJsonFile<CollectionType<K>[]>(
      collectionPath(name),
      [],
    );
    const index = items.findIndex((entry) => entry.id === id);
    if (index < 0) return null;

    const next = updater(items[index]);
    if (next === null) return null;

    items[index] = next;
    await writeJsonFile(collectionPath(name), items);
    return next;
  });
}

/** 按 id 删除；返回是否真的删掉了。 */
export async function remove<K extends CollectionName>(
  name: K,
  id: string,
): Promise<boolean> {
  return withLock(name, async () => {
    const items = await readJsonFile<CollectionType<K>[]>(
      collectionPath(name),
      [],
    );
    const next = items.filter((entry) => entry.id !== id);
    if (next.length === items.length) return false;
    await writeJsonFile(collectionPath(name), next);
    return true;
  });
}

export async function findById<K extends CollectionName>(
  name: K,
  id: string,
): Promise<CollectionType<K> | null> {
  const items = await readCollection(name);
  return items.find((entry) => entry.id === id) ?? null;
}

/* ------------------------------------------------------------------ *
 * 单例对象：AI 配置
 * ------------------------------------------------------------------ */

const SETTINGS_FILE = () => path.join(DATA_DIR, "settings.json");

export const DEFAULT_AI_SETTINGS: AISettings = {
  baseURL: "https://api.openai.com/v1",
  apiKey: "",
  model: "gpt-4o-mini",
  temperature: 0.6,
  maxTokens: 4096,
  companyName: "",
  webSearch: {
    enabled: false,
    provider: "bing",
    apiKey: "",
    maxResults: 5,
  },
  mcpServers: [],
};

/**
 * 把落盘的（可能缺字段、可能是旧版本写的）设置补齐成完整形状。
 *
 * 逐层合并而不是 `{...defaults, ...stored}`：后者对嵌套对象是整体替换，
 * 于是「新版本给 webSearch 加了字段」时，老用户的 settings.json 里没有那一层，
 * 新字段就永远补不上。数组（mcpServers）整体替换才是对的，不做深合并。
 */
function normalizeSettings(stored: Partial<AISettings>): AISettings {
  const servers = Array.isArray(stored.mcpServers) ? stored.mcpServers : [];
  return {
    ...DEFAULT_AI_SETTINGS,
    ...stored,
    webSearch: {
      ...DEFAULT_AI_SETTINGS.webSearch,
      ...(stored.webSearch ?? {}),
    },
    mcpServers: servers.map((server) => ({
      id: String(server.id ?? ""),
      name: String(server.name ?? ""),
      url: String(server.url ?? ""),
      token: String(server.token ?? ""),
      enabled: server.enabled !== false,
    })),
  };
}

export async function readSettings(): Promise<AISettings> {
  return withLock("settings", async () => {
    const stored = await readJsonFile<Partial<AISettings>>(
      SETTINGS_FILE(),
      {},
    );
    return normalizeSettings(stored);
  });
}

export async function writeSettings(
  changes: Partial<AISettings>,
): Promise<AISettings> {
  return withLock("settings", async () => {
    const stored = await readJsonFile<Partial<AISettings>>(
      SETTINGS_FILE(),
      {},
    );
    const next = normalizeSettings({ ...stored, ...changes });
    await writeJsonFile(SETTINGS_FILE(), next);
    return next;
  });
}

/* ------------------------------------------------------------------ *
 * 集合名到元素类型的映射
 * ------------------------------------------------------------------ */

interface CollectionMap {
  captures: Capture;
  methodology: MethodologyCard;
  sessions: TrainingSession;
  prompts: PromptTemplate;
  questions: Question;
}

type CollectionType<K extends CollectionName> = CollectionMap[K];

function seedFor(name: CollectionName): HasId[] {
  switch (name) {
    case "prompts":
      return seedPrompts();
    case "methodology":
      return seedMethodology();
    default:
      return [];
  }
}

/** 首次运行时把种子数据落盘，供设置页展示。 */
export async function ensureSeeded(): Promise<void> {
  await readCollection("prompts");
  await readCollection("methodology");
}
