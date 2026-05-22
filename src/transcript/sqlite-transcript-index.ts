import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { safeJoinWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject } from "../types/agent-contracts.js";
import type { TranscriptEvent, TranscriptEventType } from "./transcript-store.js";

const execFileAsync = promisify(execFile);

export interface SessionSearchResult extends JsonObject {
  session_id: string;
  match_event_id: string;
  match_type: TranscriptEventType;
  snippet: string;
  bookend_start: JsonObject[];
  messages: JsonObject[];
  bookend_end: JsonObject[];
  messages_before: number;
  messages_after: number;
  relevance: number;
}

export class SQLiteTranscriptIndex {
  async indexEvent(workspace: WorkspaceContext, event: TranscriptEvent): Promise<void> {
    await this.ensure(workspace);
    const text = eventText(event);
    await this.exec(workspace, [
      `INSERT OR REPLACE INTO transcript_events (id, session_id, at, type, text, data_json) VALUES (${sql(event.id)}, ${sql(event.session_id)}, ${sql(event.at)}, ${sql(event.type)}, ${sql(text)}, ${sql(JSON.stringify(event.data ?? {}))});`
    ]);
  }

  async search(workspace: WorkspaceContext, query: string, { limit = 5, window = 5 }: { limit?: number; window?: number } = {}): Promise<SessionSearchResult[]> {
    if (!query.trim()) return [];
    await this.ensure(workspace);
    const matchQuery = ftsQuery(query);
    const rows = await this.query(workspace, `
      SELECT id, session_id, at, type, snippet(transcript_events, 4, '[', ']', '...', 16) AS snippet,
             bm25(transcript_events) AS rank
      FROM transcript_events
      WHERE transcript_events MATCH ${sql(matchQuery)}
      ORDER BY rank
      LIMIT ${Math.max(1, Math.min(limit, 20))};
    `);
    const results: SessionSearchResult[] = [];
    for (const row of rows) {
      const sessionId = String(row.session_id ?? "");
      const matchId = String(row.id ?? "");
      const sessionEvents = await this.eventsForSession(workspace, sessionId);
      const matchIndex = sessionEvents.findIndex((event) => event.id === matchId);
      const before = matchIndex < 0 ? 0 : matchIndex;
      const after = matchIndex < 0 ? 0 : Math.max(0, sessionEvents.length - matchIndex - 1);
      results.push({
        session_id: sessionId,
        match_event_id: matchId,
        match_type: String(row.type ?? "turn_end") as TranscriptEventType,
        snippet: String(row.snippet ?? ""),
        bookend_start: compactEvents(sessionEvents.slice(0, 6)),
        messages: compactEvents(sessionEvents.slice(Math.max(0, matchIndex - window), matchIndex + window + 1)),
        bookend_end: compactEvents(sessionEvents.slice(-6)),
        messages_before: before,
        messages_after: after,
        relevance: Number(Math.max(0, 1 / (1 + Math.abs(Number(row.rank ?? 0)))).toFixed(4))
      });
    }
    return results;
  }

  async eventsForSession(workspace: WorkspaceContext, sessionId: string): Promise<TranscriptEvent[]> {
    await this.ensure(workspace);
    const rows = await this.query(workspace, `
      SELECT id, session_id, at, type, data_json
      FROM transcript_events
      WHERE session_id = ${sql(sessionId)}
      ORDER BY at ASC;
    `);
    return rows.map((row) => ({
      id: String(row.id ?? ""),
      session_id: String(row.session_id ?? ""),
      at: String(row.at ?? ""),
      type: String(row.type ?? "turn_end") as TranscriptEventType,
      data: parseJsonObject(row.data_json)
    }));
  }

  dbPath(workspace: WorkspaceContext): string {
    return safeJoinWorkspace(workspace.root, "transcripts", "transcripts.db");
  }

  private async ensure(workspace: WorkspaceContext): Promise<void> {
    await mkdir(path.dirname(this.dbPath(workspace)), { recursive: true });
    await this.exec(workspace, [
      "CREATE VIRTUAL TABLE IF NOT EXISTS transcript_events USING fts5(id UNINDEXED, session_id UNINDEXED, at UNINDEXED, type UNINDEXED, text, data_json UNINDEXED);"
    ]);
  }

  private async exec(workspace: WorkspaceContext, statements: string[]): Promise<void> {
    await execFileAsync("sqlite3", [this.dbPath(workspace), statements.join("\n")], { maxBuffer: 1024 * 1024 * 8 });
  }

  private async query(workspace: WorkspaceContext, statement: string): Promise<JsonObject[]> {
    const { stdout } = await execFileAsync("sqlite3", ["-json", this.dbPath(workspace), statement], { maxBuffer: 1024 * 1024 * 8 });
    if (!stdout.trim()) return [];
    return JSON.parse(stdout) as JsonObject[];
  }
}

function eventText(event: TranscriptEvent): string {
  const data = event.data ?? {};
  return [
    event.type,
    typeof data.text === "string" ? data.text : "",
    typeof data.message_preview === "string" ? data.message_preview : "",
    typeof data.answer_preview === "string" ? data.answer_preview : "",
    JSON.stringify(data)
  ].join("\n");
}

function compactEvents(events: TranscriptEvent[]): JsonObject[] {
  return events.map((event) => ({
    id: event.id,
    at: event.at,
    type: event.type,
    preview: eventText(event).slice(0, 600)
  }));
}

function sql(value: unknown): string {
  return `'${String(value ?? "").replace(/'/g, "''")}'`;
}

function ftsQuery(query: string): string {
  return String(query ?? "")
    .split(/[^a-zA-Z0-9_\u4e00-\u9fa5]+/u)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => `"${item.replace(/"/g, '""')}"`)
    .join(" OR ") || "\"\"";
}

function parseJsonObject(value: unknown): JsonObject {
  try {
    const parsed = JSON.parse(String(value ?? "{}"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
  } catch {
    return {};
  }
}
