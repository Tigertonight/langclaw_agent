/**
 * Vocabulary Curator CLI
 *
 *   npm run vocab:curate -- --pack <packId> [--trace path/to/trace.jsonl] [--dry-run]
 *   npm run vocab:diff   -- --pack <packId>
 *
 * 命令拿到 DomainPack 实例后调 curator，写 draft；diff 命令仅做 draft 与
 * 正式词表的人类可读对比，不做合入。
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { resolveProjectPath } from "../data/load-json.js";
import { AVAILABLE_PACKS } from "../domains/available-packs.js";
import { curateVocabulary } from "../evolution/vocabulary-curator/index.js";
import { defaultDraftPath, defaultVocabularyPath } from "../engine/vocabulary/loader.js";
import { parseVocabularyFile, type VocabularyFile } from "../engine/contracts/vocabulary-schema.js";
import type { TraceSnippet } from "../evolution/vocabulary-curator/sources/trace-source.js";

type Args = Record<string, string | boolean>;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token?.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

async function loadTrace(path: string): Promise<TraceSnippet[]> {
  const raw = await readFile(path, "utf8");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: TraceSnippet[] = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const userMessage = pickString(obj, ["user_message", "message", "prompt"]);
      if (!userMessage) continue;
      out.push({
        user_message: userMessage,
        assistant_answer: pickString(obj, ["assistant_answer_preview", "assistant_answer", "answer"]) ?? undefined,
        tag: pickString(obj, ["session_id", "id"]) ?? undefined
      });
    } catch {
      // skip malformed line
    }
  }
  return out;
}

function pickString(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

async function readVocabFile(filePath: string): Promise<VocabularyFile | null> {
  if (!existsSync(filePath)) return null;
  const raw = parseYaml(await readFile(filePath, "utf8"));
  const parsed = parseVocabularyFile(raw);
  return parsed.ok ? parsed.data : null;
}

function summarizeFile(file: VocabularyFile | null): string {
  if (!file) return "  (file missing)";
  const approved = (arr?: { approved: boolean }[]) => (arr ?? []).filter((e) => e.approved).length;
  return [
    `  pack_id: ${file.pack_id}`,
    `  entity_types: ${file.entity_types.length} (${approved(file.entity_types)} approved)`,
    `  predicates: ${file.predicates.length} (${approved(file.predicates)} approved)`,
    `  strong_attribute_keys: ${file.strong_attribute_keys.length} (${approved(file.strong_attribute_keys)} approved)`,
    `  few_shot_examples: ${file.few_shot_examples.length} (${approved(file.few_shot_examples)} approved)`
  ].join("\n");
}

async function cmdCurate(args: Args): Promise<number> {
  const packId = String(args.pack ?? "");
  if (!packId) {
    console.error("usage: vocab:curate -- --pack <packId> [--trace path] [--dry-run]");
    return 2;
  }
  const pack = AVAILABLE_PACKS.find((p) => p.id === packId);
  if (!pack) {
    console.error(`unknown pack: ${packId}. available: ${AVAILABLE_PACKS.map((p) => p.id).join(", ")}`);
    return 2;
  }
  const trace = typeof args.trace === "string" ? await loadTrace(args.trace) : [];
  const result = await curateVocabulary({
    pack,
    trace,
    writeDraft: args["dry-run"] !== true
  });
  console.log(`pack=${pack.id} batches=${result.batches.length} candidates=${result.batches.reduce((acc, b) => acc + b.candidates.length, 0)}`);
  console.log(`entity_types=${result.draft.entity_types.length} predicates=${result.draft.predicates.length} strong_attrs=${result.draft.strong_attribute_keys.length}`);
  if (result.warnings.length) console.log("warnings:\n  " + result.warnings.join("\n  "));
  if (result.writtenTo) console.log(`wrote draft → ${result.writtenTo}`);
  else console.log("dry-run: draft not written");
  return 0;
}

async function cmdDiff(args: Args): Promise<number> {
  const packId = String(args.pack ?? "");
  if (!packId) {
    console.error("usage: vocab:diff -- --pack <packId>");
    return 2;
  }
  const approvedPath = resolveProjectPath(...defaultVocabularyPath(packId).split("/").slice(-4));
  const draftPathRel = defaultDraftPath(packId);
  const draftPath = resolveProjectPath(draftPathRel);
  const approved = await readVocabFile(defaultVocabularyPath(packId));
  const draft = await readVocabFile(draftPath);

  console.log(`pack=${packId}`);
  console.log("approved (vocabulary.yaml):");
  console.log(summarizeFile(approved));
  console.log("draft (vocabulary.draft.yaml):");
  console.log(summarizeFile(draft));

  if (draft) {
    const approvedCanonicals = new Set([
      ...(approved?.entity_types ?? []).filter((e) => e.approved).map((e) => `entity_type::${e.canonical}`),
      ...(approved?.predicates ?? []).filter((e) => e.approved).map((e) => `predicate::${e.canonical}`),
      ...(approved?.strong_attribute_keys ?? []).filter((e) => e.approved).map((e) => `strong_attribute_key::${e.canonical}`)
    ]);
    const newOnes: string[] = [];
    for (const e of draft.entity_types) if (!approvedCanonicals.has(`entity_type::${e.canonical}`)) newOnes.push(`+ entity_type ${e.canonical}  (freq=${e.frequency ?? 0}, sources=${(e.sources ?? []).join(",")})`);
    for (const e of draft.predicates) if (!approvedCanonicals.has(`predicate::${e.canonical}`)) newOnes.push(`+ predicate   ${e.canonical}  (freq=${e.frequency ?? 0}, sources=${(e.sources ?? []).join(",")})`);
    for (const e of draft.strong_attribute_keys) if (!approvedCanonicals.has(`strong_attribute_key::${e.canonical}`)) newOnes.push(`+ strong_attr ${e.canonical}  (freq=${e.frequency ?? 0}, sources=${(e.sources ?? []).join(",")})`);
    if (newOnes.length) {
      console.log("\nnew candidates pending review:");
      for (const line of newOnes.slice(0, 50)) console.log("  " + line);
      if (newOnes.length > 50) console.log(`  ... ${newOnes.length - 50} more`);
    } else {
      console.log("\nno new candidates beyond approved set");
    }
  }
  void approvedPath; // 仅作引用，避免 lint 抱怨
  return 0;
}

const [, , subcommand, ...rest] = process.argv;
const args = parseArgs(rest);
const code = await (async () => {
  switch (subcommand) {
    case "curate": return cmdCurate(args);
    case "diff": return cmdDiff(args);
    default:
      console.error(`unknown subcommand: ${subcommand ?? "(none)"}\nusage:\n  vocabulary-cli curate --pack <id> [--trace path] [--dry-run]\n  vocabulary-cli diff --pack <id>`);
      return 2;
  }
})();
process.exit(code);
