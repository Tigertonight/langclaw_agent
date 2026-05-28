/**
 * Curator 内部共享类型。
 *
 * 三类候选词都用同一种 CandidateTerm 结构表达：
 *   - kind 标识它属于 entity_type / predicate / strong_attribute_key
 *   - canonical 是该路 source 已经做了基本规范化的形式（小写、单字符）
 *   - aliases 收集同义词（curator 跨 source 聚合时合并）
 *   - examples 是来自原始素材的样本片段，给后续人工审核看
 *
 * 各路 source 不做最终归一——归一在 orchestrator 里做（聚合后调 LLM）。
 */

export type CandidateKind = "entity_type" | "predicate" | "strong_attribute_key";

export interface CandidateTerm {
  kind: CandidateKind;
  canonical: string;
  aliases?: string[];
  examples?: string[];
  source: "db_schema" | "trace" | "domain_pack";
  /** Source-specific 频次/置信度，仅作排序参考。 */
  weight?: number;
}

export interface CandidateBatch {
  source: CandidateTerm["source"];
  candidates: CandidateTerm[];
  warnings: string[];
}
