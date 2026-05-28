import { request } from "undici";
import { EmbeddingError, type EmbeddingProvider } from "./provider.js";

interface BgeM3OllamaConfig {
  baseUrl: string;
  model: string;
  modelTag: string;
  dimensions: number;
  timeoutMs?: number;
  batchSize?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BATCH_SIZE = 16;

/**
 * BGE-M3 via local Ollama. Calls /api/embeddings per text — Ollama doesn't
 * expose a true batch endpoint, so we fan out concurrently per batch.
 */
export class BgeM3OllamaProvider implements EmbeddingProvider {
  readonly modelTag: string;
  readonly dimensions: number;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly batchSize: number;

  constructor(cfg: BgeM3OllamaConfig) {
    this.baseUrl = cfg.baseUrl.replace(/\/$/, "");
    this.model = cfg.model;
    this.modelTag = cfg.modelTag;
    this.dimensions = cfg.dimensions;
    this.timeoutMs = cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.batchSize = cfg.batchSize ?? DEFAULT_BATCH_SIZE;
  }

  async healthCheck(): Promise<void> {
    try {
      const res = await request(`${this.baseUrl}/api/tags`, { method: "GET" });
      if (res.statusCode >= 400) {
        throw new EmbeddingError(`ollama /api/tags returned ${res.statusCode}`);
      }
      await res.body.dump();
    } catch (err) {
      throw new EmbeddingError("ollama health check failed", err);
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = new Array(texts.length);
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const chunk = texts.slice(i, i + this.batchSize);
      const vectors = await Promise.all(chunk.map((t) => this.embedOne(t)));
      for (let j = 0; j < vectors.length; j += 1) {
        out[i + j] = vectors[j]!;
      }
    }
    return out;
  }

  private async embedOne(text: string): Promise<number[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await request(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
        signal: controller.signal
      });
      if (res.statusCode >= 400) {
        const body = await res.body.text();
        throw new EmbeddingError(`ollama embed returned ${res.statusCode}: ${body.slice(0, 200)}`);
      }
      const json = (await res.body.json()) as { embedding?: unknown };
      if (!Array.isArray(json.embedding)) {
        throw new EmbeddingError("ollama embed response missing embedding array");
      }
      const vec = json.embedding as number[];
      if (vec.length !== this.dimensions) {
        throw new EmbeddingError(`embedding dim mismatch: expected ${this.dimensions}, got ${vec.length}`);
      }
      return vec;
    } catch (err) {
      if (err instanceof EmbeddingError) throw err;
      throw new EmbeddingError("ollama embed call failed", err);
    } finally {
      clearTimeout(timer);
    }
  }
}
