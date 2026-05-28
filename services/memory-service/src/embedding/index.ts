import { loadConfig } from "../config/env.js";
import { BgeM3OllamaProvider } from "./bge-m3-ollama.js";
import { HashFallbackProvider } from "./hash-fallback.js";
import type { EmbeddingProvider } from "./provider.js";

let cached: EmbeddingProvider | null = null;

export function getEmbeddingProvider(): EmbeddingProvider {
  if (cached) return cached;
  const cfg = loadConfig();
  if (cfg.EMBEDDING_PROVIDER === "bge-m3-ollama") {
    cached = new BgeM3OllamaProvider({
      baseUrl: cfg.OLLAMA_BASE_URL,
      model: cfg.OLLAMA_EMBED_MODEL,
      modelTag: cfg.EMBEDDING_MODEL_TAG,
      dimensions: cfg.EMBEDDING_DIMENSIONS
    });
  } else {
    cached = new HashFallbackProvider(cfg.EMBEDDING_DIMENSIONS);
  }
  return cached;
}

export function resetEmbeddingProvider(): void {
  cached = null;
}

export type { EmbeddingProvider } from "./provider.js";
export { EmbeddingError } from "./provider.js";
