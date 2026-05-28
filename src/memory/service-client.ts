/**
 * Thin adapter wiring the @openclaw/memory-sdk into the OpenClaw runtime.
 *
 * Activation 显式开关 + 配置：
 *   MEMORY_SERVICE_ENABLED → "true"/"1" 显式打开；缺省时只要 URL+SECRET 同时存在也算打开
 *                            （向后兼容旧部署）。设为 "false" 可强制关闭即使 URL 配了。
 *   MEMORY_SERVICE_URL     → 远端地址，未配置则禁用。
 *   MEMORY_SERVICE_SECRET  → HMAC secret，未配置则禁用。
 *   MEMORY_SERVICE_HEADER  → header 名（默认 X-Memory-Identity）。
 *   MEMORY_SERVICE_AGENT   → 可选默认 agent_id。
 *
 * 启用与否在 process 内只决策一次，启动时打一条 info 日志，便于排查
 * "为什么 evolution 没镜像到 memory-service" 这类故障。
 */

import { IdentityProvider, MemoryClient } from "../../packages/memory-sdk/src/index.js";

let cached: MemoryClient | null = null;
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

export function getMemoryClient(): MemoryClient | null {
  if (initialized) return cached;
  initialized = true;
  const flag = process.env.MEMORY_SERVICE_ENABLED;
  const url = process.env.MEMORY_SERVICE_URL;
  const secret = process.env.MEMORY_SERVICE_SECRET;

  if (isExplicitlyDisabled(flag)) {
    console.info("[memory-service] disabled by MEMORY_SERVICE_ENABLED");
    cached = null;
    return null;
  }
  if (!url || !secret) {
    if (isExplicitlyEnabled(flag)) {
      console.warn("[memory-service] MEMORY_SERVICE_ENABLED=true but URL or SECRET missing — disabled");
    }
    cached = null;
    return null;
  }
  const provider = new IdentityProvider({
    secret,
    defaultAgentId: process.env.MEMORY_SERVICE_AGENT ?? "openclaw"
  });
  cached = new MemoryClient({
    baseUrl: url,
    identityProvider: provider,
    identityHeader: process.env.MEMORY_SERVICE_HEADER
  });
  console.info(`[memory-service] enabled (url=${url})`);
  return cached;
}

/**
 * 解析 business_id 的优先级：
 *   1. workspace.business_id（如果调用方传 WorkspaceContext-shape）
 *   2. user.business_id（duck-typed，向后兼容旧调用点）
 *   3. env MEMORY_SERVICE_DEFAULT_BUSINESS_ID
 *   4. "default"
 *
 * Spec 1.12 之后调用方应优先传 workspace；user 通道留作迁移期兼容。
 */
export function resolveBusinessId(
  source: { business_id?: unknown } | null | undefined
): string {
  if (source && typeof source === "object") {
    const candidate = (source as { business_id?: unknown }).business_id;
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return process.env.MEMORY_SERVICE_DEFAULT_BUSINESS_ID ?? "default";
}

/** Reset cached singleton — used in tests. */
export function __resetMemoryClientForTests(): void {
  cached = null;
  initialized = false;
}
