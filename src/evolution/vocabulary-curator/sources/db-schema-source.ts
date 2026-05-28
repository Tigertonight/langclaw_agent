/**
 * DB Schema Source
 *
 * 不连真实数据库——读 DomainPack 已声明的 ResourceConfig（这是 schema 的真源）：
 *   - 资源名（如 dealer_vehicles）→ entity_type 候选（dealer_vehicles / dealer_vehicle）
 *   - displayColumns 中带 "_id" 后缀或位于已知强属性词典里的字段 → strong_attribute_key 候选
 *   - 资源之间的外键引用（field 形如 *_id 且 base 名指向另一个 resource）→ predicate 候选
 *
 * 这是一个**确定性**信号源，不调 LLM；归一化（同义词折叠）留给 orchestrator。
 */

import type { DomainPack } from "../../../engine/contracts/domain-pack.js";
import type { CandidateBatch, CandidateTerm } from "../types.js";

// 默认强属性键种子词典——orchestrator 可与 trace-source 的产出聚合，
// 这里只给一个保守的 baseline。每个候选会带 example 出处。
const STRONG_ATTRIBUTE_HINTS = new Set([
  "phone", "phone_masked", "mobile", "email", "id_card", "id_no",
  "vin", "license_plate", "tax_id", "passport"
]);

export function collectFromDomainPackSchema(pack: DomainPack): CandidateBatch {
  const candidates: CandidateTerm[] = [];
  const warnings: string[] = [];
  const resources = pack.resources ?? {};
  const resourceNames = Object.keys(resources);

  // 1. entity_type 候选：每个 resource 名本身。
  for (const [name, cfg] of Object.entries(resources)) {
    const canonical = singularize(name);
    candidates.push({
      kind: "entity_type",
      canonical,
      aliases: name === canonical ? [] : [name],
      examples: cfg.label ? [`${name}（${cfg.label}）`] : [name],
      source: "db_schema",
      weight: 1
    });
  }

  // 2. strong_attribute_key 候选：扫所有 fields，取命中提示词典的。
  const attrSeen = new Map<string, { examples: string[]; weight: number }>();
  for (const [resourceName, cfg] of Object.entries(resources)) {
    for (const field of cfg.fields ?? []) {
      if (!STRONG_ATTRIBUTE_HINTS.has(field.toLowerCase())) continue;
      const key = field.toLowerCase();
      const slot = attrSeen.get(key) ?? { examples: [], weight: 0 };
      if (slot.examples.length < 3) slot.examples.push(`${resourceName}.${field}`);
      slot.weight += 1;
      attrSeen.set(key, slot);
    }
  }
  for (const [key, slot] of attrSeen) {
    candidates.push({
      kind: "strong_attribute_key",
      canonical: key,
      examples: slot.examples,
      source: "db_schema",
      weight: slot.weight
    });
  }

  // 3. predicate 候选：扫 *_id 字段，如果 base 名指向另一个 resource，就生成
  //    "<resourceA>_has_<resourceB>" 风格的占位候选。这是初稿，由人工审核
  //    时改写成业务自然动词（ordered / belongs_to / created）。
  const resourceBaseSet = new Set(resourceNames.map(singularize));
  for (const [resourceName, cfg] of Object.entries(resources)) {
    for (const field of cfg.fields ?? []) {
      if (!field.endsWith("_id") || field === "id") continue;
      const refBase = field.slice(0, -3); // strip "_id"
      // 兼容 store_id → resource 叫 dealer_stores 的情形：宽松匹配
      const looksLikeRef = resourceNames.some((rn) => singularize(rn).endsWith(refBase) || rn.endsWith(refBase + "s") || resourceBaseSet.has(refBase));
      if (!looksLikeRef) continue;
      const subject = singularize(resourceName);
      const canonical = `${subject}_has_${refBase}`;
      candidates.push({
        kind: "predicate",
        canonical,
        examples: [`${resourceName}.${field} → ${refBase}`],
        source: "db_schema",
        weight: 1
      });
    }
  }

  return { source: "db_schema", candidates, warnings };
}

/** 朴素单数化：去掉末尾 's'。资源名都是 snake_case，无需 inflection 库。 */
function singularize(name: string): string {
  if (name.endsWith("ies") && name.length > 3) return name.slice(0, -3) + "y";
  if (name.endsWith("s") && !name.endsWith("ss")) return name.slice(0, -1);
  return name;
}
