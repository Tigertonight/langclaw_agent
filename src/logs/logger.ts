import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import type { JsonObject } from "../types/agent-contracts.js";

export async function appendConversationLog(entry: JsonObject): Promise<void> {
  await appendJsonLine("conversations.jsonl", entry);
}

export async function appendAuditEvent(event: JsonObject): Promise<void> {
  await appendJsonLine("audit_events.jsonl", event);
}

async function appendJsonLine(fileName: string, entry: JsonObject): Promise<void> {
  const dir = resolveProjectPath("logs");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, fileName);
  await appendFile(file, `${JSON.stringify({ ...entry, ts: new Date().toISOString() })}\n`, "utf8");
}
