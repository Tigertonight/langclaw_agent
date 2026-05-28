/**
 * scripts/smoke-memory-routes.ts — Phase 1.4 route smoke
 *
 * Boots the HTTP server with an in-memory MemoryRepo stub and exercises the
 * full CRUD route surface without needing PostgreSQL.
 */

import { randomUUID } from "node:crypto";
import { buildServer } from "../src/http/server.js";
import { signIdentity, type Identity } from "../src/http/identity.js";
import { loadConfig } from "../src/config/env.js";
import { pool } from "../src/db/pool.js";
import type { MemoryRow } from "../src/db/types.js";
import type { MemoryCreateInput, MemoryListQuery, MemoryPatchInput } from "../src/domain/memory.js";

class StubRepo {
  private rows = new Map<string, MemoryRow>();

  create(identity: Identity, input: MemoryCreateInput): Promise<MemoryRow> {
    const now = new Date();
    const row: MemoryRow = {
      id: randomUUID(),
      business_id: identity.business_id,
      user_id: identity.user_id,
      agent_id: identity.agent_id ?? null,
      category: input.category,
      name: input.name,
      description: input.description ?? null,
      content: input.content,
      source: input.source ?? null,
      confidence: input.confidence ?? 1.0,
      tags: input.tags ?? null,
      metadata: (input.metadata ?? {}) as Record<string, never>,
      embedding: null,
      embedding_model: null,
      embedded_at: null,
      created_at: now,
      updated_at: now,
      expired_at: input.expired_at ? new Date(input.expired_at) : null,
      deleted_at: null
    };
    this.rows.set(row.id, row);
    return Promise.resolve(row);
  }

  getById(identity: Identity, id: string): Promise<MemoryRow | null> {
    const row = this.rows.get(id);
    if (!row || row.deleted_at) return Promise.resolve(null);
    if (row.business_id !== identity.business_id || row.user_id !== identity.user_id) {
      return Promise.resolve(null);
    }
    return Promise.resolve(row);
  }

  patch(identity: Identity, id: string, patch: MemoryPatchInput): Promise<MemoryRow | null> {
    const row = this.rows.get(id);
    if (!row || row.deleted_at) return Promise.resolve(null);
    if (row.business_id !== identity.business_id || row.user_id !== identity.user_id) {
      return Promise.resolve(null);
    }
    if (patch.name !== undefined) row.name = patch.name;
    if (patch.description !== undefined) row.description = patch.description;
    if (patch.content !== undefined) {
      row.content = patch.content;
      row.embedding = null;
      row.embedding_model = null;
      row.embedded_at = null;
    }
    if (patch.confidence !== undefined) row.confidence = patch.confidence;
    if (patch.tags !== undefined) row.tags = patch.tags;
    if (patch.metadata !== undefined) row.metadata = patch.metadata as never;
    if (patch.expired_at !== undefined) row.expired_at = patch.expired_at ? new Date(patch.expired_at) : null;
    row.updated_at = new Date();
    return Promise.resolve(row);
  }

  softDelete(identity: Identity, id: string): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.deleted_at) return Promise.resolve(false);
    if (row.business_id !== identity.business_id || row.user_id !== identity.user_id) {
      return Promise.resolve(false);
    }
    row.deleted_at = new Date();
    return Promise.resolve(true);
  }

  list(identity: Identity, query: MemoryListQuery): Promise<{ items: MemoryRow[]; nextCursor: string | null }> {
    const filtered = Array.from(this.rows.values())
      .filter((r) => !r.deleted_at)
      .filter((r) => r.business_id === identity.business_id && r.user_id === identity.user_id)
      .filter((r) => (query.category ? r.category === query.category : true))
      .filter((r) => (query.tag ? (r.tags ?? []).includes(query.tag) : true))
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime() || (a.id < b.id ? 1 : -1));
    const items = filtered.slice(0, query.limit);
    return Promise.resolve({ items, nextCursor: null });
  }
}

