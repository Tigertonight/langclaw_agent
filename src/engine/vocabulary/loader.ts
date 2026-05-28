/**
 * Engine Vocabulary Loader
 *
 * 从 data/domains/<pack>/vocabulary.yaml 读取经审核的词表，转换成
 * EvolutionExtractionContract。Engine 在这里做严格校验和过滤：
 *
 * 1. 只注入 approved=true 的条目（既适用于 entry 也适用于 few-shot）。
 * 2. canonical 必须在 schema 通过后才会写到 contract.entityTypes / predicates / ...
 *    之中。aliases 留在 prompt few-shot 注释里，不直接进白名单。
 * 3. 文件不存在或 schema 校验失败 → 返回 EMPTY_EXTRACTION_CONTRACT，
 *    不阻塞运行时（保持 Phase 2.5 的 graceful degrade 兼容）。
 *
 * 本模块只做读和转换，不做 LLM 调用，不依赖 memory-service。
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml } from "yaml";
import { resolveProjectPath } from "../../data/load-json.js";
import {
  EMPTY_EXTRACTION_CONTRACT,
  type EvolutionExtractionContract,
} from "../contracts/evolution-extraction-contract.js";
import {
  parseVocabularyFile,
  type VocabularyEntry,
  type VocabularyFile,
} from "../contracts/vocabulary-schema.js";

export interface LoadVocabularyOptions {
  /** DomainPack id，与 data/domains/<pack>/ 目录名一致。 */
  packId: string;
  /** 用于覆盖默认路径，主要给 smoke / test 用。 */
  filePath?: string;
}

export interface LoadVocabularyResult {
  contract: EvolutionExtractionContract;
  /** 读到的原始文件（已过 schema 校验）。文件不存在时为 null。 */
  file: VocabularyFile | null;
  /** loader 在过程中收集的非致命问题，方便日志/告警。 */
  warnings: string[];
}

export function defaultVocabularyPath(packId: string): string {
  return resolveProjectPath("data", "domains", packId, "vocabulary.yaml");
}

export async function loadVocabulary({ packId, filePath }: LoadVocabularyOptions): Promise<LoadVocabularyResult> {
  const target = filePath ?? defaultVocabularyPath(packId);
  if (!existsSync(target)) {
    return { contract: EMPTY_EXTRACTION_CONTRACT, file: null, warnings: [`vocabulary_missing:${target}`] };
  }

  let raw: unknown;
  try {
    raw = parseYaml(await readFile(target, "utf8"));
  } catch (err) {
    return {
      contract: EMPTY_EXTRACTION_CONTRACT,
      file: null,
      warnings: [`vocabulary_yaml_parse_failed:${err instanceof Error ? err.message : "unknown"}`]
    };
  }

  const parsed = parseVocabularyFile(raw);
  if (parsed.ok !== true) {
    return { contract: EMPTY_EXTRACTION_CONTRACT, file: null, warnings: [parsed.reason] };
  }

  const file = parsed.data;
  const warnings: string[] = [];
  if (file.pack_id !== packId) {
    warnings.push(`vocabulary_pack_id_mismatch:expected=${packId},got=${file.pack_id}`);
  }

  const contract: EvolutionExtractionContract = {
    domainLabel: file.domain_label,
    entityTypes: pickApprovedCanonicals(file.entity_types),
    predicates: pickApprovedCanonicals(file.predicates),
    strongAttributeKeys: pickApprovedCanonicals(file.strong_attribute_keys),
    fewShotExamples: file.few_shot_examples
      .filter((ex) => ex.approved)
      .map((ex) => ({
        label: ex.label,
        userMessage: ex.user_message,
        assistantAnswer: ex.assistant_answer,
        expectedJson: ex.expected_json
      }))
  };

  return { contract, file, warnings };
}

function pickApprovedCanonicals(entries: VocabularyEntry[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (!e.approved) continue;
    if (seen.has(e.canonical)) continue;
    seen.add(e.canonical);
    out.push(e.canonical);
  }
  return out;
}

/** 把 vocabulary draft 写入 data/domains/<pack>/vocabulary.draft.yaml 用的相对路径。 */
export function defaultDraftPath(packId: string): string {
  return path.join("data", "domains", packId, "vocabulary.draft.yaml");
}
