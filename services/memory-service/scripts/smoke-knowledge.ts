/**
 * Phase 1.8 — cross-source RRF merge unit smoke. Verifies multi-source dedup
 * keying, that a doc ranking high in two lists wins, and source label mapping.
 */

import { rrfMergeMany, type RankedRow } from "../src/db/knowledge-search.js";

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`, detail ?? ""); failed += 1; }
};

const mk = (source: RankedRow["source"], id: string, score: number, extra: Partial<RankedRow> = {}): RankedRow => ({
  source,
  id,
  category: extra.category ?? null,
  title: extra.title ?? null,
  heading_path: extra.heading_path ?? null,
  document_id: extra.document_id ?? null,
  content: extra.content ?? `${source}-${id}`,
  tags: extra.tags ?? null,
  created_at: new Date(),
  score
});

// Case 1: A appears in both memory-lex and chunk-lex → wins
const memoryLex = [mk("memories", "a", 0.9), mk("memories", "b", 0.5)];
const chunkLex = [mk("document_chunks", "x", 0.85), mk("memories", "a", 0.7)];
const merged = rrfMergeMany([memoryLex, chunkLex], 5);
expect("merged returns 3 unique items", merged.length === 3);
expect("memory-a wins (multi-list)", merged[0]?.id === "a" && merged[0]?.source === "memory");

// Case 2: source label mapping
const allLists = [
  [mk("memories", "m1", 1), mk("memories", "m2", 0.5)],
  [mk("document_chunks", "c1", 1, { document_id: "doc-1", heading_path: ["A","B"], title: "T", category: "spec" })],
  [mk("messages", "msg-1", 1)]
];
const labelHits = rrfMergeMany(allLists, 10);
const sources = new Set(labelHits.map((h) => h.source));
expect("memory label present", sources.has("memory"));
expect("document_chunk label present", sources.has("document_chunk"));
expect("message label present", sources.has("message"));

const c1 = labelHits.find((h) => h.id === "c1");
expect("chunk hit carries document_id", c1?.document_id === "doc-1");
expect("chunk hit carries heading_path", JSON.stringify(c1?.heading_path) === JSON.stringify(["A","B"]));
expect("chunk hit carries title", c1?.title === "T");

// Case 3: same UUID across sources doesn't collapse (dedup key = source:id)
const sameId = [
  [mk("memories", "shared-id", 0.9)],
  [mk("document_chunks", "shared-id", 0.9)]
];
const sameMerged = rrfMergeMany(sameId, 10);
expect("same UUID across sources kept separate", sameMerged.length === 2);

// Case 4: top_k respected
const top1 = rrfMergeMany([memoryLex, chunkLex], 1);
expect("top_k=1 respected", top1.length === 1);

// Case 5: empty lists
expect("empty lists → 0", rrfMergeMany([], 5).length === 0);
expect("all-empty lists → 0", rrfMergeMany([[], [], []], 5).length === 0);

// Case 6: single source single mode
const onlyMem = rrfMergeMany([[mk("memories", "z", 0.4)]], 5);
expect("single ranked source returns 1", onlyMem.length === 1 && onlyMem[0]?.id === "z");

if (failed > 0) {
  console.error(`\n${failed} knowledge smoke check(s) failed`);
  process.exit(1);
}
console.log("\nall knowledge smoke checks passed");
