/**
 * Phase 2.5 smoke — 验证结构化抽取流水线：
 *   1) parseExtractionResult 接受合法 JSON、拒绝非法 schema；
 *   2) buildExtractionSystemPrompt 在词表为空时仍然产出可用 prompt，
 *      在词表非空时把白名单注入；
 *   3) MemoryLearner.applyExtraction 能把 entities + relations 通过
 *      memory-service stub 落库，并把 local_id 替换成 full_id。
 *
 * stub 用 node:http 起一个最小服务器，模拟 /v1/entities/resolve、
 * /v1/entities、/v1/relations 三个端点；不依赖真实数据库。
 */

import { createServer } from "node:http";
import { rm } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { MemoryLearner } from "../evolution/memory-learner.js";
import { __resetMemoryClientForTests } from "../memory/service-client.js";
import { parseExtractionResult } from "../evolution/structured-output.js";
import { buildExtractionSystemPrompt } from "../evolution/extraction-prompt.js";
import { EMPTY_EXTRACTION_CONTRACT } from "../engine/contracts/evolution-extraction-contract.js";
import type { UserContext } from "../types/agent-contracts.js";

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`, detail ?? ""); failed += 1; }
};

// ─── 1. parseExtractionResult ───────────────────────────────────────────────
const valid = parseExtractionResult(JSON.stringify({
  should_evolve: true,
  memory_actions: [{ op: "upsert", type: "preference", key: "answer_style", value: "short", confidence: 0.9 }],
  entities: [{ local_id: "c001", type: "customer", name: "张三", strong_attributes: { phone: "13800001234" } }],
  relations: [
    { subject: { local_id: "c001" }, predicate: "prefers", object_value: { brand: "Toyota" } }
  ]
}));
expect("valid JSON parses", valid.ok);
expect("entities preserved", valid.ok && valid.data.entities?.length === 1);

const badRelation = parseExtractionResult(JSON.stringify({
  relations: [{ subject: { local_id: "c001" }, predicate: "prefers" }]
}));
expect("relation without object/object_value rejected", !badRelation.ok);

const badJson = parseExtractionResult("{not json");
expect("malformed JSON rejected", !badJson.ok);

// ─── 2. buildExtractionSystemPrompt ─────────────────────────────────────────
const emptyPrompt = buildExtractionSystemPrompt({ contract: EMPTY_EXTRACTION_CONTRACT });
expect("empty contract prompt is non-empty", emptyPrompt.length > 200);
expect("empty contract mentions free-form fallback", emptyPrompt.includes("白名单未提供"));

const richPrompt = buildExtractionSystemPrompt({
  contract: {
    domainLabel: "test-domain",
    entityTypes: ["customer", "product"],
    predicates: ["ordered", "prefers"],
    strongAttributeKeys: ["phone", "email"],
    fewShotExamples: [{
      label: "demo",
      userMessage: "张三买了汉EV",
      assistantAnswer: "好的",
      expectedJson: "{}"
    }]
  }
});
expect("rich prompt includes entity types", richPrompt.includes("- customer") && richPrompt.includes("- product"));
expect("rich prompt includes predicates", richPrompt.includes("- ordered"));
expect("rich prompt includes strong attribute keys", richPrompt.includes("- phone"));
expect("rich prompt includes few-shot label", richPrompt.includes("### demo"));

// ─── 3. MemoryLearner.applyExtraction with stub memory-service ──────────────
const captured: { method: string; url: string; body: string }[] = [];
const server = createServer((req, res) => {
  let chunks = "";
  req.on("data", (c) => { chunks += c; });
  req.on("end", () => {
    captured.push({ method: req.method ?? "", url: req.url ?? "", body: chunks });
    if (req.url === "/v1/entities/resolve" && req.method === "POST") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, matched: null, candidates: [] }));
      return;
    }
    if (req.url === "/v1/entities" && req.method === "POST") {
      const parsed = JSON.parse(chunks) as { local_id: string; type: string; name: string };
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, entity: {
        id: `biz_smoke:${parsed.local_id}`,
        business_id: "biz_smoke",
        type: parsed.type,
        name: parsed.name,
        aliases: [], external_ids: {}, attributes: {},
        embedding_model: null, embedded_at: null,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
        merged_into: null
      }}));
      return;
    }
    if (req.url === "/v1/relations" && req.method === "POST") {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, relation: {
        id: "11111111-1111-1111-1111-111111111111", business_id: "biz_smoke",
        subject_id: "x", predicate: "x", object_id: null, object_value: null,
        occurred_at: null, source_memory_id: null, confidence: 1, metadata: {},
        created_at: "2026-01-01T00:00:00Z"
      }}));
      return;
    }
    if (req.url === "/v1/memories" && req.method === "POST") {
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, memory: {
        id: "22222222-2222-2222-2222-222222222222",
        category: "fact", name: "n", content: "c", tags: [], metadata: {},
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
        description: null, source: null, confidence: 1,
        expired_at: null, embedding_model: null, embedded_at: null
      }}));
      return;
    }
    res.writeHead(500); res.end("unexpected: " + req.url);
  });
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const addr = server.address();
const port = typeof addr === "object" && addr ? addr.port : 0;

process.env.MEMORY_SERVICE_URL = `http://127.0.0.1:${port}`;
process.env.MEMORY_SERVICE_SECRET = "smoke-secret";
process.env.MEMORY_SERVICE_DEFAULT_BUSINESS_ID = "biz_smoke";
__resetMemoryClientForTests();

