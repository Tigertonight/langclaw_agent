/**
 * Phase 1.6 — embedding provider unit smoke. Validates HashFallbackProvider
 * dimensions, determinism, and unit-norm normalization.
 */

import { HashFallbackProvider } from "../src/embedding/hash-fallback.js";
import { vectorToSql, sqlToVector } from "../src/embedding/serialize.js";

let failed = 0;
const expect = (label: string, ok: boolean, detail?: unknown) => {
  if (ok) console.log(`  ✓ ${label}`);
  else { console.log(`  ✗ ${label}`, detail ?? ""); failed += 1; }
};

const provider = new HashFallbackProvider(1024);
expect("modelTag === hash-fallback:v1", provider.modelTag === "hash-fallback:v1");
expect("dimensions === 1024", provider.dimensions === 1024);

const vecs = await provider.embed(["客户偏好 SUV", "客户偏好 SUV", "完全不一样的内容"]);
expect("returned 3 vectors", vecs.length === 3);
expect("dim per vector matches", vecs.every((v) => v.length === 1024));
expect("deterministic for same input", JSON.stringify(vecs[0]) === JSON.stringify(vecs[1]));
expect("different inputs differ", JSON.stringify(vecs[0]) !== JSON.stringify(vecs[2]));

const mag = Math.sqrt(vecs[0]!.reduce((s, x) => s + x * x, 0));
expect("unit-norm (~1.0)", Math.abs(mag - 1) < 1e-6 || mag === 0, mag);

// pgvector wire format roundtrip
const sql = vectorToSql([0.1, -0.2, 0.3]);
expect("vectorToSql shape", sql === "[0.1,-0.2,0.3]", sql);
const back = sqlToVector(sql);
expect("sqlToVector roundtrip", JSON.stringify(back) === JSON.stringify([0.1, -0.2, 0.3]));
expect("sqlToVector(null) === null", sqlToVector(null) === null);

if (failed > 0) {
  console.error(`\n${failed} embedding smoke check(s) failed`);
  process.exit(1);
}
console.log("\nall embedding smoke checks passed");
