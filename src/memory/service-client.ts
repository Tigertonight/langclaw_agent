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
 * Reads business_id off a UserContext-shaped object. Falls back to env or
 * a literal "default" so the runtime keeps working when the upstream caller
 * hasn't been migrated yet.
 */
export function resolveBusinessId(user: { business_id?: unknown } | null | undefined): string {
  const fromUser = user && typeof user.business_id === "string" ? user.business_id : null;
  return fromUser ?? process.env.MEMORY_SERVICE_DEFAULT_BUSINESS_ID ?? "default";
}

/** Reset cached singleton — used in tests. */
export function __resetMemoryClientForTests(): void {
  cached = null;
  initialized = false;
}
