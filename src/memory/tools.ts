import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import { TranscriptStore, type TranscriptEventType } from "../transcript/transcript-store.js";
import type { ToolDefinition, ToolExecutionContext } from "../types/agent-contracts.js";
import { MemoryRetriever } from "./memory-retriever.js";
import { defineTool, z, ToolResultBaseSchema } from "../tools/zod-helpers.js";

const memoryRetriever = new MemoryRetriever();
const transcriptStore = new TranscriptStore();

const TRANSCRIPT_EVENT_TYPES = [
  "turn_start", "context_assembly", "user_message", "assistant_answer",
  "tool_call", "tool_result", "agent_step", "task_claimed", "task_updated",
  "route_decision", "tool_governance", "error", "interruption", "turn_end"
] as const;
const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.\-:]+$/);

export function createMemoryTools(): ToolDefinition[] {
  return [
    defineTool({
      name: "memory.retrieve",
      description: "Retrieve relevant user-scoped memory from memory items, episodes, tasks, and transcripts.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      inputSchema: z.object({
        query: z.string().min(1).max(500).describe("Current user request or search query."),
        session_id: idSchema.optional(),
        limit: z.number().int().min(1).max(100).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const items = await memoryRetriever.retrieve(workspace, args.query, {
          sessionId: args.session_id,
          limit: args.limit ?? 12
        });
        return { ok: true, tool: "memory.retrieve", data: { items } };
      }
    }),
    defineTool({
      name: "transcript.search",
      description: "Search persisted session transcript events in the current user workspace.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        limit: z.number().int().min(1).max(100).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const events = await transcriptStore.search(workspace, args.query, args.limit ?? 20);
        return { ok: true, tool: "transcript.search", data: { events } };
      }
    }),
    defineTool({
      name: "session_search",
      description: "FTS5 search across persisted transcript sessions, returning bookends and message windows around matches.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      inputSchema: z.object({
        query: z.string().min(1).max(500),
        limit: z.number().int().min(1).max(50).optional(),
        window: z.number().int().min(1).max(50).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const results = await transcriptStore.sessionSearch(workspace, args.query, {
          limit: args.limit ?? 5,
          window: args.window ?? 5
        });
        return { ok: true, tool: "session_search", data: { results } };
      }
    }),
    defineTool({
      name: "transcript.replay",
      description: "Replay persisted transcript events for a session, optionally filtered by event types.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      inputSchema: z.object({
        session_id: idSchema,
        types: z.array(z.enum(TRANSCRIPT_EVENT_TYPES)).max(14).optional(),
        limit: z.number().int().min(1).max(500).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const events = await transcriptStore.replay(workspace, args.session_id, {
          types: args.types as TranscriptEventType[] | undefined,
          limit: args.limit ?? 200
        });
        return { ok: true, tool: "transcript.replay", data: { events } };
      }
    })
  ];
}

function getWorkspace(context: ToolExecutionContext = {}): WorkspaceContext {
  const workspace = context.workspace;
  if (workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof (workspace as { root?: unknown }).root === "string") {
    return workspace as WorkspaceContext;
  }
  return resolveUserWorkspace(context.user?.id ?? "anonymous");
}
