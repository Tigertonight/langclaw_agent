import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { attachMcpServers, createApp } from "../app.js";
import { createA2UIModule } from "../a2ui/module.js";
import { A2UIBadRequestError } from "../a2ui/dto.js";
import { loadJson } from "../data/load-json.js";
import { getResourceDataPath } from "../domains/runtime-registry.js";
import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import { renderChatPage } from "./chat-page.js";
import { basicLiveness, checkReadiness } from "./health.js";
import { handlerManifestRegistry } from "../handlers/handler-manifest.js";
import { TokenAuthenticator, AuthError, type AuthContext } from "../security/auth.js";
import { RateLimiter, RateLimitError, readClientIp } from "../security/rate-limiter.js";
import { sharedMetrics, logEvent, newTraceId, startRequest, type RequestContext } from "../security/observability.js";
import type { JsonObject } from "../types/agent-contracts.js";
// Phase 4: Tool Catalog
import { ToolCatalog } from "../tools/tool-catalog.js";

interface WecomUserRecord extends JsonObject {
  userid?: string;
  name?: string;
  alias?: string;
  department_name?: string;
  position?: string;
  mobile?: string;
  email?: string;
  direct_leader?: string;
  reporting?: JsonObject;
}

interface SkillListItem extends JsonObject {
  id?: string;
  name?: string;
  description?: string;
  version?: string;
  enabled?: boolean;
  source?: string;
  install_type?: string;
  path?: string;
  planning_style?: string;
  required_permissions?: string[];
  required_primitives?: string[];
}

type RequestBody = Record<string, unknown>;

const app = createApp();
await app.init();
const mcp = await attachMcpServers(app.toolRegistry);
const { agent, queryEngine, skillRegistry, skillLoader, userContextResolver, toolRegistry, intentRegistry, intentRouter, metricsCollector, cronRunner } = app;
const { chatController: a2uiChatController } = createA2UIModule({
  queryEngine,
  streamAgent: agent,
  toolRegistry,
  userContextResolver
});
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const chatStreamTimeoutMs = readPositiveNumberEnv("CHAT_STREAM_TIMEOUT_MS", 60000);
const sseHeartbeatMs = readPositiveNumberEnv("SSE_HEARTBEAT_MS", 15_000);
const shutdownDrainMs = readPositiveNumberEnv("SHUTDOWN_DRAIN_MS", 30_000);

let draining = false;
const inFlight = new Set<ServerResponse>();

