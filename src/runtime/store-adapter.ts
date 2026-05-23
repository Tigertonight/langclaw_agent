import { mkdir, readFile, rmdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * JsonFileStore 抽象的目的：把"读 → 改 → 写回"这一段串行化，
 * 防止同进程多个 await 并发或同主机多个进程同时写同一文件造成丢数据。
 *
 * 接口刻意做小：只暴露 read 和 mutate 两个原语。
 * 业务 store 仍然各自管自己的目录布局和文件名规则。
 *
 * 多机部署时，把 FileJsonStore 换成 RedisJsonStore / PostgresJsonStore 即可，
 * 业务代码不改。
 */
export interface JsonFileStore {
  read<T>(filePath: string, defaultValue: T): Promise<T>;
  mutate<T>(filePath: string, defaultValue: T, mutator: (value: T) => T | Promise<T>): Promise<T>;
}

interface FileJsonStoreOptions {
  lockTimeoutMs?: number;
  lockRetryMinMs?: number;
  lockRetryMaxMs?: number;
}

export class FileJsonStore implements JsonFileStore {
  private readonly lockTimeoutMs: number;
  private readonly lockRetryMinMs: number;
  private readonly lockRetryMaxMs: number;
  private readonly inProcessQueue = new Map<string, Promise<unknown>>();

  constructor(options: FileJsonStoreOptions = {}) {
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
    this.lockRetryMinMs = options.lockRetryMinMs ?? 5;
    this.lockRetryMaxMs = options.lockRetryMaxMs ?? 200;
  }

  async read<T>(filePath: string, defaultValue: T): Promise<T> {
    if (!existsSync(filePath)) return defaultValue;
    try {
      const raw = await readFile(filePath, "utf8");
      if (!raw.trim()) return defaultValue;
      return JSON.parse(raw) as T;
    } catch {
      return defaultValue;
    }
  }

  async mutate<T>(filePath: string, defaultValue: T, mutator: (value: T) => T | Promise<T>): Promise<T> {
    const previous = this.inProcessQueue.get(filePath) ?? Promise.resolve();
    const next = previous.then(() => this.mutateLocked(filePath, defaultValue, mutator));
    this.inProcessQueue.set(filePath, next.catch(() => undefined));
    try {
      return await next;
    } finally {
      if (this.inProcessQueue.get(filePath) === next.catch(() => undefined)) {
        this.inProcessQueue.delete(filePath);
      }
    }
  }

  private async mutateLocked<T>(filePath: string, defaultValue: T, mutator: (value: T) => T | Promise<T>): Promise<T> {
    await mkdir(path.dirname(filePath), { recursive: true });
    const lockPath = `${filePath}.lock`;
    await acquireLock(lockPath, this.lockTimeoutMs, this.lockRetryMinMs, this.lockRetryMaxMs);
    try {
      const current = await this.read(filePath, defaultValue);
      const updated = await mutator(current);
      await writeFile(filePath, JSON.stringify(updated, null, 2), "utf8");
      return updated;
    } finally {
      await releaseLock(lockPath);
    }
  }
}

async function acquireLock(lockPath: string, timeoutMs: number, retryMinMs: number, retryMaxMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  while (true) {
    try {
      await mkdir(lockPath); // 原子性：成功即拿到锁
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "EEXIST") throw error;
      // 检查 stale lock：超过 timeout 视为残留
      try {
        const { stat } = await import("node:fs/promises");
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > timeoutMs * 2) {
          await rmdir(lockPath).catch(() => undefined);
          continue;
        }
      } catch { /* ignore stat race */ }
      if (Date.now() >= deadline) {
        throw new Error(`acquire lock timeout: ${lockPath}`);
      }
      const delay = Math.min(retryMaxMs, retryMinMs * Math.pow(2, attempt++));
      await new Promise((resolve) => setTimeout(resolve, delay + Math.random() * retryMinMs));
    }
  }
}

async function releaseLock(lockPath: string): Promise<void> {
  await rmdir(lockPath).catch(() => undefined);
}

let defaultStore: JsonFileStore | null = null;

export function defaultJsonFileStore(): JsonFileStore {
  if (!defaultStore) defaultStore = new FileJsonStore();
  return defaultStore;
}
