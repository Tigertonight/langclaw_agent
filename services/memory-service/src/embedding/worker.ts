import { pool } from "../db/pool.js";
import { logger } from "../observability/logger.js";
import { getEmbeddingProvider, type EmbeddingProvider } from "./index.js";
import { vectorToSql } from "./serialize.js";

interface PendingRow {
  id: string;
  content: string;
}

interface EmbedTargetTable {
  table: "memories" | "document_chunks";
}

export interface WorkerOptions {
  batchSize?: number;
  pollIntervalMs?: number;
  provider?: EmbeddingProvider;
}

const DEFAULT_BATCH = 16;
const DEFAULT_POLL = 2_000;

export class EmbeddingWorker {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private inflight: Promise<void> = Promise.resolve();
  private readonly provider: EmbeddingProvider;
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;

  constructor(opts: WorkerOptions = {}) {
    this.provider = opts.provider ?? getEmbeddingProvider();
    this.batchSize = opts.batchSize ?? DEFAULT_BATCH;
    this.pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const tick = async () => {
      if (!this.running) return;
      this.inflight = this.runOnce().then(() => undefined).catch((err) => {
        logger.error({ err }, "embedding_worker_tick_failed");
      });
      await this.inflight;
      if (this.running) {
        this.timer = setTimeout(() => void tick(), this.pollIntervalMs);
      }
    };
    void tick();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.inflight;
  }

  /** Drain one full pass across both tables. Used by tests + reembed CLI. */
  async drain(): Promise<{ memories: number; chunks: number }> {
    let memories = 0;
    let chunks = 0;
    for (;;) {
      const round = await this.runOnce();
      memories += round.memories;
      chunks += round.chunks;
      if (round.memories === 0 && round.chunks === 0) break;
    }
    return { memories, chunks };
  }

  private async runOnce(): Promise<{ memories: number; chunks: number }> {
    const m = await this.processTable({ table: "memories" });
    const c = await this.processTable({ table: "document_chunks" });
    return { memories: m, chunks: c };
  }

  private async processTable(target: EmbedTargetTable): Promise<number> {
    const rows = await this.fetchPending(target.table);
    if (rows.length === 0) return 0;
    const vectors = await this.provider.embed(rows.map((r) => r.content));
    await this.persist(target.table, rows, vectors);
    logger.info({ table: target.table, count: rows.length, model: this.provider.modelTag }, "embedding_worker_persisted");
    return rows.length;
  }

  private async fetchPending(table: "memories" | "document_chunks"): Promise<PendingRow[]> {
    const sql = `
      SELECT id, content
      FROM ${table}
      WHERE (embedding IS NULL OR embedding_model IS DISTINCT FROM $1)
        ${table === "memories" ? "AND deleted_at IS NULL" : ""}
      ORDER BY created_at ASC
      LIMIT $2
    `;
    const { rows } = await pool.query<PendingRow>(sql, [this.provider.modelTag, this.batchSize]);
    return rows;
  }

  private async persist(table: "memories" | "document_chunks", rows: PendingRow[], vectors: number[][]): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (let i = 0; i < rows.length; i += 1) {
        await client.query(
          `UPDATE ${table}
             SET embedding = $1::vector,
                 embedding_model = $2,
                 embedded_at = now()
           WHERE id = $3`,
          [vectorToSql(vectors[i]!), this.provider.modelTag, rows[i]!.id]
        );
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
