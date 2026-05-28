/**
 * DomainPack Source
 *
 * 复用 DomainPack 已声明的运行时元信息作为种子词：
 *   - intentCodeMappings 的 key（resource 名）→ entity_type 候选
 *   - capabilityDescriptions / dataQueryKeywords / classificationKeywords →
 *     人工筛查时的备选实体词（仅作 example 用，不直接落 canonical）
 *   - factKeyMappings 的 value 形如 "dealer_inventory_detail" → entity_type
 *
 * 这一路与 db-schema 互为补集：db-schema 提供「物理表结构」，
 * domain-pack 提供「业务侧已沉淀的概念」。
 */

import type { DomainPack } from "../../../engine/contracts/domain-pack.js";
import type { CandidateBatch, CandidateTerm } from "../types.js";

export function collectFromDomainPackDeclarations(pack: DomainPack): CandidateBatch {
  const candidates: CandidateTerm[] = [];
  const warnings: string[] = [];

  // 1. intentCodeMappings 的 key —— 与 db-schema 重合时由 orchestrator 去重
  const intentMap = pack.intentCodeMappings ?? {};
  for (const resourceName of Object.keys(intentMap)) {
    candidates.push({
      kind: "entity_type",
      canonical: singularize(resourceName),
      aliases: [resourceName],
      examples: [`intentCodeMappings.${resourceName} → ${intentMap[resourceName]}`],
      source: "domain_pack",
      weight: 1
    });
  }

  // 2. factKeyMappings 的 value —— 通常已经是被业务方拍板的 fact key
  const factMap = pack.factKeyMappings ?? {};
  for (const factKey of Object.values(factMap)) {
    if (typeof factKey !== "string" || !factKey.length) continue;
    candidates.push({
      kind: "entity_type",
      canonical: factKey,
      examples: [`factKey:${factKey}`],
      source: "domain_pack",
      weight: 2 // 已被业务沉淀，权重略高
    });
  }

  // 3. classifierIntents key（如 "leave_request"）—— 业务动作，更像 predicate
  const classifierIntents = pack.classifierIntents ?? {};
  for (const intentName of Object.keys(classifierIntents)) {
    candidates.push({
      kind: "predicate",
      canonical: intentName,
      examples: [`classifierIntent:${intentName}=${classifierIntents[intentName]}`],
      source: "domain_pack",
      weight: 1
    });
  }

  return { source: "domain_pack", candidates, warnings };
}

function singularize(name: string): string {
  if (name.endsWith("ies") && name.length > 3) return name.slice(0, -3) + "y";
  if (name.endsWith("s") && !name.endsWith("ss")) return name.slice(0, -1);
  return name;
}
