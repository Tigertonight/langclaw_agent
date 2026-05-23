import { applyItemEnd, applyItemStart, createStore, finalizeRunningItems, type WatchdogTimerHost } from "../server/item-watchdog.js";

/**
 * 验证 item watchdog（前端纯逻辑）：
 *   1. start 后超时未收到 end → 标记 failed，触发 onTimeout
 *   2. start 后正常 end → watchdog 清除，状态 completed
 *   3. 重复 start 同 itemId 第二次返回 null（不重复创建）
 *   4. 没 start 直接 end 也能正常 push（容错）
 *   5. finalizeRunningItems 把所有 running 全部转 failed
 */
async function main(): Promise<void> {
  // FakeTimerHost：手动推进时间，避免真等 60s
  const queue: Array<{ id: number; cb: () => void; due: number }> = [];
  let now = 0;
  let nextId = 1;
  const host: WatchdogTimerHost = {
    setTimeout(cb, ms) {
      const id = nextId++;
      queue.push({ id, cb, due: now + ms });
      return id;
    },
    clearTimeout(timer) {
      const idx = queue.findIndex((entry) => entry.id === timer);
      if (idx >= 0) queue.splice(idx, 1);
    }
  };
  const advance = (ms: number) => {
    now += ms;
    const due = queue.filter((entry) => entry.due <= now);
    queue.splice(0, queue.length, ...queue.filter((entry) => entry.due > now));
    for (const entry of due) entry.cb();
  };

  // case 1: start → 超时
  const store1 = createStore();
  let timedOut = 0;
  applyItemStart(store1, {
    itemId: "i1",
    watchdogMs: 60000,
    host,
    onTimeout: () => { timedOut += 1; }
  });
  assert(store1.pairs[0].status === "running", "fresh start should be running");
  advance(59999);
  assert(store1.pairs[0].status === "running", "before timeout still running");
  advance(2);
  assert(timedOut === 1, "onTimeout should fire after watchdogMs");
  assert(store1.pairs[0].status === "failed", `pair should be failed after timeout, got ${store1.pairs[0].status}`);
  assert(typeof store1.pairs[0].errorMessage === "string", "errorMessage should be set");

  // case 2: start → end 正常
  const store2 = createStore();
  applyItemStart(store2, {
    itemId: "i2",
    watchdogMs: 60000,
    host,
    onTimeout: () => { throw new Error("should not fire"); }
  });
  applyItemEnd(store2, { itemId: "i2", status: "completed", host });
  assert(store2.pairs[0].status === "completed", "end should mark completed");
  assert(store2.pairs[0].watchdogTimer === undefined, "watchdog should be cleared");
  advance(120000);
  // 不应该有任何 onTimeout 触发（前面会 throw）

  // case 3: 重复 start
  const store3 = createStore();
  const a = applyItemStart(store3, { itemId: "i3", watchdogMs: 60000, host, onTimeout: () => {} });
  const b = applyItemStart(store3, { itemId: "i3", watchdogMs: 60000, host, onTimeout: () => {} });
  assert(a !== null, "first start returns pair");
  assert(b === null, "duplicate start returns null");
  assert(store3.pairs.length === 1, "duplicate start should not push another pair");

  // case 4: 没 start 直接 end
  const store4 = createStore();
  applyItemEnd(store4, { itemId: "orphan", status: "failed", errorMessage: "lost", host });
  assert(store4.pairs.length === 1 && store4.pairs[0].status === "failed", "orphan end should still create a pair");

  // case 5: finalizeRunningItems
  const store5 = createStore();
  applyItemStart(store5, { itemId: "a", watchdogMs: 60000, host, onTimeout: () => {} });
  applyItemStart(store5, { itemId: "b", watchdogMs: 60000, host, onTimeout: () => {} });
  applyItemEnd(store5, { itemId: "b", status: "completed", host });
  const touched = finalizeRunningItems(store5, "stream disconnected", host);
  assert(touched === 1, `only running pairs should be touched, got ${touched}`);
  assert(store5.byItemId["a"].status === "failed", "running pair should be failed");
  assert(store5.byItemId["b"].status === "completed", "completed pair should remain completed");

  console.log("PASS item watchdog (5 scenarios: timeout / normal-end / dup-start / orphan-end / finalize)");
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
