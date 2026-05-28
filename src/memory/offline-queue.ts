/**
 * Memory-service 离线队列。
 *
 * 当 memory-service 暂时不可用（HTTP 错误、超时、网络断开）时，把写操作
 * 序列化成 JSONL 写到磁盘，下次成功调用前先回放队列。
 *
 * 队列文件每行一条 entry：
 *   { kind: "createMemory" | "batchMessages" | "createRelation", ctx, payload, queued_at }
 *
 * 队列文件路径：默认 <project>/users/<safe_user>/workspace/memory/.memory-service-queue.jsonl
 * 也可在构造时传 filePath 覆盖（给 smoke 用）。
 *
 * 设计权衡：
 *  - 队列只记录"写"操作，不重放查询；
 *  - replay 时按时间顺序串行执行，单条失败即停止本次 flush，剩余条目保留下次重试；
 *  - 单文件 + append 写，无锁。多进程风险忽略——这是单用户单进程 agent 的兜底。
 *  - entry 数量有上限（默认 1000），溢出后丢最早一条。
 */

import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CallContext } from "../../packages/memory-sdk/src/index.js";

export type OfflineEntryKind = "createMemory" | "batchMessages" | "createRelation";

export interface OfflineEntry {
  kind: OfflineEntryKind;
  ctx: CallContext;
  payload: unknown;
  queued_at: string;
}

export interface OfflineQueueOptions {
  filePath: string;
  maxEntries?: number;
}

const DEFAULT_MAX = 1000;

export class OfflineQueue {
  private readonly filePath: string;
  private readonly maxEntries: number;

  constructor({ filePath, maxEntries }: OfflineQueueOptions) {
    this.filePath = filePath;
    this.maxEntries = maxEntries ?? DEFAULT_MAX;
  }

  async enqueue(kind: OfflineEntryKind, ctx: CallContext, payload: unknown): Promise<void> {
    const entry: OfflineEntry = { kind, ctx, payload, queued_at: new Date().toISOString() };
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, JSON.stringify(entry) + "\n", "utf8");
    await this.trimIfNeeded();
  }

  async size(): Promise<number> {
    if (!existsSync(this.filePath)) return 0;
    const lines = (await readFile(this.filePath, "utf8")).split("\n").filter(Boolean);
    return lines.length;
  }

  async drain(): Promise<OfflineEntry[]> {
    if (!existsSync(this.filePath)) return [];
    const raw = await readFile(this.filePath, "utf8");
    return raw.split("\n").filter(Boolean).map((line) => {
      try {
        return JSON.parse(line) as OfflineEntry;
      } catch {
        return null;
      }
    }).filter((e): e is OfflineEntry => e !== null);
  }

  /**
   * 按顺序回放队列，apply 每条 entry。第一次失败即停止：
   *   - 失败的那条 + 后续未处理条目重新写回队列；
   *   - 成功条目从队列中删除。
   * 返回 { replayed, remaining }.
   */
  async flush(apply: (entry: OfflineEntry) => Promise<void>): Promise<{ replayed: number; remaining: number }> {
    const entries = await this.drain();
    if (!entries.length) return { replayed: 0, remaining: 0 };

    let replayed = 0;
    let cursor = 0;
    for (; cursor < entries.length; cursor++) {
      try {
        await apply(entries[cursor]);
        replayed += 1;
      } catch {
        break;
      }
    }

    const remaining = entries.slice(cursor);
    await this.rewrite(remaining);
    return { replayed, remaining: remaining.length };
  }

  async clear(): Promise<void> {
    if (existsSync(this.filePath)) await rm(this.filePath);
  }

  private async rewrite(entries: OfflineEntry[]): Promise<void> {
    if (!entries.length) {
      await this.clear();
      return;
    }
    const tmp = `${this.filePath}.tmp`;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(tmp, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf8");
    await rename(tmp, this.filePath);
  }

  private async trimIfNeeded(): Promise<void> {
    const entries = await this.drain();
    if (entries.length <= this.maxEntries) return;
    await this.rewrite(entries.slice(entries.length - this.maxEntries));
  }
}
