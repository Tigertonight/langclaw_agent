import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import { TranscriptStore } from "../transcript/transcript-store.js";
import type { JsonObject, ToolDefinition, ToolExecutionContext } from "../types/agent-contracts.js";
import { MemoryRetriever } from "./memory-retriever.js";

const memoryRetriever = new MemoryRetriever();
const transcriptStore = new TranscriptStore();

export function createMemoryTools(): ToolDefinition[] {
  return [
    {
      name: "memory.retrieve",
      description: "Retrieve relevant user-scoped memory from memory items, episodes, tasks, and transcripts.",
      metadata: {
        required_permissions: [],
        risk_level: "read",
        expose_to_agentic: true
      },
      schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Current user request or search query." },
          session_id: { type: "string", description: "Optional session id to prioritize current transcript." },
          limit: { type: "number", description: "Maximum items to return." }
        },
        required: ["query"]
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const query = typeof args?.query === "string" ? args.query : "";
        if (!query.trim()) return { ok: false, tool: "memory.retrieve", error: "missing_query" };
        const items = await memoryRetriever.retrieve(workspace, query, {
          sessionId: typeof args?.session_id === "string" ? args.session_id : undefined,
          limit: readLimit(args?.limit, 12)
        });
        return { ok: true, tool: "memory.retrieve", data: { items } };
      }
    },
    {
      name: "transcript.search",
      description: "Search persisted session transcript events in the current user workspace.",
      metadata: {
        required_permissions: [],
        risk_level: "read",
        expose_to_agentic: true
      },
      schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          limit: { type: "number", description: "Maximum transcript events to return." }
        },
        required: ["query"]
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const query = typeof args?.query === "string" ? args.query : "";
        if (!query.trim()) return { ok: false, tool: "transcript.search", error: "missing_query" };
        const events = await transcriptStore.search(workspace, query, readLimit(args?.limit, 20));
        return { ok: true, tool: "transcript.search", data: { events } };
      }
    },
    {
      name: "session_search",
      description: "FTS5 search across persisted transcript sessions, returning bookends and message windows around matches.",
      metadata: {
        required_permissions: [],
        risk_level: "read",
        expose_to_agentic: true
      },
      schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query." },
          limit: { type: "number", description: "Maximum sessions/events to return." },
          window: { type: "number", description: "Number of events around the match." }
        },
        required: ["query"]
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const query = typeof args?.query === "string" ? args.query : "";
        if (!query.trim()) return { ok: false, tool: "session_search", error: "missing_query" };
        const results = await transcriptStore.sessionSearch(workspace, query, {
          limit: readLimit(args?.limit, 5),
          window: readLimit(args?.window, 5)
        });
        return { ok: true, tool: "session_search", data: { results } };
      }
    },
    {
      name: "transcript.replay",
      description: "Replay persisted transcript events for a session, optionally filtered by event types.",
      metadata: {
        required_permissions: [],
        risk_level: "read",
        expose_to_agentic: true
      },
      schema: {
        type: "object",
        properties: {
          session_id: { type: "string", description: "Session id to replay." },
          types: { type: "array", description: "Optional transcript event types." },
          limit: { type: "number", description: "Maximum events to return." }
        },
        required: ["session_id"]
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const sessionId = typeof args?.session_id === "string" ? args.session_id : "";
        if (!sessionId) return { ok: false, tool: "transcript.replay", error: "missing_session_id" };
        const types = Array.isArray(args?.types) ? args.types.map(String) as Parameters<TranscriptStore["replay"]>[2]["types"] : undefined;
        const events = await transcriptStore.replay(workspace, sessionId, { types, limit: readLimit(args?.limit, 200) });
        return { ok: true, tool: "transcript.replay", data: { events } };
      }
    }
  ];
}

function getWorkspace(context: ToolExecutionContext = {}): WorkspaceContext {
  const workspace = context.workspace;
  if (workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof (workspace as { root?: unknown }).root === "string") {
    return workspace as WorkspaceContext;
  }
  return resolveUserWorkspace(context.user?.id ?? "anonymous");
}

function readLimit(value: unknown, fallback: number): number {
  const limit = Number(value);
  return Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : fallback;
}
