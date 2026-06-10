import type { JsonObject } from "../types/agent-contracts.js";

interface CacheEntry {
  result: JsonObject;
  storedAt: number;
}

export class OpenUILangIdempotencyCache {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly maxEntries: number;
  private readonly ttlMs: number;

  constructor(options: { maxEntries?: number; ttlMs?: number } = {}) {
    this.maxEntries = options.maxEntries ?? 1000;
    this.ttlMs = options.ttlMs ?? 60_000;
  }

  get(userId: string, clientActionId: string): JsonObject | null {
    const key = makeKey(userId, clientActionId);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.storedAt > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }
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