const user: UserContext = {
  id: `eval_extract_${Date.now()}`,
  name: "Extraction Smoke",
  role: "eval",
  permissions: [],
  accessible_customer_ids: [],
  business_id: "biz_smoke"
} as UserContext;
const workspace = resolveUserWorkspace(user);

try {
  const learner = new MemoryLearner();
  const result = await learner.applyExtraction({
    workspace,
    user,
    extraction: {
      memory_actions: [
        { op: "upsert", type: "preference", key: "tone", value: "short", confidence: 0.9 }
      ],
      entities: [
        { local_id: "c001", type: "customer", name: "张三", strong_attributes: { phone: "13800001234" } },
        { local_id: "p_han_ev", type: "product", name: "汉EV" }
      ],
      relations: [
        { subject: { local_id: "c001" }, predicate: "ordered", object: { local_id: "p_han_ev" } },
        { subject: { local_id: "c001" }, predicate: "prefers", object_value: { brand: "BYD" } }
      ]
    }
  });
  expect("memory_actions applied", result.memory_changed === 1);
  expect("two entities written", result.entities_written === 2);
  expect("two relations written", result.relations_written === 2);
  expect("no errors", result.errors.length === 0, result.errors);

  const relPosts = captured.filter((c) => c.url === "/v1/relations" && c.method === "POST");
  expect("relations carry full_id (not local_id)", relPosts.every((c) => {
    const body = JSON.parse(c.body) as { subject_id: string };
    return body.subject_id === "biz_smoke:c001";
  }));
  const orderRel = relPosts.find((c) => JSON.parse(c.body).predicate === "ordered");
  expect("ordered relation references resolved object_id", Boolean(orderRel) && JSON.parse(orderRel!.body).object_id === "biz_smoke:p_han_ev");
  const prefersRel = relPosts.find((c) => JSON.parse(c.body).predicate === "prefers");
  expect("prefers relation carries object_value literal", Boolean(prefersRel) && JSON.parse(prefersRel!.body).object_value?.brand === "BYD");

  // unresolved local_id surfaces as error, doesn't crash
  const dangling = await learner.applyExtraction({
    workspace,
    user,
    extraction: {
      relations: [
        { subject: { local_id: "ghost" }, predicate: "x", object_value: { foo: 1 } }
      ]
    }
  });
  expect("dangling local_id captured as error", dangling.errors.some((e) => e.includes("relation_subject_unresolved")));
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(resolveProjectPath("users", workspace.user_id), { recursive: true, force: true });
  delete process.env.MEMORY_SERVICE_URL;
  delete process.env.MEMORY_SERVICE_SECRET;
  delete process.env.MEMORY_SERVICE_DEFAULT_BUSINESS_ID;
  __resetMemoryClientForTests();
}

if (failed > 0) {
  console.error(`\n${failed} extraction smoke check(s) failed`);
  process.exit(1);
}
console.log("\nPASS evolution extraction smoke");
