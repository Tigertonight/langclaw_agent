/**
 * Phase 1.10 — message route smoke. Boots Fastify with an in-memory
 * MessageRepo stub and exercises POST batch + GET list, plus tenant isolation.
 */

import { randomUUID } from "node:crypto";
import { buildServer } from "../src/http/server.js";
import { signIdentity, type Identity } from "../src/http/identity.js";
import { loadConfig } from "../src/config/env.js";
import { pool } from "../src/db/pool.js";
import type { MessageDto, MessageItem, MessageListQuery } from "../src/domain/message.js";

interface StoredMessage extends MessageDto {
  business_id: string;
  user_id: string;
}

class StubMessageRepo {
  private rows: StoredMessage[] = [];

  insertBatch(identity: Identity, items: MessageItem[]): Promise<number> {
    const now = Date.now();
    for (let i = 0; i < items.length; i += 1) {
      const m = items[i]!;
      this.rows.push({
        id: randomUUID(),
        business_id: identity.business_id,
        user_id: identity.user_id,
        session_id: m.session_id,
        turn_index: m.turn_index,
        role: m.role,
        content: m.content ?? null,
        tool_call: m.tool_call ?? null,
        tool_result: m.tool_result ?? null,
        metadata: m.metadata ?? {},
        created_at: new Date(now + i).toISOString()
      });
    }
    return Promise.resolve(items.length);
  }

  list(identity: Identity, q: MessageListQuery): Promise<{ items: MessageDto[]; next_cursor: string | null }> {
    const filtered = this.rows
      .filter((r) => r.business_id === identity.business_id && r.user_id === identity.user_id)
      .filter((r) => (q.session_id ? r.session_id === q.session_id : true))
      .filter((r) => (q.since ? r.created_at >= q.since : true))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    const items = filtered.slice(0, q.limit).map(({ business_id, user_id, ...rest }) => rest);
    return Promise.resolve({ items, next_cursor: null });
  }
}

async function main(): Promise<void> {
  loadConfig();
  const stub = new StubMessageRepo();
  const app = await buildServer({ messageRoutes: { repo: stub as never } });
  let failed = 0;
  const expect = (label: string, ok: boolean, detail?: unknown) => {
    if (ok) console.log(`  ✓ ${label}`);
    else { console.log(`  ✗ ${label}`, detail ?? ""); failed += 1; }
  };

  const identityA = signIdentity({
    business_id: "dealer_001", user_id: "u_42",
    issued_at: Math.floor(Date.now() / 1000), scope: []
  });
  const identityB = signIdentity({
    business_id: "dealer_002", user_id: "u_99",
    issued_at: Math.floor(Date.now() / 1000), scope: []
  });

  // 1. batch insert
  const batchRes = await app.inject({
    method: "POST", url: "/v1/messages/batch",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: {
      items: [
        { session_id: "sess_1", turn_index: 0, role: "user", content: "你好" },
        { session_id: "sess_1", turn_index: 1, role: "assistant", content: "您好，需要什么帮助？" },
        { session_id: "sess_1", turn_index: 2, role: "tool", tool_call: { name: "search", args: {} } }
      ]
    }
  });
  expect("POST batch → 201", batchRes.statusCode === 201, batchRes.body);
  expect("batch returns inserted count", batchRes.json().inserted === 3);

  // 2. validation: empty content + no tool_call → 400
  const badRes = await app.inject({
    method: "POST", url: "/v1/messages/batch",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: { items: [{ session_id: "s", turn_index: 0, role: "user" }] }
  });
  expect("missing content/tool fields → 400", badRes.statusCode === 400, badRes.body);

  // 3. list returns own data
  const listRes = await app.inject({
    method: "GET", url: "/v1/messages?session_id=sess_1&limit=10",
    headers: { "x-memory-identity": identityA }
  });
  expect("list session → 200", listRes.statusCode === 200, listRes.body);
  expect("list returns 3 items", listRes.json().items?.length === 3);

  // 4. cross-tenant list → empty
  const crossList = await app.inject({
    method: "GET", url: "/v1/messages",
    headers: { "x-memory-identity": identityB }
  });
  expect("cross-tenant list → empty", crossList.json().items?.length === 0);

  // 5. invalid role → 400
  const badRole = await app.inject({
    method: "POST", url: "/v1/messages/batch",
    headers: { "x-memory-identity": identityA, "content-type": "application/json" },
    payload: { items: [{ session_id: "s", turn_index: 0, role: "weird", content: "x" }] }
  });
  expect("invalid role → 400", badRole.statusCode === 400);

  // 6. missing identity → 401
  const noAuth = await app.inject({ method: "GET", url: "/v1/messages" });
  expect("no identity → 401", noAuth.statusCode === 401);

  await app.close();
  await pool.end().catch(() => undefined);
  if (failed > 0) {
    console.error(`\n${failed} message smoke check(s) failed`);
    process.exit(1);
  }
  console.log("\nall message smoke checks passed");
}

main().catch((err) => { console.error(err); process.exit(1); });
