/**
 * Vocabulary Resolver
 *
 * Phase 2.5：把 packId 解析成可直接用于 prompt 的 EvolutionExtractionContract。
 *
 * 解析顺序：
 *   1. pack.extractionContract（代码内联）若存在 → 直接用。
 *   2. 否则 loadVocabulary({ packId }) 读 data/domains/<packId>/vocabulary.yaml。
 *   3. 文件缺失 / 校验失败 → EMPTY_EXTRACTION_CONTRACT，运行不阻塞。
 *
 * 结果按 packId 缓存。词表是审核制人工合入，不会高频变动；如需主动失效，
 * 调用 invalidateVocabulary(packId)。
 */

import {
  EMPTY_EXTRACTION_CONTRACT,
  type EvolutionExtractionContract,
} from "../contracts/evolution-extraction-contract.js";
import { loadVocabulary } from "./loader.js";

interface ResolverDeps {
  /** 通过 packId 拿到对应 DomainPack（一般传 DomainRegistry.get.bind(registry)）。 */
  getPack?: (packId: string) => { extractionContract?: EvolutionExtractionContract } | undefined;
}

const cache = new Map<string, EvolutionExtractionContract>();
let deps: ResolverDeps = {};

export function configureVocabularyResolver(next: ResolverDeps): void {
  deps = next;
  cache.clear();
}

export function invalidateVocabulary(packId?: string): void {
  if (packId) cache.delete(packId);
  else cache.clear();
}

export async function resolveExtractionContract(packId: string | undefined | null): Promise<EvolutionExtractionContract> {
  const id = (packId ?? "").trim();
  if (!id) return EMPTY_EXTRACTION_CONTRACT;

  const cached = cache.get(id);
  if (cached) return cached;

  const inline = deps.getPack?.(id)?.extractionContract;
  if (inline) {
    cache.set(id, inline);
    return inline;
  }

  const loaded = await loadVocabulary({ packId: id });
  cache.set(id, loaded.contract);
  return loaded.contract;
}
