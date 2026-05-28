/**
 * Phase 2.5 wiring smoke：验证 EvolutionRuntime 真的会调用 extractor + applyExtraction，
 * 并且 vocabulary resolver 能从内联 contract 取到白名单。
 *
 * 由于 memory-service 在 smoke 环境通常未启动，applyExtraction 的 entity/relation
 * 写入会被 getMemoryClient() 返回 null 短路；smoke 主要验证：
 *   1) extractor.extract 被调用，且能拿到来自 contract 的 entityTypes 白名单；
 *   2) extractor 返回的 memory_actions 被合入 memory.json；
 *   3) result.applied 含 entities / relations 字段（即便为 0，也证明走的是结构化路径）。
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { EvolutionRuntime } from "../evolution/runtime.js";
import { EvolutionExtractor } from "../evolution/extractor.js";
import { configureVocabularyResolver, invalidateVocabulary } from "../engine/vocabulary/resolver.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import type { EvolutionDecision, EvolutionTurnInput } from "../evolution/types.js";
import type { UserContext } from "../types/agent-contracts.js";
import type { EvolutionExtractionContract } from "../engine/contracts/evolution-extraction-contract.js";

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`, detail ?? ""); failed += 1; }
};

const user: UserContext = {
  id: `eval_extraction_wiring_${Date.now()}`,
  name: "Eval Extraction Wiring",
  role: "eval",
  permissions: []
};
const workspace = resolveUserWorkspace(user);

const inlineContract: EvolutionExtractionContract = {
  domainLabel: "smoke retail",
  entityTypes: ["customer", "product"],
  predicates: ["ordered", "prefers"],
  strongAttributeKeys: ["phone"],
  fewShotExamples: []
};

// 注入"按 packId 取 contract"的桩。
configureVocabularyResolver({
  getPack: (id) => id === "smoke_pack" ? { extractionContract: inlineContract } : undefined
});

let extractorSawSystemPrompt: string | null = null;

const fakeExtractor = new EvolutionExtractor({
  llm: async ({ system }) => {
    extractorSawSystemPrompt = system;
    return JSON.stringify({
      memory_actions: [
        { op: "upsert", type: "preference", key: "answer_style", value: "短" }
      ],
      entities: [
        { local_id: "c1", type: "customer", name: "张三", strong_attributes: { phone: "13800000000" } }
      ],
      relations: [
        { subject: { local_id: "c1" }, predicate: "ordered", object_value: { brand: "Toyota" } }
      ]
    });
  }
});

try {
  await mkdir(workspace.root, { recursive: true });

  const runtime = new EvolutionRuntime({
    debounceMs: 60_000,
    extractor: fakeExtractor,
    judge: {
      async decide(_input: EvolutionTurnInput): Promise<{ ok: true; decision: EvolutionDecision }> {
        return {
          ok: true,
          decision: {
            should_evolve: true,
            confidence: 0.9,
            reason: "smoke",
            memory_actions: [{
              op: "upsert",
              type: "fact",
              key: "judge_seed",
              value: "judge baseline",
              confidence: 0.8
            }],
            task_actions: [],
            skill_actions: []
          }
        };
      }
    } as never
  });

  const result = await runtime.reviewTurn({
    trigger: "agent_finish",
    user,
    workspace,
    sessionId: `${user.id}:default`,
    message: "客户张三想买汉EV",
    answer: "好的",
    route: { intent_code: "smoke_pack.customer_query" },
    toolPlan: { calls: [] },
    toolResults: []
  });

  expect("evolution runtime status applied", result.status === "applied", result);
  expect("memory file written", existsSync(path.join(workspace.memory_dir, "memory.json")));

  const memory = JSON.parse(await readFile(path.join(workspace.memory_dir, "memory.json"), "utf8")) as { items: Array<{ key: string }> };
  expect("answer_style memory action applied via extraction", memory.items.some((i) => i.key === "answer_style"));

  expect("extractor was invoked", extractorSawSystemPrompt !== null);
  expect("system prompt mentions domain label", String(extractorSawSystemPrompt ?? "").includes("smoke retail"));
  expect("system prompt injects entity types whitelist", String(extractorSawSystemPrompt ?? "").includes("- customer"));
  expect("system prompt injects predicates whitelist", String(extractorSawSystemPrompt ?? "").includes("- ordered"));

  // entities/relations 字段在 result.applied 出现（即使 memory-service 未启动写入数为 0）
  expect("applied.entities field present", typeof result.applied?.entities === "number");
  expect("applied.relations field present", typeof result.applied?.relations === "number");

  // ── 验证 packId 推断 + cache 失效 ───────────────────────────────
  invalidateVocabulary("smoke_pack");
  // 重置 resolver 让下次回退到 yaml loader（应得到 EMPTY contract）
  configureVocabularyResolver({});
  let secondPrompt: string | null = null;
  const fallbackExtractor = new EvolutionExtractor({
    llm: async ({ system }) => {
      secondPrompt = system;
      return JSON.stringify({});
    }
  });
  const runtime2 = new EvolutionRuntime({
    debounceMs: 60_000,
    extractor: fallbackExtractor,
    judge: {
      async decide() {
        return {
          ok: true,
          decision: {
            should_evolve: true,
            memory_actions: [{ op: "upsert", type: "fact", key: "judge_seed_2", value: "x", confidence: 0.7 }],
            task_actions: [],
            skill_actions: []
          }
        };
      }
    } as never
  });
  await runtime2.reviewTurn({
    trigger: "agent_finish",
    user,
    workspace,
    sessionId: `${user.id}:fallback`,
    message: "再问一次",
    answer: "ok",
    route: { intent_code: "smoke_pack.customer_query" },
    toolPlan: { calls: [] },
    toolResults: []
  });
  expect("fallback extractor still gets a system prompt", secondPrompt !== null);
  expect("fallback prompt has no entity whitelist (EMPTY contract)", !String(secondPrompt ?? "").includes("- customer"));

  if (failed > 0) {
    console.error(`\n${failed} extraction wiring smoke check(s) failed`);
    process.exit(1);
  }
  console.log("\nPASS evolution extraction wiring smoke");
} finally {
  await rm(resolveProjectPath("users", workspace.user_id), { recursive: true, force: true });
}
