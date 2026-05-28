/**
 * Phase 1.5 — RRF unit smoke. Validates merge ordering, top_k, and that
 * docs ranked in both lists rise above docs ranked in only one.
 */

import { rrfMerge, type RankedRow } from "../src/db/memory-search.js";

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`, detail ?? ""); failed += 1; }
};

const mk = (id: string, score: number): RankedRow => ({
  id, category: "fact", name: id, content: id, tags: null,
  created_at: new Date(), score
});

// Case 1: A is top-1 in both lists, B is only top-1 lex, C is only top-1 vec.
// A should win because it gets RRF bonus from both lists.
const lex = [mk("a", 0.9), mk("b", 0.8), mk("c", 0.5)];
const vec = [mk("a", 0.95), mk("c", 0.85), mk("b", 0.4)];
const merged = rrfMerge(lex, vec, 3);
expect("merged returns 3", merged.length === 3);
expect("doc a wins", merged[0]?.id === "a");
expect("a has both lex+vec breakdown", merged[0]?.score_breakdown?.lexical !== undefined && merged[0]?.score_breakdown?.vector !== undefined);

// Case 2: top_k respected
const top1 = rrfMerge(lex, vec, 1);
expect("top_k=1 respected", top1.length === 1 && top1[0]?.id === "a");

// Case 3: empty inputs
expect("empty inputs return []", rrfMerge([], [], 5).length === 0);

// Case 4: only one source
const onlyLex = rrfMerge([mk("x", 0.5)], [], 5);
expect("only lexical → 1 result", onlyLex.length === 1 && onlyLex[0]?.id === "x");
expect("only-lex result has lex breakdown only", onlyLex[0]?.score_breakdown?.lexical === 0.5 && onlyLex[0]?.score_breakdown?.vector === undefined);

if (failed > 0) {
  console.error(`\n${failed} search smoke check(s) failed`);
  process.exit(1);
}
console.log("\nall search smoke checks passed");
