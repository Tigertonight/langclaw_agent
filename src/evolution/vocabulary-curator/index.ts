/**
 * Vocabulary Curator
 *
 * 把三路 source 的候选聚合、去重、排序，写到
 * data/domains/<pack>/vocabulary.draft.yaml。
 *
 * 关键约束（Phase 2.5 阶段就要立的规矩）：
 *   - curator 永远不写 vocabulary.yaml（正式词表只能人工合入）。
 *   - draft 中 approved 一律 false，迫使审核流程不能被绕过。
 *   - canonical 在聚合后做一次小写归一；同义词折叠由后续 LLM 步骤负责，
 *     当前先按字面累加 aliases，留给人工审核时收敛（可后续接入 LLM normalizer）。
 *   - 已存在的 draft 不会被无脑覆盖：existing approved 条目会保留，
 *     其余字段（aliases / examples / frequency / sources）做合并。
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { resolveProjectPath } from "../../data/load-json.js";
import {
  parseVocabularyFile,
  type VocabularyEntry,
  type VocabularyFile,
} from "../../engine/contracts/vocabulary-schema.js";
import type { DomainPack } from "../../engine/contracts/domain-pack.js";
import { defaultDraftPath } from "../../engine/vocabulary/loader.js";
import {
  collectFromTrace,
  type TraceSnippet,
  type TraceSourceOptions,
} from "./sources/trace-source.js";
import { collectFromDomainPackSchema } from "./sources/db-schema-source.js";
import { collectFromDomainPackDeclarations } from "./sources/domain-pack-source.js";
import type { CandidateBatch, CandidateKind, CandidateTerm } from "./types.js";

export interface CurateOptions {
  pack: DomainPack;
  /** 会话片段，可空。空则只跑 db_schema + domain_pack 两路。 */
  trace?: TraceSnippet[];
  /** 透传给 trace-source（注入 mock LLM 等）。 */
  traceOptions?: TraceSourceOptions;
  /** 自定义 draft 路径，默认 data/domains/<pack.id>/vocabulary.draft.yaml。 */
  draftPath?: string;
  /** 默认 true。false 时只返回结果，不落盘——给 dry-run 用。 */
  writeDraft?: boolean;
  /** generated_by 写入 metadata；默认 "evolution.vocabulary-curator"。 */
  generatedBy?: string;
}

export interface CurateResult {
  draft: VocabularyFile;
  /** 实际写入的文件路径；writeDraft=false 时为 null。 */
  writtenTo: string | null;
  warnings: string[];
  batches: CandidateBatch[];
}

export async function curateVocabulary(opts: CurateOptions): Promise<CurateResult> {
  const warnings: string[] = [];
  const batches: CandidateBatch[] = [];

  const schemaBatch = collectFromDomainPackSchema(opts.pack);
  const declBatch = collectFromDomainPackDeclarations(opts.pack);
  batches.push(schemaBatch, declBatch);

  if (opts.trace?.length) {
    const traceBatch = await collectFromTrace(opts.trace, opts.traceOptions);
    batches.push(traceBatch);
  } else {
    warnings.push("trace_skipped:no_snippets");
  }

  for (const b of batches) warnings.push(...b.warnings);

  const allCandidates = batches.flatMap((b) => b.candidates);
  const merged = mergeCandidates(allCandidates);

  const existing = await readExistingDraft(opts.draftPath ?? resolveProjectPath(defaultDraftPath(opts.pack.id)));
  const draft = composeDraftFile({
    packId: opts.pack.id,
    domainLabel: opts.pack.description ?? undefined,
    merged,
    existing,
    generatedBy: opts.generatedBy ?? "evolution.vocabulary-curator"
  });

  let writtenTo: string | null = null;
  if (opts.writeDraft !== false) {
    const target = opts.draftPath ?? resolveProjectPath(defaultDraftPath(opts.pack.id));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, stringifyYaml(draft), "utf8");
    writtenTo = target;
  }

  return { draft, writtenTo, warnings, batches };
}

