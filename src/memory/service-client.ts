/**
 * Thin adapter wiring the @openclaw/memory-sdk into the OpenClaw runtime.
 *
 * Activation is fully env-driven and opt-in:
 *   MEMORY_SERVICE_URL    → if unset, the adapter is disabled and getMemoryClient() returns null.
 *   MEMORY_SERVICE_SECRET → HMAC secret matching memory-service SERVICE_TOKEN_SECRET.
 *   MEMORY_SERVICE_HEADER → header name (default X-Memory-Identity).
 *   MEMORY_SERVICE_AGENT  → optional default agent_id stamped on tokens.
 *
 * We intentionally do NOT throw at import time when env is missing — many
 * existing eval/CLI scripts run without the memory service, and we want the
 * integration to be a soft enhancement, not a hard dependency.
 */

import { IdentityProvider, MemoryClient } from "../../packages/memory-sdk/src/index.js";

let cached: MemoryClient | null = null;
let initialized = false;

export function getMemoryClient(): MemoryClient | null {
  if (initialized) return cached;
  initialized = true;
  const url = process.env.MEMORY_SERVICE_URL;
  const secret = process.env.MEMORY_SERVICE_SECRET;
  if (!url || !secret) {
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
