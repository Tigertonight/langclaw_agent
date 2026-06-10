import { OpenUILangEnvelopeStore, type PersistedEnvelope, type SessionEnvelopeRecord } from "./envelope-store.js";
import type { WorkspaceContext } from "../runtime/workspace-context.js";
import { legacyEnvelopeToOpenUILangEvent, legacyEnvelopesToOpenUILangDocument } from "./legacy-adapter.js";
import type { OpenUILangCompatEnvelope, OpenUILangDocument, OpenUILangWireEvent } from "./types.js";

export interface OpenUILangPersistedEvent {
  seq: number;
  ts: string;
  protocol: "openui-lang/1.0";
  type: "openui_envelope";
  openui_event: OpenUILangWireEvent | null;
  compatibilityEnvelope: OpenUILangCompatEnvelope;
}

export interface OpenUILangHistoryRun {
  session_id: string;
  run_id: string;
  trace_id?: string;
  protocol: "openui-lang/1.0";
  events: OpenUILangPersistedEvent[];
  document: OpenUILangDocument;
  updated_at: string;
}

/**
 * OpenUI Lang history facade.
 *
 * The current on-disk file is still the legacy compatibility envelope store,
 * but new callers should consume OpenUI Lang events/documents through this
 * wrapper instead of depending on legacy A2UI store aliases directly.
 */
export class OpenUILangHistoryStore {
  constructor(private readonly compatibilityStore = new OpenUILangEnvelopeStore()) {}

  get legacyCompatibilityStore(): OpenUILangEnvelopeStore {
    return this.compatibilityStore;
  }

  async appendCompatibilityEnvelope(workspace: WorkspaceContext, input: {
    sessionId: string;
    runId: string;
    traceId?: string;
    envelope: OpenUILangCompatEnvelope;
  }): Promise<OpenUILangPersistedEvent> {
    return toPersistedEvent(await this.compatibilityStore.append(workspace, input));
  }

  async latestRun(workspace: WorkspaceContext, sessionId: string): Promise<OpenUILangHistoryRun | null> {
    const run = await this.compatibilityStore.latestRun(workspace, sessionId);
    return run ? toHistoryRun(run) : null;
  }

  async listRuns(workspace: WorkspaceContext, sessionId: string): Promise<OpenUILangHistoryRun[]> {
    const runs = await this.compatibilityStore.listRuns(workspace, sessionId);
    return runs.map(toHistoryRun);
  }

  async listEventsSince(workspace: WorkspaceContext, sessionId: string, runId: string, sinceSeq: number): Promise<OpenUILangPersistedEvent[]> {
    const items = await this.compatibilityStore.listEnvelopesSince(workspace, sessionId, runId, sinceSeq);
    return items.map(toPersistedEvent);
  }

  filePath(workspace: WorkspaceContext): string {
    return this.compatibilityStore.filePath(workspace);
  }
}

function toHistoryRun(run: SessionEnvelopeRecord): OpenUILangHistoryRun {
  const envelopes = run.envelopes.map((item) => item.envelope);
  return {
    session_id: run.session_id,
    run_id: run.run_id,
    trace_id: run.trace_id,
    protocol: "openui-lang/1.0",
    events: run.envelopes.map(toPersistedEvent),
    document: legacyEnvelopesToOpenUILangDocument(envelopes),
    updated_at: run.updated_at
  };
}

function toPersistedEvent(item: PersistedEnvelope): OpenUILangPersistedEvent {
  return {
    seq: item.seq,
    ts: item.ts,
    protocol: "openui-lang/1.0",
    type: "openui_envelope",
    openui_event: legacyEnvelopeToOpenUILangEvent(item.envelope),
    compatibilityEnvelope: item.envelope
  };
}
