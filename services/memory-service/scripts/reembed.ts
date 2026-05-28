/**
 * scripts/reembed.ts — replay all rows whose embedding_model differs from the
 * active provider's tag (or whose embedding is NULL). Used when switching
 * embedding models per spec §2.3.
 */

import { EmbeddingWorker } from "../src/embedding/worker.js";
import { logger } from "../src/observability/logger.js";
import { pool } from "../src/db/pool.js";
import { loadConfig } from "../src/config/env.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  logger.info({ provider: cfg.EMBEDDING_PROVIDER, modelTag: cfg.EMBEDDING_MODEL_TAG }, "reembed_starting");
  const worker = new EmbeddingWorker({ batchSize: 32 });
  const summary = await worker.drain();
  logger.info(summary, "reembed_complete");
  await pool.end();
}

main().catch(async (err) => {
  logger.error({ err }, "reembed_failed");
  await pool.end().catch(() => undefined);
  process.exit(1);
});
