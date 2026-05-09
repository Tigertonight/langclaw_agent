import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";

export class InMemorySessionStore {
  constructor() {
    this.sessions = new Map();
  }

  async get(sessionId) {
    return this.sessions.get(sessionId) ?? createSession(sessionId);
  }

  async save(session) {
    this.sessions.set(session.id, {
      ...session,
      updated_at: new Date().toISOString()
    });
  }

  async clear(sessionId) {
    this.sessions.delete(sessionId);
  }
}

export class FileSessionStore {
  constructor({ dir = "logs/sessions" } = {}) {
    this.dir = resolveProjectPath(dir);
  }

  async get(sessionId) {
    const file = this.filePath(sessionId);
    if (!existsSync(file)) return createSession(sessionId);
    try {
      return JSON.parse(await readFile(file, "utf8"));
    } catch {
      return createSession(sessionId);
    }
  }

  async save(session) {
    await mkdir(this.dir, { recursive: true });
    const next = {
      ...session,
      updated_at: new Date().toISOString()
    };
    await writeFile(this.filePath(session.id), JSON.stringify(next, null, 2), "utf8");
  }

  async clear(sessionId) {
    await rm(this.filePath(sessionId), { force: true });
  }

  filePath(sessionId) {
    const safe = sessionId.replace(/[^a-zA-Z0-9_.:-]/g, "_");
    return path.join(this.dir, `${safe}.json`);
  }
}

export function createDefaultSessionId(userId) {
  return `${userId}:default`;
}

export function createSession(sessionId) {
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
