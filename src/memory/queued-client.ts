/**
 * QueuedMemoryClient — memory-service 写操作的离线兜底层。
 *
 * 包装一个 MemoryClient，对三类写方法 (createMemory / batchMessages /
 * createRelation) 加上：
 *   1) 调用前先 flush 队列（best-effort）；
 *   2) 本次调用失败 → enqueue，调用方拿到 ok:false（不抛）。
 *
 * 关键约束：
 *  - 不替代 MemoryClient 类型——QueuedMemoryClient 暴露窄接口，调用方按需引用；
 *  - 读操作（resolveEntity / search 等）不入队，直接透传；失败仍然抛。
 *  - 队列路径默认放在 workspace.memory_dir 下，按 user 隔离。
 */

import path from "node:path";
import type { CallContext, CreateMemoryInput, CreateRelationInput, MemoryClient, MessageItem } from "../../packages/memory-sdk/src/index.js";
import type { WorkspaceContext } from "../runtime/workspace-context.js";
import { OfflineQueue, type OfflineEntry } from "./offline-queue.js";

export interface QueuedClientOptions {
  client: MemoryClient;
  workspace: WorkspaceContext;
  /** 覆盖默认队列文件，主要给 smoke 用。 */
  queueFilePath?: string;
}

export class QueuedMemoryClient {
  private readonly client: MemoryClient;
  readonly queue: OfflineQueue;

  constructor({ client, workspace, queueFilePath }: QueuedClientOptions) {
    this.client = client;
    this.queue = new OfflineQueue({
      filePath: queueFilePath ?? defaultQueuePath(workspace)
    });
  }

  /** 主动触发一次 flush，给 smoke 或 cron 用。 */
  async flush(): Promise<{ replayed: number; remaining: number }> {
    return this.queue.flush((entry) => this.applyEntry(entry));
  }

  async createMemory(ctx: CallContext, input: CreateMemoryInput): Promise<{ ok: true; id: string } | { ok: false; queued: true }> {
    await this.tryDrain();
    try {
      const record = await this.client.createMemory(ctx, input);
      return { ok: true, id: record.id };
    } catch {
      await this.queue.enqueue("createMemory", ctx, input);
      return { ok: false, queued: true };
    }
  }

  async batchMessages(ctx: CallContext, items: MessageItem[]): Promise<{ ok: true; inserted: number } | { ok: false; queued: true }> {
    if (!items.length) return { ok: true, inserted: 0 };
    await this.tryDrain();
    try {
      const res = await this.client.batchMessages(ctx, items);
      return { ok: true, inserted: res.inserted };
    } catch {
      await this.queue.enqueue("batchMessages", ctx, items);
      return { ok: false, queued: true };
    }
  }

  async createRelation(ctx: CallContext, input: CreateRelationInput): Promise<{ ok: true } | { ok: false; queued: true }> {
    await this.tryDrain();
    try {
      await this.client.createRelation(ctx, input);
      return { ok: true };
    } catch {
      await this.queue.enqueue("createRelation", ctx, input);
      return { ok: false, queued: true };
    }
  }

  private async tryDrain(): Promise<void> {
    try {
      await this.queue.flush((entry) => this.applyEntry(entry));
    } catch {
      // flush 自身抛错不影响主路径
    }
  }

  private async applyEntry(entry: OfflineEntry): Promise<void> {
    switch (entry.kind) {
      case "createMemory":
        await this.client.createMemory(entry.ctx, entry.payload as CreateMemoryInput);
        return;
      case "batchMessages":
        await this.client.batchMessages(entry.ctx, entry.payload as MessageItem[]);
        return;
      case "createRelation":
        await this.client.createRelation(entry.ctx, entry.payload as CreateRelationInput);
        return;
    }
  }
}

function defaultQueuePath(workspace: WorkspaceContext): string {
  return path.join(workspace.memory_dir, ".memory-service-queue.jsonl");
}
