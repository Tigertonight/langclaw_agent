/**
 * Phase 2.3 + 2.7 — EntityResolver + merge/unmerge smoke against real PG.
 * Requires migration 0002 applied.
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

const BIZ = "smoke_resolver";

async function cleanup(): Promise<void> {
  await pool.query("DELETE FROM entity_merge_log WHERE business_id = $1", [BIZ]);
  await pool.query("DELETE FROM relations WHERE business_id = $1", [BIZ]);
  await pool.query("UPDATE memories SET entity_refs = NULL WHERE business_id = $1", [BIZ]);
  await pool.query("DELETE FROM memories WHERE business_id = $1", [BIZ]);
  await pool.query("UPDATE entities SET merged_into = NULL WHERE business_id = $1", [BIZ]);
  await pool.query("DELETE FROM entities WHERE business_id = $1", [BIZ]);
}

async function main(): Promise<void> {
  loadConfig();
  await cleanup();
  const app = await buildServer();

  const identity = signIdentity({
    business_id: BIZ, user_id: "u_1",
    issued_at: Math.floor(Date.now() / 1000), scope: []
  });

  const post = (url: string, payload: unknown) =>
    app.inject({
      method: "POST", url,
      headers: { "x-memory-identity": identity, "content-type": "application/json" },
      payload
    });

  // ===== 准备 fixture =====
  await post("/v1/entities", {
    local_id: "customer:c001", type: "customer", name: "张三",
    external_ids: { crm_id: "CRM-1001", phone: "13800001234" },
    attributes: { email: "zhang@example.com", id_card: "330104XXX" }
  });
  await post("/v1/entities", {
    local_id: "customer:c002", type: "customer", name: "张四",
    external_ids: { crm_id: "CRM-1002" },
    attributes: { email: "zhang@example.com" } // 同邮箱故意重复
  });
  await post("/v1/entities", {
    local_id: "customer:c003", type: "customer", name: "张三丰",
    attributes: {}
  });
  await post("/v1/entities", {
    local_id: "product:p1", type: "product", name: "SUV"
  });

  // ===== 2.3 EntityResolver =====

  // 1. external_ids 命中 → matched 直接返回
  const r1 = await post("/v1/entities/resolve", {
    type: "customer",
    external_ids: { crm_id: "CRM-1001" }
  });
  expect("resolve by external_ids → 200", r1.statusCode === 200, r1.body);
  const r1b = r1.json();
  expect("matched is c001", r1b.matched?.id === `${BIZ}:customer:c001`);
  expect("matched score >= threshold", r1b.candidates[0].score >= 0.8);
  expect("reason includes external_ids.crm_id", r1b.candidates[0].reasons.some((x: string) => x.includes("crm_id")));

  // 2. 未知 external_id → matched=null + 空候选
  const r2 = await post("/v1/entities/resolve", {
    type: "customer",
    external_ids: { crm_id: "CRM-9999" }
  });
  expect("unknown external_id matched=null", r2.json().matched === null);
  expect("unknown external_id no candidates", r2.json().candidates.length === 0);

  // 3. 强属性匹配（email 命中两个候选）
  const r3 = await post("/v1/entities/resolve", {
    type: "customer",
    strong_attributes: { email: "zhang@example.com" }
  });
  const r3b = r3.json();
  expect("strong_attr returns 2 candidates", r3b.candidates.length === 2);
  // 单字段 0.4 < threshold 0.8，所以 matched 应该为 null
  expect("single strong attr below threshold → matched=null", r3b.matched === null);

  // 4. 多个强属性命中 → 累加分超过阈值
  const r4 = await post("/v1/entities/resolve", {
    type: "customer",
    strong_attributes: { email: "zhang@example.com", id_card: "330104XXX" }
  });
  const r4b = r4.json();
  expect("two strong attrs hit c001", r4b.candidates[0].entity.id === `${BIZ}:customer:c001`);
  expect("two strong attrs accumulate score >= 0.8", r4b.candidates[0].score >= 0.8);
  expect("two strong attrs matched=c001", r4b.matched?.id === `${BIZ}:customer:c001`);

  // 5. external_ids + strong_attributes 协同打分
  const r5 = await post("/v1/entities/resolve", {
    type: "customer",
    external_ids: { crm_id: "CRM-1001" },
    strong_attributes: { email: "zhang@example.com" }
  });
  const r5b = r5.json();
  expect("combined score >= 1.4", r5b.candidates[0].score >= 1.4);
  expect("combined reasons include both kinds",
    r5b.candidates[0].reasons.length >= 2);

  // 6. name_hint trigram 相似度
  const r6 = await post("/v1/entities/resolve", {
    type: "customer",
    name_hint: "张三"
  });
  const r6b = r6.json();
  // 期望"张三"和"张三丰"都进候选
  expect("name_hint returns multiple candidates", r6b.candidates.length >= 2);
  const r6Ids = r6b.candidates.map((c: { entity: { id: string } }) => c.entity.id);
  expect("name_hint includes c001", r6Ids.includes(`${BIZ}:customer:c001`));

  // 7. type 隔离：找 product 不会拿到 customer
  const r7 = await post("/v1/entities/resolve", {
    type: "product",
    name_hint: "张三"
  });
  expect("type isolation — product type, no customer match", r7.json().candidates.length === 0);

  // 8. 已合并 / 已删除实体不参与 resolve
  await post("/v1/entities", {
    local_id: "customer:soft_deleted", type: "customer", name: "已删",
    external_ids: { crm_id: "CRM-DEL" }
  });
  await app.inject({
    method: "DELETE", url: `/v1/entities/${BIZ}:customer:soft_deleted`,
    headers: { "x-memory-identity": identity }
  });
  const r8 = await post("/v1/entities/resolve", {
    type: "customer",
    external_ids: { crm_id: "CRM-DEL" }
  });
  expect("deleted entity excluded from resolve", r8.json().candidates.length === 0);

  // 9. 缺所有信号 → 400
  const r9 = await post("/v1/entities/resolve", { type: "customer" });
  expect("resolve without any signal → 400", r9.statusCode === 400);

  // 10. max_candidates 截断
  const r10 = await post("/v1/entities/resolve", {
    type: "customer",
    name_hint: "张三",
    max_candidates: 1
  });
  expect("max_candidates=1 truncates", r10.json().candidates.length === 1);

  // ===== 2.7 merge / unmerge =====

  // fixture：建一条 c001→product 的关系，留待迁移
  await post("/v1/relations", {
    subject_id: `${BIZ}:customer:c001`,
    predicate: "ordered",
    object_id: `${BIZ}:product:p1`,
    occurred_at: "2026-05-10T00:00:00Z"
  });
  // 再建一条 c001 作为 object 的关系，验证 object_id 也会迁移
  await post("/v1/entities", {
    local_id: "agent:a1", type: "agent_user", name: "顾问"
  });
  await post("/v1/relations", {
    subject_id: `${BIZ}:agent:a1`,
    predicate: "served",
    object_id: `${BIZ}:customer:c001`
  });
  // memories 反向引用
  await pool.query(
    `INSERT INTO memories (business_id, user_id, category, name, content, entity_refs)
     VALUES ($1, 'u_1', 'fact', 'mem1', 'note about c001', ARRAY[$2]::TEXT[])`,
    [BIZ, `${BIZ}:customer:c001`]
  );

  // 11. merge c001 → c002（c001 是同一个人的旧记录）
  const m1 = await post(`/v1/entities/${BIZ}:customer:c002/merge`, {
    source_id: `${BIZ}:customer:c001`,
    reason: "duplicate detected by smoke",
    merged_by: "smoke-script"
  });
  expect("merge → 200", m1.statusCode === 200, m1.body);
  const m1b = m1.json();
  expect("merge migrated 2 relations", m1b.relations_migrated === 2);
  expect("source.merged_into = target", m1b.source.merged_into === `${BIZ}:customer:c002`);
  expect("merge_log written", m1b.log?.id && m1b.log.target_entity_id === `${BIZ}:customer:c002`);

  // 12. relations 已迁移到 c002
  const relAfter = await post("/v1/relations/query", {
    subject_id: `${BIZ}:customer:c002`
  });
  expect("c002 now has the ordered relation", relAfter.json().items.some(
    (r: { predicate: string }) => r.predicate === "ordered"
  ));
  const relAsObj = await post("/v1/relations/query", {
    object_id: `${BIZ}:customer:c002`
  });
  expect("c002 now is object of served relation",
    relAsObj.json().items.some((r: { predicate: string }) => r.predicate === "served"));
  // c001 不应再有任何活跃关系
  const relSourceAfter = await post("/v1/relations/query", {
    subject_id: `${BIZ}:customer:c001`
  });
  expect("c001 has no remaining subject relations", relSourceAfter.json().items.length === 0);

  // 13. memories.entity_refs 已改写
  const memCheck = await pool.query<{ entity_refs: string[] }>(
    "SELECT entity_refs FROM memories WHERE business_id = $1 AND name = 'mem1'", [BIZ]
  );
  expect("memories.entity_refs rewritten to c002",
    memCheck.rows[0]?.entity_refs?.includes(`${BIZ}:customer:c002`) ?? false);

  // 14. resolve c001 的 external_id 现在指向 c002（c001 被 merged_into 排除，
  // 但其 external_ids 还在原行；新查询用 c002 自己的 CRM_id 测试）
  const r12 = await post("/v1/entities/resolve", {
    type: "customer",
    external_ids: { crm_id: "CRM-1001" }
  });
  expect("merged source no longer surfaces in resolve", r12.json().candidates.length === 0);

  // 15. 不能 merge 已合并的 source
  const m2 = await post(`/v1/entities/${BIZ}:customer:c003/merge`, {
    source_id: `${BIZ}:customer:c001`
  });
  expect("merge already-merged source → 409", m2.statusCode === 409);

  // 16. 不能 merge 到自己
  const m3 = await post(`/v1/entities/${BIZ}:customer:c002/merge`, {
    source_id: `${BIZ}:customer:c002`
  });
  expect("merge into self → 400", m3.statusCode === 400);

  // 17. 不存在的 target
  const m4 = await post(`/v1/entities/${BIZ}:customer:nonexistent/merge`, {
    source_id: `${BIZ}:customer:c003`
  });
  expect("merge with missing target → 404", m4.statusCode === 404);

  // 18. unmerge 恢复 source.merged_into=NULL
  const u1 = await post(`/v1/entities/${BIZ}:customer:c001/unmerge`, {});
  expect("unmerge → 200", u1.statusCode === 200, u1.body);
  expect("unmerge log rolled_back_at set", u1.json().log?.rolled_back_at !== null);

  const c001After = await app.inject({
    method: "GET", url: `/v1/entities/${BIZ}:customer:c001`,
    headers: { "x-memory-identity": identity }
  });
  expect("c001 visible after unmerge", c001After.statusCode === 200);
  expect("c001.merged_into=null after unmerge", c001After.json().entity?.merged_into === null);

  // 19. 重复 unmerge → 409
  const u2 = await post(`/v1/entities/${BIZ}:customer:c001/unmerge`, {});
  expect("repeated unmerge → 409", u2.statusCode === 409);

  await app.close();
  await cleanup();
  await pool.end().catch(() => undefined);

  if (failed > 0) {
    console.error(`\n${failed} resolver/merge smoke check(s) failed`);
    process.exit(1);
  }
  console.log("\nall resolver+merge smoke checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
