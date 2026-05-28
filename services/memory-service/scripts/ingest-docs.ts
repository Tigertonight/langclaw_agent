/**
 * Bulk-ingest a directory of markdown files via the running memory-service.
 *
 * Usage:
 *   tsx scripts/ingest-docs.ts <dir> --business <id> --user <id> [--category <c>]
 *   [--service <http://host:port>] [--scope memory:write,memory:read]
 *
 * Walks <dir> recursively, picks up .md / .markdown files, posts in batches of
 * 25 to POST /v1/documents/ingest. Source path is the file path relative to <dir>.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { request } from "undici";
import { signIdentity } from "../src/http/identity.js";
import { loadConfig } from "../src/config/env.js";

interface Args {
  dir: string;
  businessId: string;
  userId: string;
  category?: string;
  serviceUrl: string;
  scope: string[];
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  const flags: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const value = argv[i + 1] ?? "";
      flags[key] = value;
      i += 1;
    } else {
      positional.push(a);
    }
  }
  if (positional.length === 0) throw new Error("missing <dir> argument");
  if (!flags.business) throw new Error("--business <id> required");
  if (!flags.user) throw new Error("--user <id> required");
  return {
    dir: positional[0]!,
    businessId: flags.business!,
    userId: flags.user!,
    category: flags.category || undefined,
    serviceUrl: flags.service || `http://localhost:${loadConfig().HTTP_PORT}`,
    scope: (flags.scope ?? "memory:write,memory:read").split(",").map((s) => s.trim()).filter(Boolean)
  };
}

async function* walk(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walk(full);
    } else if (e.isFile() && /\.(md|markdown)$/i.test(e.name)) {
      yield full;
    }
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const root = (await stat(args.dir)).isDirectory() ? args.dir : args.dir;
  const files: string[] = [];
  for await (const f of walk(root)) files.push(f);
  console.log(`found ${files.length} markdown files under ${root}`);
  if (files.length === 0) return;

  const cfg = loadConfig();
  const token = signIdentity({
    business_id: args.businessId,
    user_id: args.userId,
    issued_at: Math.floor(Date.now() / 1000),
    scope: args.scope
  });

  const headers = {
    "content-type": "application/json",
    [cfg.SERVICE_TOKEN_HEADER]: token
  };

  const BATCH = 25;
  let ingested = 0;
  let unchanged = 0;
  let updated = 0;
  for (let i = 0; i < files.length; i += BATCH) {
    const slice = files.slice(i, i + BATCH);
    const items = await Promise.all(slice.map(async (f) => {
      const content = await readFile(f, "utf8");
      return {
        source_path: relative(root, f),
        content,
        ...(args.category ? { category: args.category } : {})
      };
    }));
    const url = `${args.serviceUrl.replace(/\/$/, "")}/v1/documents/ingest`;
    const res = await request(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ items })
    });
    const text = await res.body.text();
    if (res.statusCode >= 400) {
      console.error(`batch ${i}-${i + slice.length} failed: ${res.statusCode} ${text}`);
      process.exitCode = 1;
      return;
    }
    const parsed = JSON.parse(text) as { results: { source_path: string; status: string }[] };
    for (const r of parsed.results) {
      if (r.status === "ingested") ingested += 1;
      else if (r.status === "updated") updated += 1;
      else if (r.status === "unchanged") unchanged += 1;
    }
    console.log(`  batch ${i + slice.length}/${files.length} ok`);
  }
  console.log(`done: ingested=${ingested} updated=${updated} unchanged=${unchanged}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
