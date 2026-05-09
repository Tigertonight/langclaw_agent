import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";

export async function appendConversationLog(entry) {
  const dir = resolveProjectPath("logs");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "conversations.jsonl");
  await appendFile(file, `${JSON.stringify({ ...entry, ts: new Date().toISOString() })}\n`, "utf8");
}

export async function appendAuditEvent(event) {
  const dir = resolveProjectPath("logs");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "audit_events.jsonl");
  await appendFile(file, `${JSON.stringify({ ...event, ts: new Date().toISOString() })}\n`, "utf8");
}
