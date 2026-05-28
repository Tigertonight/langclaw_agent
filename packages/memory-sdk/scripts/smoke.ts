/**
 * SDK unit smoke. Verifies IdentityProvider produces a valid token (signature
 * verifiable with the same secret), tool definitions are well-formed, and
 * MemoryClient correctly serializes requests against a stub Fastify-style
 * server. We don't need a real memory-service running.
 */

import { createServer } from "node:http";
import { createHmac } from "node:crypto";
import { IdentityProvider, MemoryClient, buildMemoryTools, MemoryServiceError } from "../src/index.js";

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`, detail ?? ""); failed += 1; }
};

const SECRET = "smoke-secret-xyz";

// ─── 1. IdentityProvider produces verifiable token ──────────────────────────
const ip = new IdentityProvider({ secret: SECRET, defaultAgentId: "openclaw" });
const token = ip.sign({ business_id: "biz1", user_id: "u1" });
const [payload, sig] = token.split(".");
expect("token has payload.sig shape", !!payload && !!sig);
const expected = createHmac("sha256", SECRET).update(payload!).digest("base64url");
expect("signature verifies", expected === sig);
const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8"));
expect("decoded carries business_id", decoded.business_id === "biz1");
expect("decoded carries user_id", decoded.user_id === "u1");
expect("default agent_id injected", decoded.agent_id === "openclaw");
expect("issued_at present", typeof decoded.issued_at === "number");

// ─── 2. Tool defs ───────────────────────────────────────────────────────────
const client = new MemoryClient({ baseUrl: "http://localhost:0", identityProvider: ip });
const tools = buildMemoryTools({ client });
expect("7 tools registered", tools.length === 7);
const names = new Set(tools.map((t) => t.name));
for (const expectedName of ["memory_search", "memory_grep", "memory_create", "memory_update", "memory_delete", "document_grep", "document_get"]) {
  expect(`tool ${expectedName} present`, names.has(expectedName));
}
for (const t of tools) {
  expect(`tool ${t.name} has params object`, t.parameters && typeof t.parameters === "object");
  expect(`tool ${t.name} has invoke fn`, typeof t.invoke === "function");
}

// ─── 3. MemoryClient end-to-end against stub HTTP server ────────────────────
const captured: { method: string; url: string; headers: Record<string, string>; body: string }[] = [];
const server = createServer((req, res) => {
  let chunks = "";
  req.on("data", (c) => { chunks += c; });
  req.on("end", () => {
    captured.push({
      method: req.method ?? "",
      url: req.url ?? "",
      headers: req.headers as Record<string, string>,
      body: chunks
    });
    if (req.url === "/v1/memories" && req.method === "POST") {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, memory: { id: "11111111-1111-1111-1111-111111111111", category: "fact", name: "n", content: "c", tags: [], metadata: {}, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", description: null, source: null, confidence: 1, expired_at: null, embedding_model: null, embedded_at: null }, embedding_status: "queued" }));
      return;
    }
    if (req.url === "/v1/knowledge/search" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, items: [{ id: "x", source: "memory", content: "hit", score: 0.9 }] }));
      return;
    }
    if (req.url === "/v1/memories/22222222-2222-2222-2222-222222222222" && req.method === "DELETE") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, deleted: true }));
      return;
    }
    if (req.url === "/v1/messages/batch" && req.method === "POST") {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, inserted: 2 }));
      return;
    }
    if (req.url === "/healthz") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, status: "alive" }));
      return;
    }
    if (req.url === "/v1/memories/error-test" && req.method === "GET") {
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "not_found", message: "memory not found" }));
      return;
    }
    res.writeHead(500); res.end("unexpected: " + req.url);
  });
});

await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const addr = server.address();
const port = typeof addr === "object" && addr ? addr.port : 0;

const realClient = new MemoryClient({ baseUrl: `http://127.0.0.1:${port}`, identityProvider: ip });
const ctx = { business_id: "biz1", user_id: "u1" };

// createMemory
const created = await realClient.createMemory(ctx, { category: "fact", name: "n", content: "c" });
expect("createMemory returns record", created.id === "11111111-1111-1111-1111-111111111111");
const lastCreate = captured[captured.length - 1]!;
expect("create posts to /v1/memories", lastCreate.url === "/v1/memories" && lastCreate.method === "POST");
expect("create body contains category", lastCreate.body.includes("\"category\":\"fact\""));
expect("create carries identity header", typeof lastCreate.headers["x-memory-identity"] === "string");

// searchKnowledge
const hits = await realClient.searchKnowledge(ctx, { query: "test", top_k: 5 });
expect("knowledge search returns hits", hits.length === 1 && hits[0]?.source === "memory");

// deleteMemory
await realClient.deleteMemory(ctx, "22222222-2222-2222-2222-222222222222");
const lastDel = captured[captured.length - 1]!;
expect("delete uses DELETE method", lastDel.method === "DELETE");

// batchMessages
const batchRes = await realClient.batchMessages(ctx, [
  { session_id: "s1", turn_index: 0, role: "user", content: "hi" },
  { session_id: "s1", turn_index: 1, role: "assistant", content: "hello" }
]);
expect("batch returns inserted=2", batchRes.inserted === 2);

// healthz (no identity)
const health = await realClient.healthz();
expect("healthz returns alive", JSON.stringify(health).includes("alive"));
const lastHealth = captured[captured.length - 1]!;
expect("healthz omits identity header", !lastHealth.headers["x-memory-identity"]);

// error mapping
let caught: unknown = null;
try {
  await realClient.getMemory(ctx, "error-test");
} catch (err) { caught = err; }
expect("404 surfaces as MemoryServiceError", caught instanceof MemoryServiceError && (caught as MemoryServiceError).statusCode === 404);

await new Promise<void>((resolve) => server.close(() => resolve()));

if (failed > 0) {
  console.error(`\n${failed} sdk smoke check(s) failed`);
  process.exit(1);
}
console.log("\nall sdk smoke checks passed");
