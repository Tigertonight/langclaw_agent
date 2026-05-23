import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MetricsCollector, createMetricsPlugin } from "../runtime/metrics-collector.js";
import { RuntimeHooks } from "../runtime/hooks.js";

/**
 * MetricsCollector 落盘 + 聚合 smoke：
 *   1. tool_result(decision=completed) → 计入 ok / latency
 *   2. tool_result(decision=execution_failed, code=timeout) → failed + timeout
 *   3. context_assembly(prompt_authority=preassembly_may_overflow) → overflow 计数
 *   4. context_ingest(degraded=true) → ingest.degraded 计数
 *   5. jsonl 文件按 ts 日期切分，可被 readRecent 读回
 */
async function main(): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "metrics-smoke-"));
  try {
    const collector = new MetricsCollector({ dir });
    const hooks = new RuntimeHooks();
    hooks.use(createMetricsPlugin(collector));

    const today = new Date().toISOString().slice(0, 10);

    await hooks.emit("tool_result", {
      at: `${today}T01:00:00.000Z`,
      tool: "search.docs",
      decision: "completed",
      latency_ms: 120,
      user_id: "u1"
    });
    await hooks.emit("tool_result", {
      at: `${today}T01:00:01.000Z`,
      tool: "search.docs",
      decision: "completed",
      latency_ms: 200,
      user_id: "u1"
    });
    await hooks.emit("tool_result", {
      at: `${today}T01:00:02.000Z`,
      tool: "search.docs",
      decision: "execution_failed",
      code: "timeout",
      latency_ms: 20000,
      user_id: "u1"
    });
    await hooks.emit("tool_result", {
      at: `${today}T01:00:03.000Z`,
      tool: "search.docs",
      decision: "permission_denied",
      user_id: "u1"
    });

    await hooks.emit("context_assembly", {
      at: `${today}T01:00:04.000Z`,
      prompt_authority: "assembled",
      user_id: "u1"
    });
    await hooks.emit("context_assembly", {
      at: `${today}T01:00:05.000Z`,
      prompt_authority: "preassembly_may_overflow",
      user_id: "u1"
    });
    await hooks.emit("context_ingest", {
      at: `${today}T01:00:06.000Z`,
      degraded: true,
      user_id: "u1"
    });
    await hooks.emit("context_ingest", {
      at: `${today}T01:00:07.000Z`,
      degraded: false,
      user_id: "u1"
    });

    const agg = collector.aggregate();
    const tool = agg.tools["search.docs"] as { count: number; ok: number; failed: number; timeout: number; p50_ms: number; p99_ms: number };
    assert(tool.count === 3, `expected 3 tool_result events (decision=completed|execution_failed), got ${tool.count}`);
    assert(tool.ok === 2, `expected 2 ok, got ${tool.ok}`);
    assert(tool.failed === 1, `expected 1 failed, got ${tool.failed}`);
    assert(tool.timeout === 1, `expected 1 timeout, got ${tool.timeout}`);
    assert(typeof tool.p50_ms === "number", "p50 should be a number");

    const auth = agg.prompt_authority as { assembled: number; overflow: number; total: number };
    assert(auth.assembled === 1 && auth.overflow === 1, `prompt_authority counts wrong: ${JSON.stringify(auth)}`);

    const ingest = agg.ingest as { ok: number; degraded: number };
    assert(ingest.ok === 1 && ingest.degraded === 1, `ingest counts wrong: ${JSON.stringify(ingest)}`);

    const recent = await collector.readRecent(today, 100);
    assert(recent.length >= 7, `expected >=7 jsonl rows, got ${recent.length}`);
    const raw = await readFile(join(dir, `${today}.jsonl`), "utf8");
    assert(raw.includes("\"tool\":\"search.docs\""), "jsonl content missing search.docs row");

    console.log(`PASS metrics-collector (jsonl ${recent.length} rows, p50=${tool.p50_ms}ms, p99=${tool.p99_ms}ms)`);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
