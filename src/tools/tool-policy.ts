import { readFileSync } from "node:fs";

/**
 * 每工具的执行策略：超时 + 自动重试。
 *
 * 优先级：tool.metadata.timeout_ms > 配置文件 tools[name].timeout_ms >
 *         配置文件 defaults.timeout_ms > 环境变量 > DEFAULT_TOOL_TIMEOUT_MS。
 *
 * 重试只对 transient code（"timeout" / "network"）生效；permission /
 * unknown_tool / internal_error 一概不重试，避免放大错误。
 */
export interface ToolPolicy {
  timeoutMs: number;
  retries: number;
  retryBackoffMs: number;
}

interface PolicyFile {
  defaults?: { timeout_ms?: number; retries?: number; retry_backoff_ms?: number };
  tools?: Record<string, { timeout_ms?: number; retries?: number; retry_backoff_ms?: number }>;
}

const DEFAULT_TOOL_TIMEOUT_MS = 20_000;
const DEFAULT_RETRY_BACKOFF_MS = 200;

export class ToolPolicyStore {
  private readonly defaults: ToolPolicy;
  private readonly perTool: Map<string, Partial<ToolPolicy>>;

  constructor(file: PolicyFile = {}) {
    const envTimeout = Number(process.env.TOOL_EXECUTION_TIMEOUT_MS);
    const envFallbackTimeout = Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : DEFAULT_TOOL_TIMEOUT_MS;
    this.defaults = {
      timeoutMs: positive(file.defaults?.timeout_ms) ?? envFallbackTimeout,
      retries: nonNegativeInt(file.defaults?.retries) ?? 0,
      retryBackoffMs: positive(file.defaults?.retry_backoff_ms) ?? DEFAULT_RETRY_BACKOFF_MS
    };
    this.perTool = new Map();
    for (const [name, value] of Object.entries(file.tools ?? {})) {
      const slot: Partial<ToolPolicy> = {};
      const t = positive(value.timeout_ms); if (t !== null) slot.timeoutMs = t;
      const r = nonNegativeInt(value.retries); if (r !== null) slot.retries = r;
      const b = positive(value.retry_backoff_ms); if (b !== null) slot.retryBackoffMs = b;
      this.perTool.set(name, slot);
    }
  }

  resolve(toolName: string, metadataTimeoutMs?: number): ToolPolicy {
    const slot = this.perTool.get(toolName) ?? {};
    const metadataOverride = positive(metadataTimeoutMs);
    return {
      timeoutMs: metadataOverride ?? slot.timeoutMs ?? this.defaults.timeoutMs,
      retries: slot.retries ?? this.defaults.retries,
      retryBackoffMs: slot.retryBackoffMs ?? this.defaults.retryBackoffMs
    };
  }
}

export function loadToolPolicyStore(path = "data/tool-policies.json"): ToolPolicyStore {
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as PolicyFile;
    return new ToolPolicyStore(parsed && typeof parsed === "object" ? parsed : {});
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return new ToolPolicyStore();
    console.warn(`[tool-policy] load failed (${path}): ${err instanceof Error ? err.message : String(err)}; falling back to defaults`);
    return new ToolPolicyStore();
  }
}

/**
 * 错误分类决定是否重试。timeout / network 视为"很可能下次就好"；
 * 其他（aborted / permission / internal_error）一律不重试。
 */
export function isRetriableErrorCode(code: string | undefined): boolean {
  return code === "timeout" || code === "network";
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function nonNegativeInt(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}
