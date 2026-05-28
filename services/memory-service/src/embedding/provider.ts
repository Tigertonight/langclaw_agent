export interface EmbeddingProvider {
  /** Stable identifier written into `embedding_model` column. */
  readonly modelTag: string;
  /** Vector dimensionality. Used to validate pgvector columns. */
  readonly dimensions: number;
  /** Best-effort liveness check; throws on hard failure. */
  healthCheck(): Promise<void>;
  /** Embed a batch of texts. Returns vectors in the same order. */
  embed(texts: string[]): Promise<number[][]>;
}

export class EmbeddingError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "EmbeddingError";
  }
}
