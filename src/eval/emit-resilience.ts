import { RuntimeHooks } from "../runtime/hooks.js";

/**
 * 验证 hooks.emit 是"永不抛错"的旁路通道：
 *   1. 单个 handler 抛错 → 其它 handler 仍然跑，emit 不抛
 *   2. 所有 handler 都炸 → emit 仍然返回，主循环继续
 *   3. handler 抛同步错误（不是 reject）→ 也不能影响主流程
 */
async function main(): Promise<void> {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args.map((a) => String(a)).join(" ")); };

  try {
    // case 1: one throws, one runs
    const hooks = new RuntimeHooks();
    let goodRan = 0;
    hooks.on("turn_start", async () => { throw new Error("plugin A blew up"); });
    hooks.on("turn_start", async () => { goodRan += 1; });
    await hooks.emit("turn_start", { user_id: "u1", session_id: "s1", message: "hi" });
    assert(goodRan === 1, `surviving handler should still run, got ${goodRan}`);
    assert(warnings.some((w) => w.includes("blew up")), "warn should mention the crashed handler");

    // case 2: all handlers explode → emit still resolves
    const hooks2 = new RuntimeHooks();
    hooks2.on("context_assembly", async () => { throw new Error("crash 1"); });
    hooks2.on("context_assembly", async () => { throw new Error("crash 2"); });
    let resolved = false;
    await hooks2.emit("context_assembly", { user_id: "u2", session_id: "s2" }).then(() => { resolved = true; });
    assert(resolved, "emit should still resolve when all handlers throw");

    // case 3: synchronous throw in handler
    const hooks3 = new RuntimeHooks();
    let post = 0;
    hooks3.on("tool_result", (() => { throw new Error("sync boom"); }) as never);
    hooks3.on("tool_result", async () => { post += 1; });
    await hooks3.emit("tool_result", { user_id: "u3", session_id: "s3", tool: "x", decision: "allowed" });
    assert(post === 1, `next handler should still run after sync throw, got ${post}`);

    // case 4: emit with no listeners is a no-op
    const hooks4 = new RuntimeHooks();
    await hooks4.emit("turn_end", { user_id: "u4", session_id: "s4" });

    console.log(`PASS emit resilience (${warnings.length} warnings captured, main loop unaffected)`);
  } finally {
    console.warn = originalWarn;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
