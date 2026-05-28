import { loadConfig } from "./config/env.js";
import { buildServer } from "./http/server.js";
import { logger } from "./observability/logger.js";
import { pool } from "./db/pool.js";
import { EmbeddingWorker } from "./embedding/worker.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const app = await buildServer();
  const worker = new EmbeddingWorker();
  worker.start();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "shutting_down");
    try {
      await worker.stop();
      await app.close();
      await pool.end();
    } catch (err) {
      logger.error({ err }, "shutdown_error");
    }
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: cfg.HTTP_HOST, port: cfg.HTTP_PORT });
  logger.info({ host: cfg.HTTP_HOST, port: cfg.HTTP_PORT }, "memory_service_started");
}

main().catch((err) => {
  logger.error({ err }, "memory_service_boot_failed");
  process.exit(1);
});
