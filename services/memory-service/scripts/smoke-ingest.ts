/**
 * Phase 1.7 — Ingestion parser unit smoke. Validates frontmatter extraction,
 * heading_path tracking, char offset accuracy, sliding-window for long sections,
 * and trailing-tiny chunk fold-in. No DB dependency.
 */

import { parseMarkdown } from "../src/ingest/parser.js";
import { DocumentRepo } from "../src/db/document-repo.js";

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`, detail ?? ""); failed += 1; }
};

// ─── Case 1: frontmatter + simple sections ─────────────────────────────────
// Bodies sized > minChars (60) so trailing-fold doesn't merge sibling sections.
const longA = "alpha body content ".repeat(8);
const longB = "beta body content ".repeat(8);
const doc1 = `---
title: Hello
tags: [a, b]
---

# Top

intro paragraph one. intro paragraph one. intro paragraph one. intro.

## Sub A

${longA}

## Sub B

${longB}
`;

const r1 = parseMarkdown(doc1);
expect("frontmatter title parsed", r1.frontmatter.title === "Hello");
expect("frontmatter tags parsed", Array.isArray(r1.frontmatter.tags) && (r1.frontmatter.tags as string[]).length === 2);
expect("title resolved from frontmatter", r1.title === "Hello");
expect("body returned raw", r1.body === doc1);
expect("frontmatter not in chunks", !r1.chunks.some((c) => c.content.includes("title: Hello")));
expect("chunks emitted", r1.chunks.length >= 3);

const subA = r1.chunks.find((c) => c.heading_path.join(">") === "Top>Sub A");
expect("Sub A chunk has nested heading_path", !!subA && subA!.content.includes("alpha body"));
const subB = r1.chunks.find((c) => c.heading_path.join(">") === "Top>Sub B");
expect("Sub B chunk has nested heading_path", !!subB && subB!.content.includes("beta body"));

// char offset accuracy: slicing raw with chunk offsets should yield content-ish
for (const c of r1.chunks) {
  const slice = doc1.slice(c.char_start, c.char_end).trim();
  if (!slice.includes(c.content.split("\n")[0]!.slice(0, 10))) {
    expect(`offset slice matches content for chunk ${c.index}`, false, { slice, content: c.content });
    break;
  }
}
expect("all char offsets verifiable", true);

// ─── Case 2: title falls back to first H1 when no frontmatter title ────────
const doc2 = `# Only Heading\n\nbody`;
const r2 = parseMarkdown(doc2);
expect("title falls back to H1", r2.title === "Only Heading");

// ─── Case 3: no headings at all ────────────────────────────────────────────
const doc3 = `just a flat paragraph with no headings at all.`;
const r3 = parseMarkdown(doc3);
expect("flat doc → 1 chunk", r3.chunks.length === 1);
expect("flat doc heading_path is empty", r3.chunks[0]!.heading_path.length === 0);
expect("flat doc title null", r3.title === null);

// ─── Case 4: long section → sliding window with overlap ────────────────────
const longBody = "x".repeat(3500);
const doc4 = `# Big\n\n${longBody}\n`;
const r4 = parseMarkdown(doc4, { maxChars: 1000, overlap: 100, minChars: 50 });
expect("long section produced multiple windows", r4.chunks.length >= 3);
// each window should be ≤ maxChars
expect("all windows respect maxChars", r4.chunks.every((c) => c.content.length <= 1000));
// adjacent windows should overlap by ~100 chars (start of window N == end of N-1 minus overlap)
let overlapSeen = false;
for (let i = 1; i < r4.chunks.length; i += 1) {
  const prev = r4.chunks[i - 1]!;
  const cur = r4.chunks[i]!;
  if (cur.char_start === prev.char_end - 100) { overlapSeen = true; break; }
}
expect("sliding window overlap observed", overlapSeen);

// ─── Case 5: deeply nested headings → heading_path stack ──────────────────
const doc5 = `# A\n\n## B\n\n### C\n\nleaf body\n`;
const r5 = parseMarkdown(doc5);
const leaf = r5.chunks.find((c) => c.content.includes("leaf body"));
expect("deeply nested heading_path tracked", !!leaf && leaf!.heading_path.join(">") === "A>B>C");

// ─── Case 6: pre-heading prologue captured ────────────────────────────────
const doc6 = `prologue line\n\n# Section\n\nbody\n`;
const r6 = parseMarkdown(doc6);
const prologue = r6.chunks.find((c) => c.heading_path.length === 0);
expect("prologue captured as headingless chunk", !!prologue && prologue!.content.includes("prologue line"));

// ─── Case 7: hash determinism ─────────────────────────────────────────────
const h1 = DocumentRepo.hash("hello world");
const h2 = DocumentRepo.hash("hello world");
const h3 = DocumentRepo.hash("hello world!");
expect("hash deterministic", h1 === h2);
expect("hash differentiating", h1 !== h3);
expect("hash has sha256 prefix", h1.startsWith("sha256:"));

if (failed > 0) {
  console.error(`\n${failed} ingest smoke check(s) failed`);
  process.exit(1);
}
console.log("\nall ingest smoke checks passed");
