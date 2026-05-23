import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { createApp } from "../app.js";
import { createA2UIModule } from "../a2ui/module.js";
import { A2UIBadRequestError } from "../a2ui/dto.js";
import { loadJson } from "../data/load-json.js";
import { renderChatPage } from "./chat-page.js";
import { handlerManifestRegistry } from "../handlers/handler-manifest.js";
import type { JsonObject } from "../types/agent-contracts.js";

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

const { agent, queryEngine, skillRegistry, skillLoader, userContextResolver, toolRegistry, intentRegistry, intentRouter } = createApp();
const { chatController: a2uiChatController } = createA2UIModule({
  queryEngine,
  streamAgent: agent,
  toolRegistry,
  userContextResolver
});
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const chatStreamTimeoutMs = readPositiveNumberEnv("CHAT_STREAM_TIMEOUT_MS", 60000);

const server = http.createServer(async (req: IncomingMessage, res: ServerResponse) => {
  setCors(res);
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && pathname === "/health") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === "GET" && (pathname === "/" || pathname === "/chat")) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(renderChatPage());
    return;
  }

  if (req.method === "GET" && pathname === "/api/wecom-users") {
    const users = await loadJson<WecomUserRecord[]>("data/wecom-users.json");
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

  if (req.method === "POST" && pathname === "/api/a2ui/action") {
    try {
      const body = await readJson(req);
      const result = await a2uiChatController.action(body);
      sendJson(res, result.ok === false ? 400 : 200, result);
    } catch (error) {
      sendJson(res, isBadRequestError(error) ? 400 : 500, {
        error: isBadRequestError(error) ? "bad_request" : "a2ui_action_failed",
        message: error instanceof Error ? error.message : "unknown error"
      });
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
      sendJson(res, 200, await a2uiChatController.chat(body));
    } catch (error) {
      sendJson(res, isBadRequestError(error) ? 400 : 500, {
        error: isBadRequestError(error) ? "bad_request" : "internal_error",
        message: error instanceof Error ? error.message : "unknown error"
      });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/chat/stream") {
    let streamClosed = false;
    try {
      const body = await readJson(req);
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      });

      await withTimeout(a2uiChatController.stream(body, async (event) => {
          if (!streamClosed && !res.destroyed) sendSse(res, event.type, event);
      }), chatStreamTimeoutMs, "chat_stream_timeout");
      streamClosed = true;
      res.end();
    } catch (error) {
      streamClosed = true;
      if (!res.headersSent) {
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive"
        });
      }
      sendSse(res, "error", {
        type: "error",
        error: isBadRequestError(error) ? "bad_request" : "stream_error",
        message: error instanceof Error ? error.message : "unknown error"
      });
      res.end();
    }
    return;
  }

  sendJson(res, 404, { error: "not_found" });
});

server.listen(port, host, () => {
  console.log(`Enterprise Agent MVP listening on http://${host}:${port}`);
});

function setCors(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendSse(res: ServerResponse, event: unknown, payload: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function readPositiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
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

function isBadRequestError(error: unknown): boolean {
  return error instanceof A2UIBadRequestError || (Boolean(error) && typeof error === "object" && (error as { code?: unknown }).code === "bad_request");
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
