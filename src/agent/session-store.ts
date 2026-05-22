import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import type { WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject, JsonValue } from "../types/agent-contracts.js";

export interface SessionHistoryItem {
  id?: string;
  messageId?: string;
  role?: string;
  text?: string;
  metadata?: JsonObject;
  [key: string]: JsonValue | JsonObject | undefined;
}

export interface AgentSession {
  id: string;
  active_intent: string | null;
  active_skill: string | null;
  scenario: JsonObject | null;
  state: JsonObject;
  history: SessionHistoryItem[];
  status: string;
  created_at: string;
  updated_at: string;
  [key: string]: JsonValue | JsonObject | SessionHistoryItem[] | undefined;
}

export class InMemorySessionStore {
  private readonly sessions: Map<string, AgentSession>;

  constructor() {
    this.sessions = new Map();
  }

  async get(sessionId: string): Promise<AgentSession> {
    return this.sessions.get(sessionId) ?? createSession(sessionId);
  }

  async save(session: AgentSession): Promise<void> {
    this.sessions.set(session.id, {
      ...session,
      updated_at: new Date().toISOString()
    });
  }

  async clear(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

export class FileSessionStore {
  private readonly dir: string;

  constructor({ dir = "logs/sessions" }: { dir?: string } = {}) {
    this.dir = resolveProjectPath(dir);
  }

  async get(sessionId: string): Promise<AgentSession> {
    const file = this.filePath(sessionId);
    if (!existsSync(file)) return createSession(sessionId);
    try {
      return JSON.parse(await readFile(file, "utf8")) as AgentSession;
    } catch {
      return createSession(sessionId);
    }
  }

  async save(session: AgentSession): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    const next = {
      ...session,
      updated_at: new Date().toISOString()
    };
    await writeFile(this.filePath(session.id), JSON.stringify(next, null, 2), "utf8");
  }

  async clear(sessionId: string): Promise<void> {
    await rm(this.filePath(sessionId), { force: true });
  }

  filePath(sessionId: string): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_.:-]/g, "_");
    return path.join(this.dir, `${safe}.json`);
  }
}

export class UserWorkspaceSessionStore {
  async get(sessionId: string, workspace: WorkspaceContext): Promise<AgentSession> {
    const file = this.filePath(sessionId, workspace);
    if (!existsSync(file)) return createSession(sessionId);
    try {
      return JSON.parse(await readFile(file, "utf8")) as AgentSession;
    } catch {
      return createSession(sessionId);
    }
  }

  async save(session: AgentSession, workspace: WorkspaceContext): Promise<void> {
    await mkdir(workspace.sessions_dir, { recursive: true });
    const next = {
      ...session,
      updated_at: new Date().toISOString()
    };
    await writeFile(this.filePath(session.id, workspace), JSON.stringify(next, null, 2), "utf8");
  }

  async clear(sessionId: string, workspace: WorkspaceContext): Promise<void> {
    await rm(this.filePath(sessionId, workspace), { force: true });
  }

  filePath(sessionId: string, workspace: WorkspaceContext): string {
    const safe = sessionId.replace(/[^a-zA-Z0-9_.:-]/g, "_");
    return path.join(workspace.sessions_dir, `${safe}.json`);
  }
}

export function createDefaultSessionId(userId: string): string {
  return `${userId}:default`;
}

export function createSession(sessionId: string): AgentSession {
  return {
    id: sessionId,
    active_intent: null,
    active_skill: null,
    scenario: null,
    state: {},
    history: [],
    status: "idle",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };
}
