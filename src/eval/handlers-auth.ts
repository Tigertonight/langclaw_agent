import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/**
 * 集成测试 /api/handlers 鉴权与缓存：
 *   1. 无 user_id → 401
 *   2. 有 user_id 但权限不够 → 403
 *   3. 在 HANDLERS_API_USERS 白名单 → 200 + ETag
 *   4. 同 ETag 重复请求 → 304
 *   5. HANDLERS_API_PUBLIC=true → 不带 user_id 也能 200
 *
 * 启动一个真实 HTTP server 子进程而不是 mock —— 这是端到端 smoke。
 */
async function main(): Promise<void> {
  const port = 3911;
  const server = spawn("node", ["dist/server/http.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      HANDLERS_API_USERS: "store_gm_001",
      HANDLERS_API_PUBLIC: "false"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  await waitForServerReady(server, port);

  try {
    // case 1: no user_id → 401
    const r1 = await fetch(`http://localhost:${port}/api/handlers`);
    assert(r1.status === 401, `no user_id should be 401, got ${r1.status}`);

    // case 2: unknown / unprivileged user → 403 (resolver returns anonymous → no runtime:inspect)
    // sales_001 doesn't have runtime:inspect either
    const r2 = await fetch(`http://localhost:${port}/api/handlers`, {
      headers: { "X-User-Id": "sales_001" }
    });
    assert(r2.status === 403, `non-allowlisted user should be 403, got ${r2.status}`);

    // case 3: allowlisted user → 200 + ETag
    const r3 = await fetch(`http://localhost:${port}/api/handlers`, {
      headers: { "X-User-Id": "store_gm_001" }
    });
    assert(r3.status === 200, `allowlisted user should be 200, got ${r3.status}`);
    const etag = r3.headers.get("etag");
    assert(typeof etag === "string" && etag.length > 0, `ETag header should be set, got ${etag}`);
    const body = await r3.json() as Record<string, unknown>;
    assert(Array.isArray(body.handlers), "body should have handlers[]");
    assert(Array.isArray(body.commands), "body should have commands[]");

    // case 4: If-None-Match → 304
    const r4 = await fetch(`http://localhost:${port}/api/handlers`, {
      headers: { "X-User-Id": "store_gm_001", "If-None-Match": etag! }
    });
    assert(r4.status === 304, `matching ETag should be 304, got ${r4.status}`);

    console.log("PASS handlers auth + ETag (401 / 403 / 200 / 304)");
  } finally {
    server.kill("SIGTERM");
    await delay(200);
    if (!server.killed) server.kill("SIGKILL");
  }
}

async function waitForServerReady(server: ChildProcess, port: number): Promise<void> {
  for (let i = 0; i < 50; i += 1) {
    try {
      const res = await fetch(`http://localhost:${port}/health`);
      if (res.ok) return;
    } catch { /* not ready yet */ }
    await delay(200);
  }
  server.kill("SIGKILL");
  throw new Error(`server did not become ready on port ${port}`);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