async function main(): Promise<void> {
  loadConfig();
  const stub = new StubRepo();
  const app = await buildServer({ memoryRoutes: { repo: stub as unknown as never } });
  let failed = 0;
  const expect = (label: string, ok: boolean, detail?: unknown) => {
    if (ok) console.log(`  ✓ ${label}`);
    else { console.log(`  ✗ ${label}`, detail ?? ""); failed += 1; }
  };

  const identityA = signIdentity({
    business_id: "dealer_001", user_id: "u_42", agent_id: "openclaw",
    issued_at: Math.floor(Date.now() / 1000), scope: []
  });
  const identityB = signIdentity({
    business_id: "dealer_002", user_id: "u_99",
    issued_at: Math.floor(Date.now() / 1000), scope: []
  });

  // 1. create
  const createRes = await app.inject({
    method: "POST", url: "/v1/memories",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: {
      category: "fact", name: "客户偏好", content: "VIP 客户张三偏好 SUV 车型",
      source: "manual", tags: ["customer"], metadata: { session_id: "sess_1" }
    }
  });
  expect("POST create returns 201", createRes.statusCode === 201, createRes.body);
  const created = createRes.json();
  expect("create returns memory + embedding_status", created.memory?.id && created.embedding_status === "queued");
  const memoryId = created.memory.id;

  // 2. get by id (same identity)
  const getRes = await app.inject({
    method: "GET", url: `/v1/memories/${memoryId}`,
    headers: { "x-memory-identity": identityA }
  });
  expect("GET own memory → 200", getRes.statusCode === 200, getRes.body);
  expect("get echoes content", getRes.json().memory?.content === "VIP 客户张三偏好 SUV 车型");

  // 3. cross-tenant get → 404 (tenant isolation)
  const crossRes = await app.inject({
    method: "GET", url: `/v1/memories/${memoryId}`,
    headers: { "x-memory-identity": identityB }
  });
  expect("cross-tenant GET → 404", crossRes.statusCode === 404, crossRes.body);

  // 4. invalid UUID → 400
  const badIdRes = await app.inject({
    method: "GET", url: "/v1/memories/not-a-uuid",
    headers: { "x-memory-identity": identityA }
  });
  expect("invalid uuid → 400", badIdRes.statusCode === 400, badIdRes.body);

  // 5. invalid body → 400 with issues
  const badBodyRes = await app.inject({
    method: "POST", url: "/v1/memories",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: { category: "not_a_category", name: "x", content: "y" }
  });
  expect("bad category → 400", badBodyRes.statusCode === 400, badBodyRes.body);
  expect("400 carries issues", Array.isArray(badBodyRes.json().details?.issues));

  // 6. patch content → re-embed queued
  const patchRes = await app.inject({
    method: "PATCH", url: `/v1/memories/${memoryId}`,
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: { content: "VIP 客户张三本月想换 7 座 SUV" }
  });
  expect("PATCH content → 200", patchRes.statusCode === 200, patchRes.body);
  expect("PATCH content triggers reembed queued", patchRes.json().embedding_status === "queued");

  // 7. patch metadata only → no reembed
  const patchMetaRes = await app.inject({
    method: "PATCH", url: `/v1/memories/${memoryId}`,
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: { tags: ["customer", "vip"] }
  });
  expect("PATCH tags only → embedding_status=done", patchMetaRes.json().embedding_status === "done");

  // 8. list filtered by category
  const listRes = await app.inject({
    method: "GET", url: "/v1/memories?category=fact&limit=10",
    headers: { "x-memory-identity": identityA }
  });
  expect("list by category → 200", listRes.statusCode === 200, listRes.body);
  expect("list returns 1 item", listRes.json().items?.length === 1);

  // 9. cross-tenant list → empty
  const crossListRes = await app.inject({
    method: "GET", url: "/v1/memories",
    headers: { "x-memory-identity": identityB }
  });
  expect("cross-tenant list → empty", crossListRes.json().items?.length === 0);

  // 10. delete → 200, then get → 404
  const delRes = await app.inject({
    method: "DELETE", url: `/v1/memories/${memoryId}`,
    headers: { "x-memory-identity": identityA }
  });
  expect("DELETE → 200", delRes.statusCode === 200, delRes.body);
  const afterDel = await app.inject({
    method: "GET", url: `/v1/memories/${memoryId}`,
    headers: { "x-memory-identity": identityA }
  });
  expect("GET deleted → 404", afterDel.statusCode === 404);

  // 11. patch deleted → 404
  const patchGone = await app.inject({
    method: "PATCH", url: `/v1/memories/${memoryId}`,
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: { name: "new" }
  });
  expect("PATCH deleted → 404", patchGone.statusCode === 404);

  await app.close();
  await pool.end().catch(() => undefined);

  if (failed > 0) {
    console.error(`\n${failed} smoke check(s) failed`);
    process.exit(1);
  }
  console.log("\nall route smoke checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
