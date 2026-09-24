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
  TrainingSession,
} from "./types";
import { seedMethodology, seedPrompts } from "./seed";

/** 数据目录；可用 PM_TRAINER_DATA_DIR 覆盖（测试或放到网盘时有用）。 */
export const DATA_DIR =
  process.env.PM_TRAINER_DATA_DIR ?? path.join(process.cwd(), "data");

export type CollectionName =
  | "captures"
  | "methodology"
  | "sessions"
  | "prompts";

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
  try {
    const raw = await fs.readFile(file, "utf8");
    if (raw.trim() === "") return fallback;
    return JSON.parse(raw) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
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
 * 读取一个集合。首次访问时会写入内置种子数据（提示词模板、方法论卡片），
 * 让平台一打开就有东西可用。
 */
export async function readCollection<K extends CollectionName>(
  name: K,
): Promise<CollectionType<K>[]> {
  return withLock(name, async () => {
    const items = await readJsonFile<CollectionType<K>[]>(
      collectionPath(name),
      [],
    );
    if (items.length > 0) return items;
    const seeded = seedFor(name);
    if (seeded.length > 0) {
      await writeJsonFile(collectionPath(name), seeded);
      return seeded as CollectionType<K>[];
    }
    return items;
  });
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

export async function readSettings(): Promise<AISettings> {
  return withLock("settings", async () => {
    const stored = await readJsonFile<Partial<AISettings>>(
      SETTINGS_FILE(),
      {},
    );
    return { ...DEFAULT_AI_SETTINGS, ...stored };
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
    const next: AISettings = { ...DEFAULT_AI_SETTINGS, ...stored, ...changes };
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
