/**
 * Item watchdog 的纯逻辑：item start 时启动一个超时计时器，end 时清掉。
 *
 * 这块逻辑同时被 chat-page.ts 的内嵌 JS 用一份手写副本（因为内嵌字符串
 * 没法 import），但本模块是规范定义 + 单元测试入口。两边表达一致即可。
 *
 * 设计要点：
 * - 容忍 "重复 start" / "无 start 直接 end" / "stream 中断" 三种异常顺序
 * - 不依赖 DOM；接受抽象的 setTimeout/clearTimeout，方便测试注入 fake timer
 */

export type ItemStatus = "running" | "completed" | "failed";

export interface ItemPair {
  itemId: string;
  status: ItemStatus;
  errorMessage?: string;
  watchdogTimer?: unknown;
}

export interface WatchdogTimerHost {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(timer: unknown): void;
}

export interface WatchdogStore {
  pairs: ItemPair[];
  byItemId: Record<string, ItemPair>;
}

export function createStore(): WatchdogStore {
  return { pairs: [], byItemId: Object.create(null) };
}

export interface ApplyStartInput {
  itemId: string;
  factory?: () => Partial<ItemPair>;
  watchdogMs: number;
  host: WatchdogTimerHost;
  onTimeout: (pair: ItemPair) => void;
}

export function applyItemStart(store: WatchdogStore, input: ApplyStartInput): ItemPair | null {
  if (store.byItemId[input.itemId]) return null;
  const seed = input.factory ? input.factory() : {};
  const pair: ItemPair = { itemId: input.itemId, status: "running", ...seed };
  pair.watchdogTimer = input.host.setTimeout(() => {
    if (pair.status === "running") {
      pair.status = "failed";
      pair.errorMessage = pair.errorMessage ?? "响应超时（未收到 end 事件）";
      input.onTimeout(pair);
    }
  }, input.watchdogMs);
  store.pairs.push(pair);
  store.byItemId[input.itemId] = pair;
  return pair;
}

export interface ApplyEndInput {
  itemId: string;
  status?: ItemStatus;
  errorMessage?: string;
  host: WatchdogTimerHost;
}

export function applyItemEnd(store: WatchdogStore, input: ApplyEndInput): ItemPair {
  const existing = store.byItemId[input.itemId];
  if (existing) {
    if (existing.watchdogTimer !== undefined) {
      input.host.clearTimeout(existing.watchdogTimer);
      existing.watchdogTimer = undefined;
    }
    existing.status = input.status ?? "completed";
    if (input.errorMessage) existing.errorMessage = input.errorMessage;
    return existing;
  }
  const pair: ItemPair = { itemId: input.itemId, status: input.status ?? "completed" };
  if (input.errorMessage) pair.errorMessage = input.errorMessage;
  store.pairs.push(pair);
  store.byItemId[input.itemId] = pair;
  return pair;
}

/**
 * 流结束/中断时调用：把所有还在 running 的 item 标记为 failed，并清掉计时器。
 */
export function finalizeRunningItems(store: WatchdogStore, reason: string, host: WatchdogTimerHost): number {
  let touched = 0;
  for (const pair of store.pairs) {
    if (pair.status !== "running") continue;
    if (pair.watchdogTimer !== undefined) {
      host.clearTimeout(pair.watchdogTimer);
      pair.watchdogTimer = undefined;
    }
    pair.status = "failed";
    pair.errorMessage = pair.errorMessage ?? reason;
    touched += 1;
  }
  return touched;
}
