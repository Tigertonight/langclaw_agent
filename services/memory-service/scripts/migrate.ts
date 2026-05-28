import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/db/pool.js";
import { loadConfig } from "../src/config/env.js";
import { logger } from "../src/observability/logger.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.resolve(__dirname, "..", "migrations");

async function ensureMigrationsTable(): Promise<void> {
  const cfg = loadConfig();
  const client = await pool.connect();
  try {
    await client.query(`CREATE SCHEMA IF NOT EXISTS "${cfg.DATABASE_SCHEMA}"`);
    await client.query(`SET search_path TO "${cfg.DATABASE_SCHEMA}", public`);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT now()
      )
    `);
  } finally {
    client.release();
  }
}

async function appliedSet(): Promise<Set<string>> {
  const { rows } = await pool.query<{ id: string }>("SELECT id FROM schema_migrations");
  return new Set(rows.map((r) => r.id));
}

async function run(): Promise<void> {
  await ensureMigrationsTable();
  const applied = await appliedSet();
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith(".sql")).sort();

  for (const file of files) {
    const id = file.replace(/\.sql$/, "");
    if (applied.has(id)) {
      logger.info({ id }, "migration_already_applied");
      continue;
    }
    const sql = await readFile(path.join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [id]);
      await client.query("COMMIT");
      logger.info({ id }, "migration_applied");
    } catch (err) {
      await client.query("ROLLBACK");
      logger.error({ err, id }, "migration_failed");
      throw err;
    } finally {
      client.release();
    }
  }
  await pool.end();
}

run().catch((err) => {
  logger.error({ err }, "migrate_failed");
  process.exit(1);
});