const auth = new TokenAuthenticator();
const rateLimiter = new RateLimiter(
  60_000,
  readPositiveNumberEnv("A2UI_USER_QPM", 30),
  readPositiveNumberEnv("A2UI_IP_QPM", 60),
  readPositiveNumberEnv("A2UI_STREAMS_PER_USER", 3)
);
const metrics = sharedMetrics;
const PROTECTED_PATHS = new Set([
  "/api/chat",
  "/api/chat/stream",
  "/api/a2ui/action",
  "/api/a2ui/history"
]);
const cronHeartbeat = startCronHeartbeat();

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  setCors(res);
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;
  const ctx = startRequest();
  res.setHeader("X-Trace-Id", ctx.traceId);

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, basicLiveness());
    return;
  }

  if (req.method === "GET" && pathname === "/ready") {
    if (draining) {
      sendJson(res, 503, { ok: false, draining: true, checks: { shutdown: { ok: false, detail: "draining" } } });
      return;
    }
    const result = await checkReadiness(auth);
    sendJson(res, result.ok ? 200 : 503, result);
    return;
  }

  if (req.method === "GET" && (pathname === "/" || pathname === "/chat")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderChatPage());
    return;
  }

  if (req.method === "GET" && pathname === "/api/wecom-users") {
    const users = await loadJson<WecomUserRecord[]>(getResourceDataPath("employees") ?? "data/wecom-users.json");
    sendJson(res, 200, {
      users: users.map((user) => ({
        userid: user.userid,
        name: user.name,
        alias: user.alias,
        department_name: user.department_name,
        position: user.position,
        mobile: user.mobile,
        email: user.email,
        direct_leader: user.direct_leader,
        reporting: user.reporting
      }))
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/user-context") {
    try {
      const userId = url.searchParams.get("user_id") || undefined;
      const wecomUserId = url.searchParams.get("wecom_userid") || userId;
      const userContext = await userContextResolver.resolve({ userId, wecomUserId });
      sendJson(res, 200, {
        user_context: userContext
      });
    } catch (error) {
      sendJson(res, 500, {
        error: "resolve_user_context_failed",
        message: error instanceof Error ? error.message : "unknown error"
      });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/a2ui/capabilities") {
    sendJson(res, 200, a2uiChatController.capabilities());
    return;
  }

  if (req.method === "GET" && pathname === "/api/metrics") {
    const range = url.searchParams.get("range");
    const windowMs = parseRangeMs(range);
    const end = Date.now();
    const start = windowMs === null ? undefined : end - windowMs;
    sendJson(res, 200, {
      metrics: metrics.snapshot(),
      rate_limiter: rateLimiter.snapshot(),
      runtime: metricsCollector.aggregate({ windowStart: start, windowEnd: end })
    });
    return;
  }

  if (req.method === "GET" && pathname === "/metrics") {
    res.writeHead(200, { "Content-Type": "text/plain; version=0.0.4; charset=utf-8" });
    res.end(metrics.toPrometheus());
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/auth/reload") {
    if (!auth.isAdminToken(req)) {
      sendJson(res, 403, { error: "admin_required", message: "需要 admin token。" });
      return;
    }
    const result = auth.reload();
    sendJson(res, result.ok ? 200 : 400, result);
    return;
  }

  if (req.method === "GET" && pathname === "/api/a2ui/history") {
    try {
      const userId = url.searchParams.get("user_id") ?? "";
      const sessionId = url.searchParams.get("session_id") ?? "";
      const runId = url.searchParams.get("run_id") ?? undefined;
      const sinceParam = url.searchParams.get("since_seq");
      const sinceSeq = sinceParam !== null ? Number(sinceParam) : undefined;
      if (!userId || !sessionId) {
        sendJson(res, 400, { error: "bad_request", message: "user_id 和 session_id 必填。" });
        return;
      }
      const result = await a2uiChatController.history({
        userId, sessionId, runId,
        sinceSeq: Number.isFinite(sinceSeq) ? Number(sinceSeq) : undefined
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        error: "a2ui_history_failed",
        message: error instanceof Error ? error.message : "unknown error",
        trace_id: ctx.traceId
      });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/a2ui/action") {
    try {
      const body = await readJson(req);
      const authCtx = guardRequest(req, body, pathname, ctx);
      metrics.inc("action_invoked_total", { tenant: authCtx.tenantId });
      const result = await a2uiChatController.action(body);
      if (result.ok === false) {
        metrics.inc("action_forbidden_total", { tenant: authCtx.tenantId, reason: stringFromUnknown(result.error) });
      }
      sendJson(res, result.ok === false ? 400 : 200, { ...result, trace_id: ctx.traceId });
    } catch (error) {
      handleError(error, res, ctx, { path: pathname });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/handlers") {
    try {
      const auth = await authorizeHandlersInspect(req, url);
      if (!auth.ok) {
        sendJson(res, auth.status, { error: auth.code, message: auth.message });
        return;
      }
      const handlers = handlerManifestRegistry.list();
      const intents = intentRegistry.listCodes().map((manifest) => ({
        intent_code: manifest.intent_code,
        handler_type: manifest.handler_type,
        description: manifest.description ?? null
      }));
      const intentsByHandler = new Map<string, string[]>();
      for (const item of intents) {
        const list = intentsByHandler.get(item.handler_type) ?? [];
        list.push(item.intent_code);
        intentsByHandler.set(item.handler_type, list);
      }
      const payload = {
        handlers: handlers.map((manifest) => ({
          ...manifest,
          bound_intent_codes: intentsByHandler.get(manifest.handler_type) ?? []
        })),
        intent_codes: intents,
        commands: intentRouter.commands.list().map((command) => ({ id: command.id }))
      };
      const body = JSON.stringify(payload, null, 2);
      const etag = `"W/${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;
      const ifNoneMatch = req.headers["if-none-match"];
      if (typeof ifNoneMatch === "string" && ifNoneMatch === etag) {
        res.writeHead(304, { ETag: etag });
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        ETag: etag,
        "Cache-Control": "private, max-age=60"
      });
      res.end(body);
    } catch (error) {
      sendJson(res, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "unknown error"
      });
    }
    return;
  }

  // Phase 4: Tool Catalog API
  if (req.method === "GET" && pathname === "/api/tools/catalog") {
    try {
      const userId = (typeof req.headers["x-user-id"] === "string" ? req.headers["x-user-id"] : url.searchParams.get("user_id")) || undefined;
      const domain = url.searchParams.get("domain") || undefined;
      const planMode = url.searchParams.get("plan_mode") === "true";
      const query = url.searchParams.get("q") || undefined;

      let userCtx;
      if (userId) {
        try {
          userCtx = await userContextResolver.resolve({ userId });
        } catch {
          // 匿名用户，仅返回无权限过滤的目录
        }
      }

      const tools = toolRegistry.list({ user: userCtx });
      const catalog = new ToolCatalog();
      const result = catalog.build(tools, userCtx, { planMode });

      // 可选：按业务域过滤
      const filtered = domain
        ? catalog.filter(result, { domain: domain as Parameters<ToolCatalog["filter"]>[1]["domain"] })
        : result.entries;

      const body = JSON.stringify({
        ok: true,
        plan_mode: planMode,
        user_id: userId ?? null,
        total: result.total,
        filtered_count: domain ? filtered.length : result.total,
        domains: result.domains,
        plan_mode_allowed_count: result.plan_mode_allowed.length,
        ask_tools_count: result.ask_tools.length,
        deny_tools_count: result.deny_tools.length,
        entries: domain ? filtered : result.entries,
        ...(query ? { query_filtered: catalog.filter(result, { query }) } : {})
      }, null, 2);

      const etag = `"W/${createHash("sha1").update(body).digest("hex").slice(0, 16)}"`;
      const ifNoneMatch = req.headers["if-none-match"];
      if (typeof ifNoneMatch === "string" && ifNoneMatch === etag) {
        res.writeHead(304, { ETag: etag });
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        ETag: etag,
        "Cache-Control": "private, max-age=30"
      });
      res.end(body);
    } catch (error) {
      sendJson(res, 500, {
        error: "catalog_failed",
        message: error instanceof Error ? error.message : "unknown error"
      });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/commands") {
    try {
      // 这个接口面向"前端聊天框 / 输入提示"，需要认到具体用户来过滤命令。
      // 鉴权：必须带 user_id（X-User-Id 或 ?user_id=），与 /api/handlers 分开
      // ——/api/handlers 是运维接口，commands 是用户接口。
      const userId = (typeof req.headers["x-user-id"] === "string" ? req.headers["x-user-id"] : url.searchParams.get("user_id")) || "";
      if (!userId) {
        sendJson(res, 401, { error: "unauthorized", message: "请提供 X-User-Id 或 ?user_id=" });
        return;
      }
      let user;
      try {
        user = await userContextResolver.resolve({ userId });
      } catch (error) {
        sendJson(res, 401, { error: "unauthorized", message: error instanceof Error ? error.message : "unknown user" });
        return;
      }
      const userPermissions = new Set(Array.isArray(user.permissions) ? user.permissions : []);
      const commands = intentRouter.commands.list();
      const visible: Array<JsonObject> = [];
      for (const command of commands) {
        const intentCode = command.intentCode;
        if (intentCode) {
          const manifest = intentRegistry.getCode(intentCode);
          const required = manifest?.required_permissions ?? [];
          if (required.length && !required.every((perm) => userPermissions.has(perm))) continue;
        }
        visible.push({
          id: command.id,
          intent_code: intentCode ?? null,
          title: command.title ?? command.id,
          triggers: command.triggers ?? []
        });
      }
      sendJson(res, 200, { commands: visible, user_id: userId });
    } catch (error) {
      sendJson(res, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "unknown error"
      });
    }
    return;
  }

  if (req.method === "GET" && pathname === "/api/skills") {
    try {
      const skills = await skillLoader.list();
      sendJson(res, 200, {
        skills: skills.map((skill) => ({
          id: skill.id,
          name: skill.name,
          description: skill.description,
          version: skill.version,
          enabled: skill.enabled,
          source: skill.source,
          install_type: skill.install_type,
          path: skill.path,
          planning_style: skill.planning_style,
          required_permissions: skill.required_permissions,
          required_primitives: skill.required_primitives
        }))
      });
    } catch (error) {
      sendJson(res, isBadRequestError(error) ? 400 : 500, {
        error: isBadRequestError(error) ? "bad_request" : "internal_error",
        message: error instanceof Error ? error.message : "unknown error"
      });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/skills/install") {
    try {
      const body = await readJson(req);
      if (typeof body.path !== "string" || !body.path) {
        sendJson(res, 400, { error: "bad_request", message: "path 必填。" });
        return;
      }
      const installed = await skillRegistry.installFromLocalDir(body.path);
      skillLoader.invalidate();
      sendJson(res, 200, { ok: true, installed });
    } catch (error) {
      sendJson(res, 500, {
        error: "install_failed",
        message: error instanceof Error ? error.message : "unknown error"
      });
    }
    return;
  }

  const toggleMatch = pathname.match(/^\/api\/skills\/([^/]+)\/enabled$/);
  if (req.method === "POST" && toggleMatch) {
    try {
      const body = await readJson(req);
      if (typeof body.enabled !== "boolean") {
        sendJson(res, 400, { error: "bad_request", message: "enabled 必须是 boolean。" });
        return;
      }
      const result = await skillRegistry.setEnabled(decodeURIComponent(toggleMatch[1]), body.enabled);
      skillLoader.invalidate();
      sendJson(res, 200, { ok: true, result });
    } catch (error) {
      sendJson(res, 500, {
        error: "toggle_failed",
        message: error instanceof Error ? error.message : "unknown error"
      });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/chat") {
    try {
      const body = await readJson(req);
      const authCtx = guardRequest(req, body, pathname, ctx);
      metrics.inc("chat_request_total", { tenant: authCtx.tenantId });
      const result = await a2uiChatController.chat(body);
      sendJson(res, 200, { ...result, trace_id: ctx.traceId });
    } catch (error) {
      metrics.inc("chat_request_failed", { reason: errorReason(error) });
      handleError(error, res, ctx, { path: pathname });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/chat/stream") {
    let streamClosed = false;
    let releaseStream: (() => void) | null = null;
    let authCtx: AuthContext | null = null;
    let heartbeatTimer: NodeJS.Timeout | null = null;
    const startedAt = Date.now();
    inFlight.add(res);
    try {
      const body = await readJson(req);
      authCtx = guardRequest(req, body, pathname, ctx, { skipUserQuota: true });
      releaseStream = rateLimiter.acquireStream(authCtx.userId);
      metrics.inc("chat_stream_total", { tenant: authCtx.tenantId });

      const lastEventId = readLastEventId(req);
      const sinceSeq = lastEventId ? parseInt(lastEventId.split(":").pop() ?? "0", 10) : undefined;
      // body 里也允许传 since_seq，作为 fetch 场景下显式重连的等价物
      const explicitSince = typeof body.since_seq === "number" ? body.since_seq : undefined;
      const resumeSince = sinceSeq && Number.isFinite(sinceSeq) ? sinceSeq : explicitSince;

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Trace-Id": ctx.traceId
      });

      // SSE 心跳：每 15s 发一个 ping comment line（: 开头的行被 EventSource 忽略，但能保活 LB/proxy）。
      heartbeatTimer = setInterval(() => {
        if (streamClosed || res.destroyed) return;
        try {
          res.write(`: ping ${Date.now()}\n\n`);
        } catch { /* socket already closed */ }
      }, sseHeartbeatMs);

      await withTimeout(
        a2uiChatController.stream(body, async (event, sseId) => {
          if (!streamClosed && !res.destroyed) sendSse(res, event.type, event, sseId);
          if (event.type === "a2ui_envelope") {
            metrics.inc("envelope_emitted_total", { tenant: authCtx?.tenantId });
          }
        }, { traceId: ctx.traceId, namespace: authCtx.tenantId, sinceSeq: resumeSince }),
        chatStreamTimeoutMs,
        "chat_stream_timeout"
      );
      streamClosed = true;
      res.end();
    } catch (error) {
      streamClosed = true;
      metrics.inc("chat_request_failed", { reason: errorReason(error) });
      if (!res.headersSent) {
        if (error instanceof AuthError) {
          sendJson(res, error.status, { error: "unauthorized", message: error.message, trace_id: ctx.traceId });
          return;
        }
        if (error instanceof RateLimitError) {
          res.setHeader("Retry-After", Math.ceil(error.retryAfterMs / 1000).toString());
          sendJson(res, 429, { error: "rate_limited", message: error.message, retry_after_ms: error.retryAfterMs, trace_id: ctx.traceId });
          return;
        }
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive"
        });
      }
      sendSse(res, "error", {
        type: "error",
        error: isBadRequestError(error) ? "bad_request" : "stream_error",
        message: error instanceof Error ? error.message : "unknown error",
        trace_id: ctx.traceId
      });
      res.end();
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      inFlight.delete(res);
      releaseStream?.();
      metrics.observe("stream_duration_ms", Date.now() - startedAt, { tenant: authCtx?.tenantId });
    }
    return;
  }

  sendJson(res, 404, { error: "not_found" });
});

server.listen(port, host, () => {
  console.log(`Enterprise Agent MVP listening on http://${host}:${port}`);
  const connectedMcp = mcp.statuses.filter((status) => status.connected).length;
  if (mcp.statuses.length) {
    console.log(`MCP servers: ${connectedMcp}/${mcp.statuses.length} connected`);
  }
});

let shuttingDown = false;
async function gracefulShutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  draining = true;
  logEvent("info", "shutdown_started", { signal, in_flight: inFlight.size });
  if (cronHeartbeat) clearInterval(cronHeartbeat);
  await mcp.registry.stop().catch(() => undefined);

  // 1. 停止接收新连接（已建立的请求继续跑直到完成或超时）
  server.close(() => {
    logEvent("info", "shutdown_listener_closed", {});
  });

  // 2. 等待 in-flight SSE 流自然结束，最多 shutdownDrainMs
  const deadline = Date.now() + shutdownDrainMs;
  while (inFlight.size > 0 && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 200));
  }

  // 3. 还没结束的强制断开，并下发一个 shutdown 事件让客户端走重连路径
  if (inFlight.size > 0) {
    logEvent("warn", "shutdown_forcing_streams", { remaining: inFlight.size });
    for (const res of inFlight) {
      try {
        if (!res.destroyed) {
          sendSse(res, "shutdown", { type: "shutdown", reason: "server_draining" });
          res.end();
        }
      } catch { /* already closed */ }
    }
  }

  logEvent("info", "shutdown_complete", { signal });
  process.exit(0);
}

process.on("SIGTERM", () => { void gracefulShutdown("SIGTERM"); });
process.on("SIGINT", () => { void gracefulShutdown("SIGINT"); });

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Last-Event-ID");
  res.setHeader("Access-Control-Expose-Headers", "X-Trace-Id");
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendSse(res: ServerResponse, event: unknown, payload: unknown, sseId?: string): void {
  if (sseId) res.write(`id: ${sseId}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function readPositiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function startCronHeartbeat(): NodeJS.Timeout | null {
  if (process.env.CRON_HEARTBEAT_DISABLED === "true") return null;
  const intervalMs = readPositiveNumberEnv("CRON_HEARTBEAT_MS", 60_000);
  const tick = async () => {
    const workspaces = await cronWorkspaces();
    for (const workspace of workspaces) {
      try {
        await cronRunner.runDue(workspace);
      } catch (error) {
        console.warn(`[cron] runDue failed for ${workspace.user_id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  const timer = setInterval(() => { void tick(); }, intervalMs);
  timer.unref();
  return timer;
}

async function cronWorkspaces(): Promise<WorkspaceContext[]> {
  try {
    const users = await loadJson<WecomUserRecord[]>(getResourceDataPath("employees") ?? "data/users.json");
    return users
      .filter((user) => typeof user.id === "string" && user.id.length > 0)
      .map((user) => resolveUserWorkspace(user.id as string));
  } catch (error) {
    console.warn(`[cron] failed to load users: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function shutdown(signal: string): Promise<void> {
  if (cronHeartbeat) clearInterval(cronHeartbeat);
  await mcp.registry.stop().catch(() => undefined);
  server.close(() => {
    console.log(`Enterprise Agent MVP stopped (${signal})`);
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, code: string): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function readJson(req: IncomingMessage): Promise<RequestBody> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  const parsed = raw ? JSON.parse(raw) : {};
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as RequestBody : {};
}

function readLastEventId(req: IncomingMessage): string {
  const value = req.headers["last-event-id"];
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length) return value[0];
  return "";
}

/**
 * 解析 ?range=1h|6h|30m，无值返回 null 表示用 collector 默认窗口。
 */
function parseRangeMs(range: string | null): number | null {
  if (!range) return null;
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(range.trim());
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = match[2];
  const factor = unit === "ms" ? 1 : unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return value * factor;
}

function isBadRequestError(error: unknown): boolean {
  return error instanceof A2UIBadRequestError || (Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === "bad_request");
}

function errorReason(error: unknown): string {
  if (error instanceof AuthError) return "auth";
  if (error instanceof RateLimitError) return "rate_limited";
  if (isBadRequestError(error)) return "bad_request";
  return "internal";
}

function stringFromUnknown(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function guardRequest(
  req: IncomingMessage,
  body: Record<string, unknown>,
  path: string,
  ctx: RequestContext,
  options: { skipUserQuota?: boolean } = {}
): AuthContext {
  const ip = readClientIp(req);
  try {
    rateLimiter.acquireIp(ip);
  } catch (error) {
    metrics.inc("rate_limited_total", { scope: "ip" });
    throw error;
  }
  let authCtx: AuthContext;
  try {
    authCtx = auth.authenticate(req, body);
  } catch (error) {
    metrics.inc("auth_failed_total", {});
    if (PROTECTED_PATHS.has(path)) throw error;
    throw error;
  }
  if (!options.skipUserQuota) {
    try {
      rateLimiter.acquireUser(authCtx.userId);
    } catch (error) {
      metrics.inc("rate_limited_total", { scope: "user", tenant: authCtx.tenantId });
      throw error;
    }
  }
  logEvent("info", "request_authorized", { trace_id: ctx.traceId, path, user_id: authCtx.userId, tenant: authCtx.tenantId });
  return authCtx;
}

function handleError(error: unknown, res: ServerResponse, ctx: RequestContext, fields: Record<string, unknown>): void {
  if (error instanceof AuthError) {
    sendJson(res, error.status, { error: "unauthorized", message: error.message, trace_id: ctx.traceId });
    return;
  }
  if (error instanceof RateLimitError) {
    res.setHeader("Retry-After", Math.ceil(error.retryAfterMs / 1000).toString());
    sendJson(res, 429, { error: "rate_limited", message: error.message, retry_after_ms: error.retryAfterMs, trace_id: ctx.traceId });
    return;
  }
  if (isBadRequestError(error)) {
    sendJson(res, 400, { error: "bad_request", message: error instanceof Error ? error.message : "bad request", trace_id: ctx.traceId });
    return;
  }
  logEvent("error", "request_failed", { trace_id: ctx.traceId, ...fields, error: error instanceof Error ? error.message : String(error) });
  sendJson(res, 500, { error: "internal_error", message: error instanceof Error ? error.message : "unknown error", trace_id: ctx.traceId });
}

interface AuthorizeResult {
  ok: boolean;
  status: number;
  code?: string;
  message?: string;
}

/**
 * 鉴权策略（生产可用，三档）：
 *   1. HANDLERS_API_PUBLIC=true → 任何人都能读（仅供本地调试）
 *   2. HANDLERS_API_USERS 包含 user_id（逗号分隔）→ 直接放行
 *   3. user.permissions 含 "runtime:inspect" → 放行
 * 都不命中 → 401 / 403。
 */
async function authorizeHandlersInspect(req: IncomingMessage, url: URL): Promise<AuthorizeResult> {
  if (process.env.HANDLERS_API_PUBLIC === "true") return { ok: true, status: 200 };
  const userId = (typeof req.headers["x-user-id"] === "string" ? req.headers["x-user-id"] : url.searchParams.get("user_id")) || "";
  if (!userId) return { ok: false, status: 401, code: "unauthorized", message: "请提供 X-User-Id 或 ?user_id=" };
  const allowlist = (process.env.HANDLERS_API_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allowlist.includes(userId)) return { ok: true, status: 200 };
  try {
    const user = await userContextResolver.resolve({ userId });
    if (Array.isArray(user.permissions) && user.permissions.includes("runtime:inspect")) {
      return { ok: true, status: 200 };
    }
    return { ok: false, status: 403, code: "forbidden", message: `用户 ${userId} 缺少 runtime:inspect 权限。` };
  } catch (error) {
    return { ok: false, status: 401, code: "unauthorized", message: error instanceof Error ? error.message : "unknown user" };
  }
}
