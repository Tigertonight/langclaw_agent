/**
 * Vocabulary Curator smoke。
 *
 * 验证：
 *   1) 三路 source 各自能从一个最小化 DomainPack 抽出候选；
 *   2) curator 聚合后写出 vocabulary.draft.yaml，并能被 loader 反向读回；
 *   3) loader 只注入 approved=true 的条目（draft 全 false → contract 是空的）；
 *   4) 已审核条目在再次跑 curator 时被保留，不会被同名候选覆盖；
 *   5) trace-source 在没有 LLM 时降级到频次兜底。
 */

import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { DomainPack } from "../engine/contracts/domain-pack.js";
import { collectFromDomainPackSchema } from "../evolution/vocabulary-curator/sources/db-schema-source.js";
import { collectFromDomainPackDeclarations } from "../evolution/vocabulary-curator/sources/domain-pack-source.js";
import { collectFromTrace } from "../evolution/vocabulary-curator/sources/trace-source.js";
import { curateVocabulary } from "../evolution/vocabulary-curator/index.js";
import { loadVocabulary } from "../engine/vocabulary/loader.js";
import type { VocabularyFile } from "../engine/contracts/vocabulary-schema.js";

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`, detail ?? ""); failed += 1; }
};

const minimalPack: DomainPack = {
  id: "smoke_pack",
  name: "smoke pack",
  version: "0.0.1",
  conflictPolicy: "error",
  description: "vocab curator smoke",
  resources: {
    smoke_customers: {
      file: "data/x.json",
      fields: ["id", "name", "phone", "email", "store_id"],
      domain: "smoke_pack",
      label: "客户"
    },
    smoke_stores: {
      file: "data/y.json",
      fields: ["id", "name"],
      domain: "smoke_pack"
    },
    smoke_orders: {
      file: "data/z.json",
      fields: ["id", "customer_id", "store_id", "amount"],
      domain: "smoke_pack"
    }
  },
  intentCodeMappings: {
    smoke_customers: "smoke.customer_query",
    smoke_orders: "smoke.order_query"
  },
  factKeyMappings: {
    smoke_customers: "smoke_customer_detail"
  },
  classifierIntents: {
    submit_order: "用户提交一个订单"
  }
} as DomainPack;

// ─── 1. db_schema source ────────────────────────────────────────────────────
const schemaBatch = collectFromDomainPackSchema(minimalPack);
const schemaCanonicals = new Set(schemaBatch.candidates.map((c) => `${c.kind}::${c.canonical}`));
expect("db_schema entity_type for customer extracted", schemaCanonicals.has("entity_type::smoke_customer"));
expect("db_schema strong_attribute_key picks phone", schemaCanonicals.has("strong_attribute_key::phone"));
expect("db_schema strong_attribute_key picks email", schemaCanonicals.has("strong_attribute_key::email"));
expect("db_schema generates predicate from foreign key", schemaBatch.candidates.some((c) => c.kind === "predicate" && c.canonical.includes("has_customer")));

// ─── 2. domain_pack source ──────────────────────────────────────────────────
const declBatch = collectFromDomainPackDeclarations(minimalPack);
const declCanonicals = new Set(declBatch.candidates.map((c) => `${c.kind}::${c.canonical}`));
expect("domain_pack pulls factKey", declCanonicals.has("entity_type::smoke_customer_detail"));
expect("domain_pack pulls classifierIntent as predicate", declCanonicals.has("predicate::submit_order"));

// ─── 3. trace source — frequency fallback (no LLM) ──────────────────────────
const fallbackBatch = await collectFromTrace([
  { user_message: "customer 张三 ordered hanev again, customer is happy" },
  { user_message: "another customer asked about hanev pricing, customer wants discount" }
]);
expect("trace fallback yields warnings", fallbackBatch.warnings.includes("trace_llm_unavailable_fallback_to_frequency"));
expect("trace fallback returns frequency-based candidates", fallbackBatch.candidates.some((c) => c.canonical === "customer"));

// ─── 4. trace source — mock LLM ─────────────────────────────────────────────
const mockBatch = await collectFromTrace(
  [{ user_message: "客户张三给我们打电话说想订一台汉EV", assistant_answer: "好的" }],
  {
    llm: async () => JSON.stringify({
      entity_types: [{ canonical: "customer", aliases: ["客户"], frequency: 1, example: "客户张三" }],
      predicates: [{ canonical: "ordered", aliases: ["订一台"], frequency: 1 }],
      strong_attribute_keys: [{ canonical: "phone", aliases: ["手机号"], frequency: 1 }]
    })
  }
);
expect("trace mock-llm yields entity_type customer", mockBatch.candidates.some((c) => c.kind === "entity_type" && c.canonical === "customer"));
expect("trace mock-llm captures aliases", mockBatch.candidates.some((c) => c.kind === "entity_type" && (c.aliases ?? []).includes("客户")));

// ─── 5. orchestrator end-to-end ─────────────────────────────────────────────
const tmp = await mkdtemp(path.join(tmpdir(), "vocab-smoke-"));
const draftPath = path.join(tmp, "vocabulary.draft.yaml");
const approvedPath = path.join(tmp, "vocabulary.yaml");
try {
  const result = await curateVocabulary({
    pack: minimalPack,
    trace: [{ user_message: "customer 张三 ordered hanev" }],
    traceOptions: {
      llm: async () => JSON.stringify({
        entity_types: [{ canonical: "customer", aliases: ["客户"], frequency: 4 }],
        predicates: [{ canonical: "ordered", aliases: ["订单"], frequency: 3 }]
      })
    },
    draftPath
  });
  expect("orchestrator wrote draft", result.writtenTo === draftPath);
  expect("draft contains entity_type customer", result.draft.entity_types.some((e) => e.canonical === "customer"));
  expect("all draft entries are unapproved", [...result.draft.entity_types, ...result.draft.predicates, ...result.draft.strong_attribute_keys].every((e) => !e.approved));
  expect("customer entity has merged sources", (() => {
    const cust = result.draft.entity_types.find((e) => e.canonical === "customer");
    return Boolean(cust) && (cust!.sources ?? []).includes("trace");
  })());

  // loader: draft 全 false → contract 应该是空白
  const loaded = await loadVocabulary({ packId: minimalPack.id, filePath: draftPath });
  expect("loader treats unapproved draft as empty contract", loaded.contract.entityTypes.length === 0 && loaded.contract.predicates.length === 0);

  // 模拟人工把 customer + ordered 标 approved 写到正式 vocabulary.yaml
  const approvedFile: VocabularyFile = {
    pack_id: minimalPack.id,
    schema_version: "1",
    domain_label: "smoke",
    entity_types: [{ canonical: "customer", approved: true, approved_at: "2026-05-28T00:00:00Z" }],
    predicates: [{ canonical: "ordered", approved: true, approved_at: "2026-05-28T00:00:00Z" }],
    strong_attribute_keys: [{ canonical: "phone", approved: true, approved_at: "2026-05-28T00:00:00Z" }],
    few_shot_examples: [{
      label: "customer order",
      user_message: "客户张三订一台汉EV",
      assistant_answer: "好的",
      expected_json: "{}",
      approved: true
    }]
  };
  await writeFile(approvedPath, stringifyYaml(approvedFile), "utf8");

  const loaded2 = await loadVocabulary({ packId: minimalPack.id, filePath: approvedPath });
  expect("loader injects approved entity_types", loaded2.contract.entityTypes.includes("customer"));
  expect("loader injects approved predicates", loaded2.contract.predicates.includes("ordered"));
  expect("loader injects approved strong_attribute_keys", loaded2.contract.strongAttributeKeys.includes("phone"));
  expect("loader injects approved few_shot_examples", loaded2.contract.fewShotExamples.length === 1);

  // re-curate with existing approved draft: approved entries must survive.
  // Simulate by writing the approved file *as the draft* (re-curate reads draft existing).
  await writeFile(draftPath, stringifyYaml({
    ...approvedFile,
    entity_types: [
      { canonical: "customer", approved: true, approved_at: "2026-05-28T00:00:00Z" },
      { canonical: "stale_term", approved: false, sources: ["trace"], frequency: 1 }
    ]
  }), "utf8");

  const reRun = await curateVocabulary({
    pack: minimalPack,
    trace: [],
    draftPath
  });
  expect("re-curate preserves approved customer entry", reRun.draft.entity_types.some((e) => e.canonical === "customer" && e.approved));
  expect("re-curate drops stale unapproved term not seen this round", !reRun.draft.entity_types.some((e) => e.canonical === "stale_term"));

  // schema check: written yaml round-trips through parseVocabularyFile
  const roundTrip = parseYaml(await readFile(draftPath, "utf8")) as Record<string, unknown>;
  expect("draft yaml has pack_id", roundTrip.pack_id === minimalPack.id);
} finally {
  await rm(tmp, { recursive: true, force: true });
}

if (failed > 0) {
  console.error(`\n${failed} vocabulary curator smoke check(s) failed`);
  process.exit(1);
}
console.log("\nPASS vocabulary curator smoke");
