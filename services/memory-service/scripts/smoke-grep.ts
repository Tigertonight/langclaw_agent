/**
 * Phase 1.9 — grep excerpt unit smoke. Verifies match-window excerpt extraction,
 * ellipsis behavior, case-insensitivity, and graceful fallback for invalid regex.
 */

import { excerptAround } from "../src/db/grep-repo.js";

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`, detail ?? ""); failed += 1; }
};

const longText = "lorem ipsum ".repeat(40) + "FOUND_HERE " + "dolor sit ".repeat(40);

// Case 1: case-insensitive match in middle → window has both ellipses
const e1 = excerptAround(longText, "found_here", true);
expect("case-insensitive match found", e1.includes("FOUND_HERE"));
expect("leading ellipsis", e1.startsWith("…"));
expect("trailing ellipsis", e1.endsWith("…"));

// Case 2: case-sensitive → no match for differently-cased pattern
const e2 = excerptAround(longText, "found_here", false);
expect("case-sensitive miss falls back to slice", !e2.includes("…") && e2.length <= 240);

// Case 3: match at start → no leading ellipsis
const e3 = excerptAround("HELLO world rest of content", "HELLO", false);
expect("match at start has no leading ellipsis", !e3.startsWith("…") && e3.includes("HELLO"));

// Case 4: short content → no truncation needed
const e4 = excerptAround("short", "ort", false);
expect("short content returned in full", e4 === "short");

// Case 5: invalid regex falls back to leading slice
const e5 = excerptAround("a content here", "[unclosed", true);
expect("invalid regex falls back gracefully", e5 === "a content here".slice(0, 240));

// Case 6: regex pattern (alternation)
const e6 = excerptAround("the quick brown fox jumps", "fox|cat", true);
expect("alternation regex matches", e6.includes("fox"));

if (failed > 0) {
  console.error(`\n${failed} grep smoke check(s) failed`);
  process.exit(1);
}
console.log("\nall grep smoke checks passed");
