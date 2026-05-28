/**
 * getEmitter() —— 模仿 service-client.ts 的 getMemoryClient 设计。
 *
 * 启用语义（按优先级）：
 *   1. OBSERVABILITY_ENABLED=false / 0 / no / off → 强制 Noop
 *   2. 缺 LANGFUSE_HOST / LANGFUSE_PUBLIC_KEY / LANGFUSE_SECRET_KEY → Noop（向后兼容）
 *   3. OBSERVABILITY_ENABLED=true 但缺 key → Noop + 一条 warn 日志
 *   4. 全配齐 → LangfuseAdapter
 *
 * 启用与否在进程内只决策一次（cached），启动时打一条 info 便于排查
 * "为什么我的对话没有 trace" 这类故障。
 */

import { LangfuseAdapter } from "./adapters/langfuse.js";
import { NoopAdapter } from "./adapters/noop.js";
import type { TraceEmitter } from "./emitter.js";
import { loadScrubConfigFromEnv } from "./scrub.js";

let cached: TraceEmitter | null = null;
let initialized = false;

function isExplicitlyDisabled(flag: string | undefined): boolean {
  if (!flag) return false;
  const v = flag.trim().toLowerCase();
  return v === "false" || v === "0" || v === "no" || v === "off";
}

function isExplicitlyEnabled(flag: string | undefined): boolean {
  if (!flag) return false;
  const v = flag.trim().toLowerCase();
  return v === "true" || v === "1" || v === "yes" || v === "on";
}

export function getEmitter(): TraceEmitter {
  if (initialized && cached) return cached;
  initialized = true;

  const flag = process.env.OBSERVABILITY_ENABLED;
  const host = process.env.LANGFUSE_HOST;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;

  if (isExplicitlyDisabled(flag)) {
    console.info("[observability] disabled by OBSERVABILITY_ENABLED");
    cached = new NoopAdapter();
    return cached;
  }

  if (!host || !publicKey || !secretKey) {
    if (isExplicitlyEnabled(flag)) {
      console.warn(
        "[observability] OBSERVABILITY_ENABLED=true but LANGFUSE_HOST/PUBLIC_KEY/SECRET_KEY missing — disabled"
      );
    }
    cached = new NoopAdapter();
    return cached;
  }

  cached = new LangfuseAdapter({
    publicKey,
    secretKey,
    baseUrl: host,
    flushAt: parseIntOr(process.env.LANGFUSE_FLUSH_AT, 20),
    flushInterval: parseIntOr(process.env.LANGFUSE_FLUSH_INTERVAL_MS, 2000),
    scrub: loadScrubConfigFromEnv(process.env)
  });
  console.info(`[observability] enabled (host=${host})`);
  return cached;
}

function parseIntOr(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** Reset cached singleton — used in tests. */
export function __resetEmitterForTests(): void {
  cached = null;
  initialized = false;
}
