import type { JsonObject } from "../types/agent-contracts.js";

interface CacheEntry {
  result: JsonObject;
  storedAt: number;
}

/**
 * action 幂等缓存：按 (user_id, client_action_id) 去重短时间内的重复请求。
 *
 * 设计：
 * - 内存 LRU + TTL，重启清零（client retry 是秒级，重启清零可接受）
 * - TTL 默认 60s（用户网络抖动重发的窗口够用，不会持续保留无意义状态）
 * - 命中时返回上次结果，让客户端"重复点击"也拿到一致响应
 *
 * 不做：
 * - 跨进程一致性（多机部署需要换 RedisIdempotencyCache，接口同形）
 * - 进行中请求合流（in-flight dedupe）—— 现在简化为：先到先存，第二个直接拒
 */
export class IdempotencyCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(options: { maxEntries?: number; ttlMs?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.ttlMs = options.ttlMs ?? 60_000;
  }

  /** 命中返回上次结果；未命中返回 null */
  get(userId: string, clientActionId: string): JsonObject | null {
    const key = makeKey(userId, clientActionId);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.storedAt > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
    // LRU：访问后移到末尾
    this.cache.delete(key);
    this.cache.set(key, entry);
    return entry.result;
  }

  put(userId: string, clientActionId: string, result: JsonObject): void {
    const key = makeKey(userId, clientActionId);
    if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey !== undefined) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { result, storedAt: Date.now() });
  }

  size(): number {
    return this.cache.size;
  }

  clear(): void {
    this.cache.clear();
  }
}

function makeKey(userId: string, clientActionId: string): string {
  return `${userId}::${clientActionId}`;
}
