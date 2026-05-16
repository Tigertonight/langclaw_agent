type PromptCacheOptions = {
  baseUrl?: string;
  model?: string;
  scope?: string;
};

type PromptCacheMode = "off" | "openai" | "minimax" | "auto" | "force";

const DEFAULT_CACHE_MODE: PromptCacheMode = "auto";
const DEFAULT_CACHE_KEY_PREFIX = "openclaw-agent";

export function applyPromptCache<T extends Record<string, unknown>>(body: T, { baseUrl, model, scope }: PromptCacheOptions = {}): T {
  if (!body || typeof body !== "object") return body;

  const mode = normalizeCacheMode(process.env.LLM_PROMPT_CACHE);
  if (mode === "off") return body;

  const provider = inferProvider({ baseUrl, model });
  if (!shouldInjectPromptCache({ mode, provider })) return body;

  const mutableBody = body as Record<string, unknown>;
  const cacheKey = buildPromptCacheKey({ scope, model });
  if (cacheKey) mutableBody["prompt_cache_key"] = cacheKey;

  const retention = normalizeRetention(process.env.LLM_PROMPT_CACHE_RETENTION);
  if (retention) mutableBody["prompt_cache_retention"] = retention;

  return body;
}

export function getPromptCacheMode({ baseUrl, model }: PromptCacheOptions = {}) {
  const mode = normalizeCacheMode(process.env.LLM_PROMPT_CACHE);
  const provider = inferProvider({ baseUrl, model });
  return {
    mode,
    provider,
    injectsRequestParams: shouldInjectPromptCache({ mode, provider }),
    automaticProviderCache: mode !== "off" && ["minimax", "deepseek"].includes(provider)
  };
}

function normalizeCacheMode(value: unknown): PromptCacheMode {
  const normalized = String(value ?? DEFAULT_CACHE_MODE).trim().toLowerCase();
  if (["off", "false", "0", "none", "disabled"].includes(normalized)) return "off";
  if (["openai", "minimax", "auto", "force"].includes(normalized)) return normalized as PromptCacheMode;
  return DEFAULT_CACHE_MODE;
}

function inferProvider({ baseUrl, model }: PromptCacheOptions = {}): string {
  const joined = `${baseUrl ?? ""} ${model ?? ""}`.toLowerCase();
  if (joined.includes("minimax") || joined.includes("minimaxi")) return "minimax";
  if (joined.includes("deepseek")) return "deepseek";
  if (joined.includes("api.openai.com") || joined.includes("openai")) return "openai";
  return "openai-compatible";
}

function shouldInjectPromptCache({ mode, provider }: { mode: PromptCacheMode; provider: string }): boolean {
  if (mode === "force") return true;
  if (mode === "openai") return true;
  if (mode === "minimax") return false;
  if (mode !== "auto") return false;
  return provider === "openai";
}

function buildPromptCacheKey({ scope, model }: PromptCacheOptions = {}): string {
  const prefix = process.env.LLM_PROMPT_CACHE_KEY_PREFIX ?? DEFAULT_CACHE_KEY_PREFIX;
  const raw = [prefix, scope || "chat", normalizeModelName(model)].filter(Boolean).join(":");
  return raw
    .replace(/[^a-zA-Z0-9_.:-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 128);
}

function normalizeModelName(model: unknown): string {
  return String(model ?? "default").trim().toLowerCase();
}

function normalizeRetention(value: unknown): "in_memory" | "24h" | null {
  const normalized = String(value ?? "").trim();
  if (normalized === "in_memory" || normalized === "24h") return normalized;
  return null;
}
