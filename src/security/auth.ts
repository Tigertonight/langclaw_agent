import { readFileSync, watch, type FSWatcher } from "node:fs";
import { existsSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { logEvent } from "./observability.js";

export interface AuthContext {
  userId: string;
  tenantId: string;
  tokenId: string;
}

export class AuthError extends Error {
  constructor(message: string, public readonly status: 401 | 403 = 401) {
    super(message);
  }
}

interface TokenRecord {
  user_id: string;
  tenant_id?: string;
  token_id?: string;
  revoked_at?: string;
  is_admin?: boolean;
}

/**
 * Bearer token 鉴权器。
 *
 * 配置方式（按优先级，前者覆盖后者）：
 *   1. A2UI_AUTH_TOKENS_FILE   指向 JSON 文件，支持热重载（fs.watch + admin 接口）
 *   2. A2UI_AUTH_TOKENS        JSON 字符串，启动时加载一次
 *
 * 文件格式：
 *   { "tk_abc": { "user_id": "u001", "tenant_id": "tenantA", "is_admin": true },
 *     "tk_def": { "user_id": "u002", "revoked_at": "2026-05-23T00:00:00Z" } }
 *
 * revoked_at 带值即视为已吊销，不再生效。
 *
 * 本地 dev：A2UI_AUTH_DISABLED=1 时跳过校验，body.user_id 直接信任。
 */
export class TokenAuthenticator {
  private tokens = new Map<string, TokenRecord>();
  private readonly disabled: boolean;
  private readonly tokensFile?: string;
  private watcher?: FSWatcher;
  private reloadTimer?: NodeJS.Timeout;
  private lastLoadedAt: string | null = null;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.disabled = env.A2UI_AUTH_DISABLED === "1";
    this.tokensFile = env.A2UI_AUTH_TOKENS_FILE;
    if (this.tokensFile && existsSync(this.tokensFile)) {
      this.loadFromFile(this.tokensFile);
      this.watchFile(this.tokensFile);
    } else {
      this.loadFromInline(env.A2UI_AUTH_TOKENS);
    }
  }

  /** 当前是否已加载到任何 token（readiness 检查用） */
  isLoaded(): boolean {
    return this.disabled || this.tokens.size > 0;
  }

  /** 上次加载时间（debug / metrics 用） */
  loadedAt(): string | null {
    return this.lastLoadedAt;
  }

  /** 手动触发重载（admin 接口用） */
  reload(): { ok: true; size: number; loaded_at: string } | { ok: false; reason: string } {
    if (!this.tokensFile) return { ok: false, reason: "no_tokens_file_configured" };
    if (!existsSync(this.tokensFile)) return { ok: false, reason: "tokens_file_missing" };
    this.loadFromFile(this.tokensFile);
    return { ok: true, size: this.tokens.size, loaded_at: this.lastLoadedAt ?? new Date().toISOString() };
  }

  /** 是否是 admin token，用于守护 admin 端点 */
  isAdminToken(req: IncomingMessage): boolean {
    if (this.disabled) return true;
    const token = readBearer(req);
    if (!token) return false;
    const record = this.tokens.get(token);
    return Boolean(record && !isRevoked(record) && record.is_admin === true);
  }

  authenticate(req: IncomingMessage, body: Record<string, unknown> | null): AuthContext {
    const bodyUserId = body && typeof body.user_id === "string" ? body.user_id : "";
    if (this.disabled) {
      const userId = bodyUserId || "dev_user";
      return { userId, tenantId: "dev", tokenId: "dev" };
    }
    const token = readBearer(req);
    if (!token) throw new AuthError("missing bearer token", 401);
    const record = this.tokens.get(token);
    if (!record) throw new AuthError("invalid token", 401);
    if (isRevoked(record)) throw new AuthError("token revoked", 401);
    if (bodyUserId && bodyUserId !== record.user_id) {
      throw new AuthError("user_id does not match token", 403);
    }
    return {
      userId: record.user_id,
      tenantId: record.tenant_id ?? "default",
      tokenId: record.token_id ?? token.slice(0, 8)
    };
  }

  /** 关闭文件 watcher（测试 / 优雅退出用） */
  dispose(): void {
    this.watcher?.close();
    this.watcher = undefined;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
  }

  private loadFromInline(raw: string | undefined): void {
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Record<string, TokenRecord | string>;
      this.applyTokens(parsed);
    } catch {
      logEvent("warn", "auth_tokens_inline_parse_failed", {});
    }
  }

  private loadFromFile(file: string): void {
    try {
      const raw = readFileSync(file, "utf8");
      const parsed = JSON.parse(raw) as Record<string, TokenRecord | string>;
      this.applyTokens(parsed);
      logEvent("info", "auth_tokens_loaded", { file, size: this.tokens.size });
    } catch (error) {
      logEvent("error", "auth_tokens_load_failed", {
        file,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private applyTokens(parsed: Record<string, TokenRecord | string>): void {
    const next = new Map<string, TokenRecord>();
    for (const [token, record] of Object.entries(parsed)) {
      if (typeof record === "string") {
        next.set(token, { user_id: record });
      } else if (record && typeof record === "object" && typeof record.user_id === "string") {
        next.set(token, record);
      }
    }
    this.tokens = next;
    this.lastLoadedAt = new Date().toISOString();
  }

  private watchFile(file: string): void {
    try {
      this.watcher = watch(file, () => {
        // 节流：fs.watch 经常一次写入触发多次事件
        if (this.reloadTimer) clearTimeout(this.reloadTimer);
        this.reloadTimer = setTimeout(() => {
          this.loadFromFile(file);
        }, 500);
      });
    } catch (error) {
      logEvent("warn", "auth_tokens_watch_failed", {
        file,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

function isRevoked(record: TokenRecord): boolean {
  if (!record.revoked_at) return false;
  const ts = Date.parse(record.revoked_at);
  return Number.isFinite(ts) && ts <= Date.now();
}

function readBearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization ?? req.headers.Authorization as string | undefined;
  if (!header) return null;
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(.+)$/i.exec(value);
  return match ? match[1].trim() : null;
}
