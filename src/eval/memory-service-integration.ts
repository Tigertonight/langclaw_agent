/**
 * Phase 1.12 — OpenClaw integration smoke.
 *
 * Boots a stub HTTP server that mimics memory-service /v1/memories, configures
 * the env so getMemoryClient() picks it up, then runs MemoryLearner.apply()
 * with a UserContext carrying business_id. Verifies that:
 *   1. local file was written (the file path stays authoritative)
 *   2. the dual-write hit the stub server
 *   3. tokens carry the right business_id / user_id / agent_id
 *   4. failures from the remote do not break the local apply path
 */

import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { MemoryLearner } from "../evolution/memory-learner.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { __resetMemoryClientForTests } from "../memory/service-client.js";
import type { UserContext } from "../types/agent-contracts.js";

const SECRET = "integration-smoke-secret";

interface CapturedReq {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`, detail ?? ""); failed += 1; }
};

async function main(): Promise<void> {
  const captured: CapturedReq[] = [];
  let nextStatus = 201;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      captured.push({
        method: req.method ?? "",
        url: req.url ?? "",
        headers: req.headers as Record<string, string>,
        body
      });
      if (req.url === "/v1/memories" && req.method === "POST") {
        res.writeHead(nextStatus, { "content-type": "application/json" });
        if (nextStatus >= 400) {
          res.end(JSON.stringify({ ok: false, error: "boom" }));
        } else {
          res.end(JSON.stringify({
            ok: true,
            memory: {
              id: "00000000-0000-0000-0000-000000000001",
              category: "fact", name: "x", content: "y", tags: [], metadata: {},
              created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
              description: null, source: null, confidence: 1, expired_at: null,
              embedding_model: null, embedded_at: null
            },
            embedding_status: "queued"
          }));
        }
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;

  process.env.MEMORY_SERVICE_URL = `http://127.0.0.1:${port}`;
  process.env.MEMORY_SERVICE_SECRET = SECRET;
  process.env.MEMORY_SERVICE_AGENT = "openclaw-test";
  __resetMemoryClientForTests();

  const user: UserContext = {
    id: `mem_svc_smoke_${Date.now()}`,
    role: "eval",
    business_id: "dealer_smoke_001",
    agent_id: "openclaw-test"
  };
  const workspace = resolveUserWorkspace(user);

  try {
    // ── Case 1: happy path ───────────────────────────────────────────────
    const learner = new MemoryLearner();
    const changed = await learner.apply({
      workspace,
      user,
      actions: [{
        op: "upsert",
        type: "preference",
        key: "smoke_preference",
        value: "用户偏好深色主题",
        confidence: 0.95
      }, {
        op: "upsert",
        type: "fact",
        key: "smoke_fact",
        value: "演示账户位于上海",
        confidence: 0.9
      }]
    });
    expect("apply returns changed=2", changed === 2);
    // local file written?
    const filePath = `${workspace.memory_dir}/memory.json`;
    expect("local file written", existsSync(filePath));
    const fileJson = JSON.parse(readFileSync(filePath, "utf8"));
    expect("local items contain smoke_preference", fileJson.items?.some((i: { key: string }) => i.key === "smoke_preference"));

    // wait briefly for fire-and-forget mirror to land
    await new Promise((r) => setTimeout(r, 200));

    expect("mirror fired 2 POSTs", captured.length === 2, { count: captured.length });
    expect("mirror posts to /v1/memories", captured.every((c) => c.url === "/v1/memories" && c.method === "POST"));
    expect("mirror carries identity header", captured.every((c) => typeof c.headers["x-memory-identity"] === "string"));

    // identity contains business_id + user_id + agent_id
    const tok = captured[0]!.headers["x-memory-identity"]!;
    const [payload] = tok.split(".");
    const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
    expect("token business_id matches user", decoded.business_id === "dealer_smoke_001");
    expect("token user_id matches workspace", decoded.user_id === workspace.user_id);
    expect("token agent_id forwarded", decoded.agent_id === "openclaw-test");

    // category mapping: preference→user, fact→fact
    const bodies = captured.map((c) => JSON.parse(c.body));
    expect("preference mapped to category=user", bodies.some((b) => b.name === "smoke_preference" && b.category === "user"));
    expect("fact mapped to category=fact", bodies.some((b) => b.name === "smoke_fact" && b.category === "fact"));

    // ── Case 2: remote failure does not break apply ──────────────────────
    captured.length = 0;
    nextStatus = 500;
    const failChanged = await learner.apply({
      workspace,
      user,
      actions: [{
        op: "upsert",
        type: "fact",
        key: "smoke_resilience",
        value: "服务挂了也不能阻塞主链路",
        confidence: 0.9
      }]
    });
    expect("apply still returns changed=1 on remote failure", failChanged === 1);
    await new Promise((r) => setTimeout(r, 200));
    // local persisted regardless
    const file2 = JSON.parse(readFileSync(filePath, "utf8"));
    expect("local persists despite remote failure",
      file2.items?.some((i: { key: string }) => i.key === "smoke_resilience"));
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    delete process.env.MEMORY_SERVICE_URL;
    delete process.env.MEMORY_SERVICE_SECRET;
    delete process.env.MEMORY_SERVICE_AGENT;
    __resetMemoryClientForTests();
    await rm(workspace.root, { recursive: true, force: true }).catch(() => undefined);
  }

  if (failed > 0) {
    console.error(`\n${failed} integration smoke check(s) failed`);
    process.exit(1);
  }
  console.log("\nall memory-service integration smoke checks passed");
}

main().catch((err) => { console.error(err); process.exit(1); });
