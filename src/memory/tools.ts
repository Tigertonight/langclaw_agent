import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import { TranscriptStore, type TranscriptEventType } from "../transcript/transcript-store.js";
import type { ToolDefinition, ToolExecutionContext } from "../types/agent-contracts.js";
import { MemoryRetriever } from "./memory-retriever.js";
import { MemoryIndex } from "./memory-index.js";
import { MemoryLearner } from "../evolution/memory-learner.js";
import { defineTool, z, ToolResultBaseSchema } from "../tools/zod-helpers.js";

const memoryRetriever = new MemoryRetriever();
const memoryIndex = new MemoryIndex();
const memoryLearner = new MemoryLearner();
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
      name: "memory.index",
      description: "Read the MEMORY.md index summary for the current user workspace. Shows memory category counts and last update time. Useful for quickly understanding what the agent knows about the user.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      inputSchema: z.object({
        scan_categories: z.boolean().optional().describe("If true, also return a brief text sample from each memory category.")
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const summary = await memoryIndex.load(workspace);
        if (!summary) {
          return { ok: true, tool: "memory.index", data: { exists: false, item_count: 0, categories: {}, updated_at: null } };
        }
        const result: Record<string, unknown> = {
          exists: true,
          item_count: summary.item_count,
          categories: summary.categories,
          updated_at: summary.updated_at
        };
        if (args.scan_categories) {
          const blocks = await memoryIndex.scanCategories(workspace);
          const samples: Record<string, string[]> = {};
          for (const [cat, lines] of blocks) {
            samples[cat] = lines.slice(0, 5);
          }
          result.category_samples = samples;
        }
        return { ok: true, tool: "memory.index", data: result };
      }
    }),
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
    }),

    /* ──────────────────── Phase 6 新增 ──────────────────── */

    defineTool({
      name: "memory.inspect",
      description: "查看某条 memory 条目的完整内容（包含 type / value / confidence / source / 时间戳）。用于 governance 审查或回滚前确认内容。",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      inputSchema: z.object({
        key: z.string().min(1).max(200).describe("memory 条目的 key（精确匹配）"),
        fuzzy: z.boolean().optional().describe("true 时改为前缀/子串匹配，返回所有匹配条目（最多 20 条）")
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const memory = await memoryLearner.load(workspace);
        if (args.fuzzy) {
          const q = args.key.toLowerCase();
          const matches = memory.items.filter((item) =>
            item.key.toLowerCase().includes(q) ||
            (typeof item.value === "string" && item.value.toLowerCase().includes(q))
          ).slice(0, 20);
          return {
            ok: true,
            tool: "memory.inspect",
            data: {
              mode: "fuzzy",
              query: args.key,
              count: matches.length,
              items: matches
            }
          };
        }
        const item = memory.items.find((i) => i.key === args.key);
        if (!item) {
          return { ok: false, tool: "memory.inspect", error: "not_found", message: `memory key "${args.key}" 不存在` };
        }
        return { ok: true, tool: "memory.inspect", data: { item } };
      }
    }),

    defineTool({
      name: "memory.remove",
      description: "从用户 workspace memory 中移除某个 key 的条目。操作不可撤销（但 evolution.rollback 可以在 governance 层禁用该 key 防止重新写入）。",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({
        key: z.string().min(1).max(200).describe("要移除的 memory key"),
        reason: z.string().max(500).optional().describe("移除原因（用于审计）")
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const before = await memoryLearner.load(workspace);
        const existed = before.items.some((i) => i.key === args.key);
        if (!existed) {
          return { ok: false, tool: "memory.remove", error: "not_found", message: `memory key "${args.key}" 不存在` };
        }
        const changed = await memoryLearner.apply({
          workspace,
          actions: [{
            op: "remove",
            key: args.key,
            type: "fact",
            value: "",
            source: `memory.remove:${args.reason ?? "user_request"}`
          }]
        });
        return {
          ok: changed > 0,
          tool: "memory.remove",
          data: {
            key: args.key,
            removed: changed > 0,
            reason: args.reason
          }
        };
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
