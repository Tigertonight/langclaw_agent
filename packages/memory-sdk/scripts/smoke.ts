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
expect("11 tools registered", tools.length === 11);
const names = new Set(tools.map((t) => t.name));
for (const expectedName of [
  "memory_search", "memory_grep", "memory_create", "memory_update", "memory_delete",
  "document_grep", "document_get",
  "entity_get", "entity_resolve", "query_relations", "create_relation"
]) {
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
    if (req.url === "/v1/entities" && req.method === "POST") {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, entity: {
        id: "biz1:customer:c001", business_id: "biz1", type: "customer", name: "n",
        aliases: [], external_ids: { crm_id: "X" }, attributes: {},
        embedding_model: null, embedded_at: null,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", merged_into: null
      }}));
      return;
    }
    if (req.url === "/v1/entities/resolve" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, matched: null, candidates: [
        { entity: { id: "biz1:customer:c001", business_id: "biz1", type: "customer", name: "n", aliases: [], external_ids: {}, attributes: {}, embedding_model: null, embedded_at: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", merged_into: null }, score: 0.4, reasons: ["attributes.email=a@b.com"] }
      ]}));
      return;
    }
    if (req.url === "/v1/relations/query" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, items: [{
        id: "33333333-3333-3333-3333-333333333333", business_id: "biz1",
        subject_id: "biz1:customer:c001", predicate: "ordered",
        object_id: "biz1:product:p1", object_value: null,
        occurred_at: null, source_memory_id: null, confidence: 1, metadata: {},
        created_at: "2026-01-01T00:00:00Z"
      }], next_cursor: null }));
      return;
    }
    if (req.url === "/v1/relations" && req.method === "POST") {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, relation: {
        id: "44444444-4444-4444-4444-444444444444", business_id: "biz1",
        subject_id: "biz1:customer:c001", predicate: "prefers",
        object_id: null, object_value: { brand: "Toyota" },
        occurred_at: null, source_memory_id: null, confidence: 1, metadata: {},
        created_at: "2026-01-01T00:00:00Z"
      }}));
      return;
    }
    if (req.url === "/v1/entities/biz1:customer:c001/merge" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, target: { id: "biz1:customer:c001" }, source: { id: "biz1:customer:c002" }, relations_migrated: 3, log: { id: "55555555-5555-5555-5555-555555555555" } }));
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

// Phase 2: entities / relations
const entity = await realClient.upsertEntity(ctx, {
  local_id: "customer:c001", type: "customer", name: "n",
  external_ids: { crm_id: "X" }
});
expect("upsertEntity returns full id", entity.id === "biz1:customer:c001");
const lastUpsert = captured[captured.length - 1]!;
expect("upsertEntity posts to /v1/entities", lastUpsert.url === "/v1/entities" && lastUpsert.method === "POST");
expect("upsertEntity body has local_id", lastUpsert.body.includes("\"local_id\":\"customer:c001\""));

const resolved = await realClient.resolveEntity(ctx, {
  type: "customer", strong_attributes: { email: "a@b.com" }
});
expect("resolveEntity returns candidates", resolved.candidates.length === 1);
expect("resolveEntity candidate has reasons", resolved.candidates[0]!.reasons.length > 0);
expect("resolveEntity matched=null below threshold", resolved.matched === null);

const rels = await realClient.queryRelations(ctx, { subject_id: "biz1:customer:c001" });
expect("queryRelations returns 1 item", rels.items.length === 1);
expect("queryRelations item has predicate", rels.items[0]!.predicate === "ordered");

const newRel = await realClient.createRelation(ctx, {
  subject_id: "biz1:customer:c001", predicate: "prefers",
  object_value: { brand: "Toyota" }
});
expect("createRelation returns relation", newRel.id === "44444444-4444-4444-4444-444444444444");

const merged = await realClient.mergeEntity(ctx, "biz1:customer:c001", {
  source_id: "biz1:customer:c002", reason: "duplicate"
});
expect("mergeEntity returns relations_migrated", merged.relations_migrated === 3);
expect("mergeEntity returns log", merged.log.id === "55555555-5555-5555-5555-555555555555");

// Phase 2 tools wired through MemoryClient
const newTools = buildMemoryTools({ client: realClient });
const resolveTool = newTools.find((t) => t.name === "entity_resolve")!;
const toolResolved = await resolveTool.invoke(ctx, { type: "customer", strong_attributes: { email: "a@b.com" } }) as typeof resolved;
expect("entity_resolve tool invokes correctly", toolResolved.candidates.length === 1);
const queryTool = newTools.find((t) => t.name === "query_relations")!;
const toolRels = await queryTool.invoke(ctx, { subject_id: "biz1:customer:c001" }) as typeof rels;
expect("query_relations tool invokes correctly", toolRels.items.length === 1);

await new Promise<void>((resolve) => server.close(() => resolve()));

if (failed > 0) {
  console.error(`\n${failed} sdk smoke check(s) failed`);
  process.exit(1);
}
console.log("\nall sdk smoke checks passed");
