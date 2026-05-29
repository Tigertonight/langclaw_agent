import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { safeJoinWorkspace, safeUserId, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject } from "../types/agent-contracts.js";
import { SQLiteTranscriptIndex } from "./sqlite-transcript-index.js";

export type TranscriptEventType =
  | "turn_start"
  | "context_ingest"
  | "context_assembly"
  | "user_message"
  | "assistant_answer"
  | "route_decision"
  | "tool_call"
  | "tool_result"
  | "tool_governance"
  | "prompt_authority_alert"
  | "agent_step"
  | "task_claimed"
  | "task_updated"
  | "error"
  | "interruption"
  | "turn_end"
  | "attachments_attached";

export interface TranscriptEvent extends JsonObject {
  id: string;
  at: string;
  session_id: string;
  type: TranscriptEventType;
  data: JsonObject;
}

export class TranscriptStore {
  private readonly index = new SQLiteTranscriptIndex();

  async append(workspace: WorkspaceContext, sessionId: string, type: TranscriptEventType, data: JsonObject): Promise<TranscriptEvent> {
    const event: TranscriptEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      session_id: sessionId,
      type,
      data
    };
    await mkdir(this.dir(workspace), { recursive: true });
    await appendFile(this.filePath(workspace, sessionId), `${JSON.stringify(event)}\n`, "utf8");
    await this.index.indexEvent(workspace, event).catch(() => undefined);
    return event;
  }

  async appendTurn(workspace: WorkspaceContext, sessionId: string, input: {
    runId?: string;
    message: string;
    answer: string;
    route?: unknown;
    toolCalls?: unknown[];
    toolResults?: unknown[];
    agentSteps?: unknown[];
  }): Promise<void> {
    await this.append(workspace, sessionId, "user_message", {
      run_id: input.runId,
      text: input.message,
      route: toJson(input.route)
    });
    for (const call of input.toolCalls ?? []) {
      await this.append(workspace, sessionId, "tool_call", { ...toJsonObject(call), run_id: input.runId });
    }
    for (const result of input.toolResults ?? []) {
      await this.append(workspace, sessionId, "tool_result", { ...toJsonObject(result), run_id: input.runId });
    }
    for (const step of input.agentSteps ?? []) {
      await this.append(workspace, sessionId, "agent_step", { ...toJsonObject(step), run_id: input.runId });
    }
    await this.append(workspace, sessionId, "assistant_answer", { run_id: input.runId, text: input.answer });
    await this.append(workspace, sessionId, "turn_end", {
      run_id: input.runId,
      message_preview: input.message.slice(0, 300),
      answer_preview: input.answer.slice(0, 600)
    });
  }

  async recent(workspace: WorkspaceContext, sessionId: string, limit = 80): Promise<TranscriptEvent[]> {
    const file = this.filePath(workspace, sessionId);
    if (!existsSync(file)) return [];
    const lines = (await readFile(file, "utf8")).trim().split("\n").filter(Boolean);
    return lines.slice(-limit).map((line) => {
      try {
        return JSON.parse(line) as TranscriptEvent;
      } catch {
        return {
          id: `invalid_${Date.now()}`,
          at: new Date().toISOString(),
          session_id: sessionId,
          type: "error",
          data: { invalid: true, raw: line.slice(0, 200) }
        };
      }
    });
  }

  async search(workspace: WorkspaceContext, query: string, limit = 20): Promise<Array<TranscriptEvent & { relevance: number }>> {
    const dir = this.dir(workspace);
    if (!existsSync(dir) || !query.trim()) return [];
    const fs = await import("node:fs/promises");
    const events: TranscriptEvent[] = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const sessionId = entry.name.replace(/\.jsonl$/, "");
      events.push(...await this.recent(workspace, sessionId, 120));
    }
    return events
      .map((event) => ({ ...event, relevance: score(JSON.stringify(event.data), query) }))
      .filter((event) => event.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance || b.at.localeCompare(a.at))
      .slice(0, limit);
  }

  async sessionSearch(workspace: WorkspaceContext, query: string, { limit = 5, window = 5 }: { limit?: number; window?: number } = {}) {
    return this.index.search(workspace, query, { limit, window });
  }

  async replay(workspace: WorkspaceContext, sessionId: string, { types, limit = 200 }: { types?: TranscriptEventType[]; limit?: number } = {}): Promise<TranscriptEvent[]> {
    const events = await this.recent(workspace, sessionId, limit);
    return types?.length ? events.filter((event) => types.includes(event.type)) : events;
  }

  async replayRun(workspace: WorkspaceContext, sessionId: string, runId: string, { types, limit = 400 }: { types?: TranscriptEventType[]; limit?: number } = {}): Promise<TranscriptEvent[]> {
    const events = await this.replay(workspace, sessionId, { types, limit });
    return events.filter((event) => event.data?.run_id === runId);
  }

  dir(workspace: WorkspaceContext): string {
    return safeJoinWorkspace(workspace.root, "transcripts");
  }

  filePath(workspace: WorkspaceContext, sessionId: string): string {
    return path.join(this.dir(workspace), `${safeUserId(sessionId)}.jsonl`);
  }
}

function score(text: string, query: string): number {
  const haystack = text.toLowerCase();
  const tokens = String(query ?? "").toLowerCase().split(/[^a-z0-9_\u4e00-\u9fa5]+/u).filter((item) => item.length >= 2);
  if (!tokens.length) return 0;
  let hits = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) hits += 1;
  }
  return hits / tokens.length;
}

function toJson(value: unknown) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function toJsonObject(value: unknown): JsonObject {
  const normalized = toJson(value);
  return normalized && typeof normalized === "object" && !Array.isArray(normalized) ? normalized : { value: normalized };
}
