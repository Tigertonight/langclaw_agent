import { safeJoinWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import { defaultJsonFileStore, type JsonFileStore } from "../runtime/store-adapter.js";
import type { OpenUILangCompatEnvelope } from "./types.js";

export interface PersistedEnvelope {
  seq: number;
  envelope: OpenUILangCompatEnvelope;
  ts: string;
}

export interface SessionEnvelopeRecord {
  session_id: string;
  run_id: string;
  trace_id?: string;
  envelopes: PersistedEnvelope[];
  updated_at: string;
}

interface SessionRunFile {
  version: 1;
  sessions: Record<string, SessionRecord>;
}

interface SessionRecord {
  session_id: string;
  runs: Record<string, SessionEnvelopeRecord>;
  updated_at: string;
}

const MAX_RUNS_PER_SESSION = 20;
const MAX_ENVELOPES_PER_RUN = 500;

export class OpenUILangEnvelopeStore {
  private readonly store: JsonFileStore;

  constructor(store: JsonFileStore = defaultJsonFileStore()) {
    this.store = store;
  }

  async append(workspace: WorkspaceContext, input: {
    sessionId: string;
    runId: string;
    traceId?: string;
    envelope: OpenUILangCompatEnvelope;
  }): Promise<PersistedEnvelope> {
    let persisted: PersistedEnvelope | null = null;
    await this.store.mutate<SessionRunFile>(this.filePath(workspace), { version: 1, sessions: {} }, (file) => {
      const normalized = file?.version === 1 && file.sessions && typeof file.sessions === "object"
        ? file
        : { version: 1 as const, sessions: {} };
      const sessionRecord = normalized.sessions[input.sessionId]
        ?? { session_id: input.sessionId, runs: {}, updated_at: new Date().toISOString() };
      const runRecord = sessionRecord.runs[input.runId] ?? {
        session_id: input.sessionId,
        run_id: input.runId,
        trace_id: input.traceId,
        envelopes: [],
        updated_at: new Date().toISOString()
      };
      const seq = (runRecord.envelopes[runRecord.envelopes.length - 1]?.seq ?? 0) + 1;
      const next: PersistedEnvelope = { seq, envelope: input.envelope, ts: new Date().toISOString() };
      runRecord.envelopes.push(next);
      if (runRecord.envelopes.length > MAX_ENVELOPES_PER_RUN) {
        runRecord.envelopes.splice(0, runRecord.envelopes.length - MAX_ENVELOPES_PER_RUN);
      }
      runRecord.updated_at = next.ts;
      sessionRecord.runs[input.runId] = runRecord;
      sessionRecord.updated_at = next.ts;
      this.evictRuns(sessionRecord);
      normalized.sessions[input.sessionId] = sessionRecord;
      persisted = next;
      return normalized;
    });
    if (!persisted) throw new Error("OpenUI Lang envelope append produced no record");
    return persisted;
  }

  async listEnvelopesSince(workspace: WorkspaceContext, sessionId: string, runId: string, sinceSeq: number): Promise<PersistedEnvelope[]> {
    const file = await this.load(workspace);
    const run = file.sessions[sessionId]?.runs[runId];
    if (!run) return [];
    return run.envelopes.filter((item) => item.seq > sinceSeq);
  }

  async latestRun(workspace: WorkspaceContext, sessionId: string): Promise<SessionEnvelopeRecord | null> {
    const file = await this.load(workspace);
    const session = file.sessions[sessionId];
    if (!session) return null;
    let latest: SessionEnvelopeRecord | null = null;
    for (const run of Object.values(session.runs)) {
      if (!latest || Date.parse(run.updated_at) > Date.parse(latest.updated_at)) latest = run;
    }
    return latest;
  }

  async listRuns(workspace: WorkspaceContext, sessionId: string): Promise<SessionEnvelopeRecord[]> {
    const file = await this.load(workspace);
    const session = file.sessions[sessionId];
    if (!session) return [];
    return Object.values(session.runs).sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
  }

  filePath(workspace: WorkspaceContext): string {
    return safeJoinWorkspace(workspace.root, "runtime", "a2ui-envelopes.json");
  }

  private async load(workspace: WorkspaceContext): Promise<SessionRunFile> {
    const raw = await this.store.read<unknown>(this.filePath(workspace), { version: 1, sessions: {} });
    if (raw && typeof raw === "object" && (raw as SessionRunFile).version === 1 && (raw as SessionRunFile).sessions) {
      return raw as SessionRunFile;
    }
    return { version: 1, sessions: {} };
  }

  private evictRuns(session: SessionRecord): void {
    const runs = Object.values(session.runs);
    if (runs.length <= MAX_RUNS_PER_SESSION) return;
    runs.sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at));
    const toRemove = runs.slice(0, runs.length - MAX_RUNS_PER_SESSION);
    for (const run of toRemove) delete session.runs[run.run_id];
  }
}
