import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "./provider.js";

/**
 * Deterministic hash-based pseudo-embedding for local dev / CI / smoke tests.
 * Quality is intentionally bad — only the API surface and reembed pipeline
 * are exercised. Production traffic must use a real model provider.
 */
export class HashFallbackProvider implements EmbeddingProvider {
  readonly modelTag = "hash-fallback:v1";
  readonly dimensions: number;

  constructor(dimensions = 1024) {
    this.dimensions = dimensions;
  }

  async healthCheck(): Promise<void> {
    // no-op
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const out = new Array<number>(this.dimensions).fill(0);
    const tokens = tokenize(text);
    if (tokens.length === 0) return normalize(out);
    for (const token of tokens) {
      const hash = sha256u32(token);
      for (let i = 0; i < 4; i += 1) {
        const slot = (hash[i]! ?? 0) % this.dimensions;
        const sign = ((hash[(i + 4) % hash.length]! ?? 0) & 1) === 1 ? 1 : -1;
        out[slot] = (out[slot] ?? 0) + sign;
      }
    }
    return normalize(out);
  }
}

function tokenize(text: string): string[] {
  // ASCII words + 2-grams over CJK
  const lower = text.toLowerCase();
  const words = lower.match(/[a-z0-9]+/g) ?? [];
  const cjk = lower.replace(/[a-z0-9\s]+/g, " ");
  const grams: string[] = [];
  for (let i = 0; i < cjk.length - 1; i += 1) {
    const a = cjk[i]!;
    const b = cjk[i + 1]!;
    if (/\s/.test(a) || /\s/.test(b)) continue;
    if (a.charCodeAt(0) < 0x80 || b.charCodeAt(0) < 0x80) continue;
    grams.push(a + b);
  }
  return [...words, ...grams];
}

function sha256u32(input: string): number[] {
  const buf = createHash("sha256").update(input).digest();
  const out: number[] = [];
  for (let i = 0; i < buf.length; i += 4) {
    out.push(buf.readUInt32BE(i));
  }
  return out;
}

function normalize(vec: number[]): number[] {
  let mag = 0;
  for (const v of vec) mag += v * v;
  mag = Math.sqrt(mag);
  if (mag === 0) return vec;
  return vec.map((v) => v / mag);
}