/* ── merge ───────────────────────────────────────────────────────────────── */

interface MergedCandidate {
  kind: CandidateKind;
  canonical: string;
  aliases: Set<string>;
  examples: string[];
  sources: Set<CandidateTerm["source"]>;
  frequency: number;
}

function mergeCandidates(candidates: CandidateTerm[]): Map<string, MergedCandidate> {
  const out = new Map<string, MergedCandidate>();
  for (const c of candidates) {
    const canonical = c.canonical.trim().toLowerCase();
    if (!canonical) continue;
    const key = `${c.kind}::${canonical}`;
    let slot = out.get(key);
    if (!slot) {
      slot = {
        kind: c.kind,
        canonical,
        aliases: new Set(),
        examples: [],
        sources: new Set(),
        frequency: 0
      };
      out.set(key, slot);
    }
    for (const alias of c.aliases ?? []) {
      const trimmed = alias.trim();
      if (trimmed && trimmed.toLowerCase() !== canonical) slot.aliases.add(trimmed);
    }
    for (const ex of c.examples ?? []) {
      if (slot.examples.length < 5) slot.examples.push(ex);
    }
    slot.sources.add(c.source);
    slot.frequency += typeof c.weight === "number" ? c.weight : 1;
  }
  return out;
}

/* ── existing draft 读取 ─────────────────────────────────────────────────── */

async function readExistingDraft(filePath: string): Promise<VocabularyFile | null> {
  if (!existsSync(filePath)) return null;
  let raw: unknown;
  try {
    raw = parseYaml(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
  const parsed = parseVocabularyFile(raw);
  return parsed.ok ? parsed.data : null;
}

/* ── 组装 draft 文件 ─────────────────────────────────────────────────────── */

interface ComposeOptions {
  packId: string;
  domainLabel?: string;
  merged: Map<string, MergedCandidate>;
  existing: VocabularyFile | null;
  generatedBy: string;
}

function composeDraftFile(opts: ComposeOptions): VocabularyFile {
  const entityTypes = entriesOfKind(opts.merged, "entity_type", opts.existing?.entity_types);
  const predicates = entriesOfKind(opts.merged, "predicate", opts.existing?.predicates);
  const strongAttrs = entriesOfKind(opts.merged, "strong_attribute_key", opts.existing?.strong_attribute_keys);

  return {
    pack_id: opts.packId,
    schema_version: "1",
    domain_label: opts.existing?.domain_label ?? opts.domainLabel,
    entity_types: entityTypes,
    predicates,
    strong_attribute_keys: strongAttrs,
    few_shot_examples: opts.existing?.few_shot_examples ?? [],
    metadata: {
      generated_at: new Date().toISOString(),
      generated_by: opts.generatedBy,
      notes: "draft auto-generated; review and copy approved entries to vocabulary.yaml"
    }
  };
}

function entriesOfKind(
  merged: Map<string, MergedCandidate>,
  kind: CandidateKind,
  existing: VocabularyEntry[] | undefined
): VocabularyEntry[] {
  // 已审核条目原样保留——curator 不能踩人工成果。
  const approved = (existing ?? []).filter((e) => e.approved);
  const approvedSet = new Set(approved.map((e) => e.canonical));

  const fresh: VocabularyEntry[] = [];
  for (const [key, item] of merged) {
    if (!key.startsWith(`${kind}::`)) continue;
    if (approvedSet.has(item.canonical)) continue;
    fresh.push({
      canonical: item.canonical,
      aliases: Array.from(item.aliases).slice(0, 30),
      approved: false,
      sources: Array.from(item.sources),
      frequency: item.frequency,
      examples: item.examples
    });
  }

  // 排序：approved 在前；其余按 frequency desc + canonical asc。
  fresh.sort((a, b) => {
    const fa = a.frequency ?? 0;
    const fb = b.frequency ?? 0;
    if (fa !== fb) return fb - fa;
    return a.canonical.localeCompare(b.canonical);
  });

  return [...approved, ...fresh];
}
