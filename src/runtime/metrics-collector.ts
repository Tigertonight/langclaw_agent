import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { JsonObject } from "../types/agent-contracts.js";
import type { RuntimePlugin } from "./hooks.js";

/**
 * 把 hook 流量折叠成时序 metrics，落本地 jsonl。
 *
 * 设计原则（参考 docs/openclaw-reference）：
 * - 不接外部 sentry / Prometheus，企业里"先有数据"再"对接"
 * - 每条 metric event 都是独立 jsonl 行，方便 grep / 后期 ETL
 * - 内存里维护一个滚动窗口（默认 6 小时），用来回答 /api/metrics 即时查询
 * - 永不抛错，写入失败 console.warn 就完事
 */

export interface MetricEvent extends JsonObject {
  ts: string;
  kind: string;
  user_id?: string;
  session_id?: string;
  tool?: string;
  status?: string;
  code?: string;
  latency_ms?: number;
  prompt_authority?: string;
  ingest_degraded?: boolean;
}

export interface MetricsAggregateInput {
  windowStart?: number;
  windowEnd?: number;
}

export interface MetricsAggregate extends JsonObject {
  window: { start: string; end: string; count: number };
  tools: JsonObject;
  prompt_authority: JsonObject;
  ingest: JsonObject;
}

export interface MetricsCollectorOptions {
  dir?: string;
  rollingWindowMs?: number;
}

export class MetricsCollector {
  private readonly dir: string;
  private readonly rollingWindowMs: number;
  private readonly buffer: MetricEvent[] = [];

  constructor(options: MetricsCollectorOptions = {}) {
    this.dir = options.dir ?? ".data/metrics";
    this.rollingWindowMs = options.rollingWindowMs ?? 6 * 60 * 60 * 1000; // 6h
  }

  async record(event: MetricEvent): Promise<void> {
    this.buffer.push(event);
    this.gc();
    try {
      await mkdir(this.dir, { recursive: true });
      const day = event.ts.slice(0, 10);
      await appendFile(join(this.dir, `${day}.jsonl`), `${JSON.stringify(event)}\n`, "utf8");
    } catch (err) {
      console.warn(`[metrics] write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** 内存滚动窗口聚合，给 /api/metrics 用 */
  aggregate(input: MetricsAggregateInput = {}): MetricsAggregate {
    const end = input.windowEnd ?? Date.now();
    const start = input.windowStart ?? end - this.rollingWindowMs;
    const events = this.buffer.filter((event) => {
      const ts = Date.parse(event.ts);
      return Number.isFinite(ts) && ts >= start && ts <= end;
    });
    return {
      window: {
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        count: events.length
      },
      tools: aggregateTools(events),
      prompt_authority: aggregatePromptAuthority(events),
      ingest: aggregateIngest(events)
    };
  }

  /** 测试用：从最近落盘的 jsonl 读 N 行（不依赖内存 buffer） */
  async readRecent(day: string, limit = 50): Promise<MetricEvent[]> {
    try {
      const raw = await readFile(join(this.dir, `${day}.jsonl`), "utf8");
      const lines = raw.trim().split("\n").slice(-limit);
      return lines.map((line) => JSON.parse(line) as MetricEvent);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  private gc(): void {
    const cutoff = Date.now() - this.rollingWindowMs;
    while (this.buffer.length && Date.parse(this.buffer[0].ts) < cutoff) {
      this.buffer.shift();
    }
    if (this.buffer.length > 5000) this.buffer.splice(0, this.buffer.length - 5000);
  }
}

function aggregateTools(events: MetricEvent[]): JsonObject {
  const byTool = new Map<string, { count: number; ok: number; failed: number; timeout: number; aborted: number; latencies: number[] }>();
  for (const event of events) {
    if (event.kind !== "tool_result" || !event.tool) continue;
    const slot = byTool.get(event.tool) ?? { count: 0, ok: 0, failed: 0, timeout: 0, aborted: 0, latencies: [] };
    slot.count += 1;
    if (event.status === "ok") slot.ok += 1;
    else slot.failed += 1;
    if (event.code === "timeout") slot.timeout += 1;
    if (event.code === "aborted") slot.aborted += 1;
    if (typeof event.latency_ms === "number") slot.latencies.push(event.latency_ms);
    byTool.set(event.tool, slot);
  }
  const out: JsonObject = {};
  for (const [tool, slot] of byTool) {
    out[tool] = {
      count: slot.count,
      ok: slot.ok,
      failed: slot.failed,
      timeout: slot.timeout,
      aborted: slot.aborted,
      p50_ms: percentile(slot.latencies, 0.5),
      p99_ms: percentile(slot.latencies, 0.99)
    };
  }
  return out;
}

function aggregatePromptAuthority(events: MetricEvent[]): JsonObject {
  let assembled = 0;
  let overflow = 0;
  for (const event of events) {
    if (event.kind !== "prompt_authority") continue;
    if (event.prompt_authority === "preassembly_may_overflow") overflow += 1;
    else if (event.prompt_authority === "assembled") assembled += 1;
  }
  return { assembled, overflow, total: assembled + overflow };
}

function aggregateIngest(events: MetricEvent[]): JsonObject {
  let ok = 0;
  let degraded = 0;
  for (const event of events) {
    if (event.kind !== "context_ingest") continue;
    if (event.ingest_degraded === true) degraded += 1;
    else ok += 1;
  }
  return { ok, degraded, total: ok + degraded };
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx];
}

/**
 * RuntimePlugin 适配：在 hook 总线上把 tool_result / context_assembly /
 * context_ingest 翻译成 MetricEvent 落地。
 */
export function createMetricsPlugin(collector: MetricsCollector): RuntimePlugin {
  return {
    name: "metrics-collector",
    register(hooks) {
      hooks.on("tool_result", async (event) => {
        if (event.decision !== "completed" && event.decision !== "execution_failed") return;
        const status = event.decision === "completed" ? "ok" : "failed";
        await collector.record({
          ts: typeof event.at === "string" ? event.at : new Date().toISOString(),
          kind: "tool_result",
          user_id: typeof event.user_id === "string" ? event.user_id : undefined,
          session_id: typeof event.session_id === "string" ? event.session_id : undefined,
          tool: typeof event.tool === "string" ? event.tool : undefined,
          status,
          code: typeof event.code === "string" ? event.code : undefined,
          latency_ms: typeof event.latency_ms === "number" ? event.latency_ms : undefined
        });
      });
      hooks.on("context_assembly", async (event) => {
        await collector.record({
          ts: typeof event.at === "string" ? event.at : new Date().toISOString(),
          kind: "prompt_authority",
          user_id: typeof event.user_id === "string" ? event.user_id : undefined,
          session_id: typeof event.session_id === "string" ? event.session_id : undefined,
          prompt_authority: typeof event.prompt_authority === "string" ? event.prompt_authority : undefined
        });
      });
      hooks.on("context_ingest", async (event) => {
        await collector.record({
          ts: typeof event.at === "string" ? event.at : new Date().toISOString(),
          kind: "context_ingest",
          user_id: typeof event.user_id === "string" ? event.user_id : undefined,
          session_id: typeof event.session_id === "string" ? event.session_id : undefined,
          ingest_degraded: event.degraded === true
        });
      });
    }
  };
}
