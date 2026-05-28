/**
 * Phase 2.2 — entities/relations route smoke against the real Postgres.
 * Requires `npm run migrate` to have applied 0002_phase2_entities.sql.
 *
 * Cleans up its own writes via `business_id` filter so reruns are idempotent.
 */

import { buildServer } from "../src/http/server.js";
import { signIdentity } from "../src/http/identity.js";
import { loadConfig } from "../src/config/env.js";
import { pool } from "../src/db/pool.js";

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`, detail ?? ""); failed += 1; }
};

const BIZ_A = "smoke_phase2_a";
const BIZ_B = "smoke_phase2_b";

async function cleanup(): Promise<void> {
  // delete in dependency order so FK constraints don't bite
  await pool.query("DELETE FROM relations WHERE business_id = ANY($1)", [[BIZ_A, BIZ_B]]);
  await pool.query("DELETE FROM entities  WHERE business_id = ANY($1)", [[BIZ_A, BIZ_B]]);
}

async function main(): Promise<void> {
  loadConfig();
  await cleanup();
  const app = await buildServer();

  const identityA = signIdentity({
    business_id: BIZ_A, user_id: "u_1", agent_id: "openclaw",
    issued_at: Math.floor(Date.now() / 1000), scope: []
  });
  const identityB = signIdentity({
    business_id: BIZ_B, user_id: "u_2",
    issued_at: Math.floor(Date.now() / 1000), scope: []
  });

  // ===== entities =====

  // 1. create / upsert
  const createRes = await app.inject({
    method: "POST", url: "/v1/entities",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: {
      local_id: "customer:c001",
      type: "customer",
      name: "张三",
      aliases: ["Zhang San", "张总"],
      external_ids: { crm_id: "CRM-1001", phone: "13800001234" },
      attributes: { vip: true, channel: "showroom" }
    }
  });
  expect("POST entity → 201", createRes.statusCode === 201, createRes.body);
  const entA = createRes.json().entity;
  expect("entity.id has tenant prefix", entA?.id === `${BIZ_A}:customer:c001`);
  expect("entity.aliases echoed", Array.isArray(entA?.aliases) && entA.aliases.length === 2);
  expect("external_ids.crm_id echoed", entA?.external_ids?.crm_id === "CRM-1001");

  // 2. upsert merges external_ids + attributes (jsonb concat)
  const upsertRes = await app.inject({
    method: "POST", url: "/v1/entities",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: {
      local_id: "customer:c001",
      type: "customer",
      name: "张三（更新）",
      external_ids: { dms_id: "DMS-77" },
      attributes: { last_visit: "2026-05-20" }
    }
  });
  expect("upsert → 201", upsertRes.statusCode === 201, upsertRes.body);
  const upserted = upsertRes.json().entity;
  expect("upsert merges external_ids", upserted.external_ids?.crm_id === "CRM-1001" && upserted.external_ids?.dms_id === "DMS-77");
  expect("upsert merges attributes", upserted.attributes?.vip === true && upserted.attributes?.last_visit === "2026-05-20");
  expect("upsert overwrites name", upserted.name === "张三（更新）");

  // 3. invalid local_id → 400
  const badIdRes = await app.inject({
    method: "POST", url: "/v1/entities",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: { local_id: "with space!", type: "customer", name: "x" }
  });
  expect("invalid local_id → 400", badIdRes.statusCode === 400);

  // 4. GET own entity
  const getRes = await app.inject({
    method: "GET", url: `/v1/entities/${entA.id}`,
    headers: { "x-memory-identity": identityA }
  });
  expect("GET own entity → 200", getRes.statusCode === 200, getRes.body);

  // 5. cross-tenant GET fails the prefix check (400, not 404 — defense in depth)
  const crossRes = await app.inject({
    method: "GET", url: `/v1/entities/${entA.id}`,
    headers: { "x-memory-identity": identityB }
  });
  expect("cross-tenant GET → 400 (prefix violation)", crossRes.statusCode === 400, crossRes.body);

  // 6. PATCH entity
  const patchRes = await app.inject({
    method: "PATCH", url: `/v1/entities/${entA.id}`,
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: { attributes: { tier: "gold" }, aliases: ["张三", "Zhang"] }
  });
  expect("PATCH → 200", patchRes.statusCode === 200, patchRes.body);
  const patched = patchRes.json().entity;
  expect("PATCH merges attributes", patched.attributes?.vip === true && patched.attributes?.tier === "gold");
  expect("PATCH replaces aliases", patched.aliases.length === 2 && patched.aliases.includes("Zhang"));

  // 7. list by type
  await app.inject({
    method: "POST", url: "/v1/entities",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: { local_id: "order:o100", type: "order", name: "Order #100" }
  });
  const listRes = await app.inject({
    method: "GET", url: "/v1/entities?type=customer",
    headers: { "x-memory-identity": identityA }
  });
  expect("list type=customer → 200", listRes.statusCode === 200);
  expect("list returns only customer", listRes.json().items?.every((e: { type: string }) => e.type === "customer"));

  // 8. list by external_id
  const extListRes = await app.inject({
    method: "GET", url: "/v1/entities?external_id_key=crm_id&external_id_value=CRM-1001",
    headers: { "x-memory-identity": identityA }
  });
  expect("list by external_id → 1 hit", extListRes.json().items?.length === 1);

  // 9. cross-tenant list isolation
  const crossListRes = await app.inject({
    method: "GET", url: "/v1/entities",
    headers: { "x-memory-identity": identityB }
  });
  expect("cross-tenant list → empty", crossListRes.json().items?.length === 0);

  // ===== relations =====

  // create a second entity to be the object
  await app.inject({
    method: "POST", url: "/v1/entities",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: { local_id: "product:suv-2025", type: "product", name: "2025 款 SUV" }
  });
  const productId = `${BIZ_A}:product:suv-2025`;

  // 10. create entity-to-entity relation
  const relRes = await app.inject({
    method: "POST", url: "/v1/relations",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: {
      subject_id: entA.id,
      predicate: "prefers",
      object_id: productId,
      occurred_at: "2026-05-15T10:00:00Z",
      confidence: 0.9
    }
  });
  expect("POST relation (entity object) → 201", relRes.statusCode === 201, relRes.body);
  const rel1 = relRes.json().relation;

  // 11. create literal-value relation (object_value branch)
  const litRes = await app.inject({
    method: "POST", url: "/v1/relations",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: {
      subject_id: entA.id,
      predicate: "complained_about",
      object_value: { ticket: "T-998", severity: 2 },
      occurred_at: "2026-04-30T09:00:00Z"
    }
  });
  expect("POST relation (literal) → 201", litRes.statusCode === 201, litRes.body);

  // 12. xor constraint: both object_id + object_value rejected
  const xorRes = await app.inject({
    method: "POST", url: "/v1/relations",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: {
      subject_id: entA.id, predicate: "x",
      object_id: productId, object_value: { foo: 1 }
    }
  });
  expect("xor: both object_id+object_value → 400", xorRes.statusCode === 400, xorRes.body);

  // 13. xor constraint: neither also rejected
  const noneRes = await app.inject({
    method: "POST", url: "/v1/relations",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: { subject_id: entA.id, predicate: "x" }
  });
  expect("xor: neither object_id nor object_value → 400", noneRes.statusCode === 400);

  // 14. query by subject
  const qSubjRes = await app.inject({
    method: "POST", url: "/v1/relations/query",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: { subject_id: entA.id }
  });
  expect("query by subject → 200", qSubjRes.statusCode === 200);
  expect("query by subject returns 2 relations", qSubjRes.json().items?.length === 2);

  // 15. query by predicate
  const qPredRes = await app.inject({
    method: "POST", url: "/v1/relations/query",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: { predicate: "prefers" }
  });
  expect("query by predicate → 1 hit", qPredRes.json().items?.length === 1);

  // 16. time range filter
  const qTimeRes = await app.inject({
    method: "POST", url: "/v1/relations/query",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: { subject_id: entA.id, occurred_from: "2026-05-01T00:00:00Z" }
  });
  expect("query with occurred_from → only May relation", qTimeRes.json().items?.length === 1);

  // 17. query empty body → 400 (require at least one filter)
  const emptyRes = await app.inject({
    method: "POST", url: "/v1/relations/query",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: {}
  });
  expect("query without any filter → 400", emptyRes.statusCode === 400);

  // 18. cross-tenant query → empty
  const crossQRes = await app.inject({
    method: "POST", url: "/v1/relations/query",
    headers: { "x-memory-identity": identityB, "content-type": "application/json" },
    payload: { subject_id: entA.id }
  });
  expect("cross-tenant relation query → empty", crossQRes.json().items?.length === 0);

  // 19. soft-delete relation
  const delRelRes = await app.inject({
    method: "DELETE", url: `/v1/relations/${rel1.id}`,
    headers: { "x-memory-identity": identityA }
  });
  expect("DELETE relation → 200", delRelRes.statusCode === 200);
  const afterDelQ = await app.inject({
    method: "POST", url: "/v1/relations/query",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: { predicate: "prefers" }
  });
  expect("deleted relation excluded from query", afterDelQ.json().items?.length === 0);

  // 20. soft-delete entity
  const delEntRes = await app.inject({
    method: "DELETE", url: `/v1/entities/${entA.id}`,
    headers: { "x-memory-identity": identityA }
  });
  expect("DELETE entity → 200", delEntRes.statusCode === 200);
  const afterEntDel = await app.inject({
    method: "GET", url: `/v1/entities/${entA.id}`,
    headers: { "x-memory-identity": identityA }
  });
  expect("GET deleted entity → 404", afterEntDel.statusCode === 404);

  // 21. unauthenticated → 401
  const unauth = await app.inject({ method: "GET", url: "/v1/entities" });
  expect("no identity → 401", unauth.statusCode === 401);

  await app.close();
  await cleanup();
  await pool.end().catch(() => undefined);

  if (failed > 0) {
    console.error(`\n${failed} entity smoke check(s) failed`);
    process.exit(1);
  }
  console.log("\nall entity smoke checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
