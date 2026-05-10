import http from "node:http";
import { createApp } from "../app.js";
import { loadJson } from "../data/load-json.js";
import { renderChatPage } from "./chat-page.js";

const { agent, skillRegistry, skillLoader, userContextResolver } = createApp();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";
const chatStreamTimeoutMs = readPositiveNumberEnv("CHAT_STREAM_TIMEOUT_MS", 60000);

const server = http.createServer(async (req, res) => {
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
    const users = await loadJson("data/wecom-users.json");
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
      sendJson(res, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "unknown error"
      });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/skills/install") {
    try {
      const body = await readJson(req);
      if (!body.path) {
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
      if (!body.user_id || !body.message) {
        sendJson(res, 400, { error: "bad_request", message: "user_id 和 message 必填。" });
        return;
      }
      const result = await agent.run({
        userId: body.user_id,
        userContext: body.user_context,
        wecomUserId: body.wecom_userid,
        message: body.message,
        sessionId: body.session_id,
        debug: body.debug === true
      });
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 500, {
        error: "internal_error",
        message: error instanceof Error ? error.message : "unknown error"
      });
    }
    return;
  }

  if (req.method === "POST" && pathname === "/api/chat/stream") {
    let streamClosed = false;
    try {
      const body = await readJson(req);
      if (!body.user_id || !body.message) {
        sendJson(res, 400, { error: "bad_request", message: "user_id 和 message 必填。" });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive"
      });

      await withTimeout(agent.runStream({
        userId: body.user_id,
        userContext: body.user_context,
        wecomUserId: body.wecom_userid,
        message: body.message,
        sessionId: body.session_id,
        debug: body.debug === true,
        onEvent: (event) => {
          if (!streamClosed && !res.destroyed) sendSse(res, event.type, event);
        }
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

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function readPositiveNumberEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function withTimeout(promise, timeoutMs, code) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(code)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}
