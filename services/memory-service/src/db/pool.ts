import pg from "pg";
import { loadConfig } from "../config/env.js";

const cfg = loadConfig();

export const pool = new pg.Pool({
  connectionString: cfg.DATABASE_URL,
  max: cfg.DATABASE_POOL_MAX,
  idleTimeoutMillis: 30_000
});

pool.on("connect", async (client) => {
  await client.query(`SET search_path TO "${cfg.DATABASE_SCHEMA}", public`);
});

export async function pingDatabase(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT 1");
  } finally {
    client.release();
  }
}
