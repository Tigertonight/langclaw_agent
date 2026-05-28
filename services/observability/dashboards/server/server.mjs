/**
 * Dashboards 后端 = 静态资源服务 + 极简管理员 cookie auth + Langfuse Public API 反向代理。
 *
 * 设计要点：
 *   - 端口：4401（dev）；prod 一进程贴 dist/ + 处理 /api/*
 *   - 认证：单一 admin secret 验通过后下发 HMAC 签名 cookie，不引外部 IdP
 *   - 代理：所有 /api/langfuse/* 转发到 LANGFUSE_HOST，注入 Basic auth；
 *     Secret/Public key 永远停在服务端
 *
 * 不在本期范围：多用户、RBAC、SSO —— Phase 3 客户开放时再做
 */

import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.DASHBOARD_PORT ?? 4401);
const ADMIN_SECRET = process.env.DASHBOARD_ADMIN_SECRET;
const COOKIE_SECRET = process.env.DASHBOARD_AUTH_SECRET;
const LANGFUSE_HOST = process.env.DASHBOARD_LANGFUSE_API_URL;
const LANGFUSE_PK = process.env.DASHBOARD_PUBLIC_KEY;
const LANGFUSE_SK = process.env.DASHBOARD_SECRET_KEY;

if (!ADMIN_SECRET || !COOKIE_SECRET || !LANGFUSE_HOST || !LANGFUSE_PK || !LANGFUSE_SK) {
  console.error(
    "Missing env: DASHBOARD_ADMIN_SECRET / DASHBOARD_AUTH_SECRET / " +
      "DASHBOARD_LANGFUSE_API_URL / DASHBOARD_PUBLIC_KEY / DASHBOARD_SECRET_KEY"
  );
  process.exit(2);
}

const COOKIE_NAME = "obs_admin";
const COOKIE_MAX_AGE = 12 * 60 * 60 * 1000; // 12 小时

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", COOKIE_SECRET)
    .update(body)
    .digest("base64url");
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto
    .createHmac("sha256", COOKIE_SECRET)
    .update(body)
    .digest("base64url");
  if (
    sig.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))
  ) {
    return null;
  }
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (typeof payload.exp !== "number" || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function requireAdmin(req, res, next) {
  const payload = verify(req.cookies[COOKIE_NAME]);
  if (!payload) return res.status(401).json({ error: "unauthorized" });
  req.admin = payload;
  next();
}

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(cookieParser());

// ─── Auth ────────────────────────────────────────────────────────────────
app.post("/api/auth/login", (req, res) => {
  const { secret } = req.body ?? {};
  if (typeof secret !== "string" || secret.length === 0) {
    return res.status(400).json({ error: "missing secret" });
  }
  // timing-safe compare
  const a = Buffer.from(secret);
  const b = Buffer.from(ADMIN_SECRET);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "invalid secret" });
  }
  const token = sign({ role: "admin", exp: Date.now() + COOKIE_MAX_AGE });
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    maxAge: COOKIE_MAX_AGE,
    secure: process.env.NODE_ENV === "production"
  });
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie(COOKIE_NAME);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  const payload = verify(req.cookies[COOKIE_NAME]);
  if (!payload) return res.status(401).json({ authenticated: false });
  res.json({ authenticated: true, role: payload.role });
});

// ─── Langfuse proxy ──────────────────────────────────────────────────────
const lfAuth = "Basic " + Buffer.from(`${LANGFUSE_PK}:${LANGFUSE_SK}`).toString("base64");

app.use("/api/langfuse", requireAdmin, async (req, res) => {
  // 直接拼路径（已带 /api/public/...），保留 query string
  const upstreamPath = req.originalUrl.replace(/^\/api\/langfuse/, "/api/public");
  const url = `${LANGFUSE_HOST}${upstreamPath}`;
  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: {
        Authorization: lfAuth,
        "Content-Type": req.headers["content-type"] ?? "application/json"
      },
      body: ["GET", "HEAD"].includes(req.method) ? undefined : JSON.stringify(req.body)
    });
    res.status(upstream.status);
    const ct = upstream.headers.get("content-type");
    if (ct) res.setHeader("content-type", ct);
    const text = await upstream.text();
    res.send(text);
  } catch (e) {
    console.warn("[dashboards] langfuse proxy error:", e);
    res.status(502).json({ error: "upstream unavailable" });
  }
});

// ─── 静态资源（生产环境）────────────────────────────────────────────────
const distDir = path.resolve(__dirname, "..", "dist");
app.use(express.static(distDir));
// SPA fallback：非 /api 的都回 index.html
app.get(/^(?!\/api).*/, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"), (err) => {
    if (err) res.status(404).end();
  });
});

app.listen(PORT, () => {
  console.log(`[dashboards] listening on :${PORT}`);
});
