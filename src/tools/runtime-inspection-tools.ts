import { ContextAssembler } from "../runtime/context-assembler.js";
import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import { TranscriptStore, type TranscriptEventType } from "../transcript/transcript-store.js";
import type { JsonObject, ToolDefinition, ToolExecutionContext, ToolMetadata } from "../types/agent-contracts.js";
import { defineTool, z, ToolResultBaseSchema } from "./zod-helpers.js";

const TRANSCRIPT_EVENT_TYPES = [
  "turn_start", "context_assembly", "user_message", "assistant_answer",
  "tool_call", "tool_result", "agent_step", "task_claimed", "task_updated",
  "route_decision", "tool_governance", "error", "interruption", "turn_end"
] as const;
const idSchema = z.string().min(1).max(128).regex(/^[A-Za-z0-9_.\-:]+$/);

interface EnterpriseContextProviderLike {
  load(input: { user: NonNullable<ToolExecutionContext["user"]>; workspace: WorkspaceContext; message?: string; sessionId?: string }): Promise<unknown>;
}

interface ToolRegistryLike {
  list(input?: ToolExecutionContext): Array<{ name: string; description?: string; schema?: JsonObject; metadata?: ToolMetadata }>;
}

export function createRuntimeInspectionTools({
  transcriptStore = new TranscriptStore(),
  enterpriseContextProvider,
  toolRegistry
}: {
  transcriptStore?: TranscriptStore;
  enterpriseContextProvider: EnterpriseContextProviderLike;
  toolRegistry: ToolRegistryLike;
}): ToolDefinition[] {
  const assembler = new ContextAssembler();
  return [
    defineTool({
      name: "runtime.trace.replay",
      description: "Replay a session trace from transcript events for debugging business agent decisions.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      inputSchema: z.object({
        session_id: idSchema,
        run_id: idSchema.optional(),
        types: z.array(z.enum(TRANSCRIPT_EVENT_TYPES)).max(14).optional(),
        limit: z.number().int().min(1).max(500).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const sessionId = args.session_id;
        const runId = args.run_id ?? "";
        const options = { types: args.types as TranscriptEventType[] | undefined, limit: args.limit ?? 200 };
        const events = runId
          ? await transcriptStore.replayRun(workspace, sessionId, runId, options)
          : await transcriptStore.replay(workspace, sessionId, options);
        return {
          ok: true,
          tool: "runtime.trace.replay",
          data: {
            session_id: sessionId,
            run_id: runId || null,
            ...buildTraceReport(events),
            events
          }
        };
      }
    }),
    defineTool({
      name: "runtime.context.inspect",
      description: "Inspect context assembly and token/character budget for a business agent turn.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      inputSchema: z.object({
        message: z.string().max(4000).optional(),
        session_id: idSchema.optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const user = context.user ?? { id: "anonymous", role: "anonymous" };
        const workspace = getWorkspace(context);
        const message = args.message ?? "";
        const enterpriseContext = await enterpriseContextProvider.load({
          user,
          workspace,
          message,
          sessionId: args.session_id
        });
        return {
          ok: true,
          tool: "runtime.context.inspect",
          data: assembler.assemble({ user, workspace, message, enterpriseContext })
        };
      }
    }),
    defineTool({
      name: "runtime.tool.governance",
      description: "List tool governance metadata: risk level, permissions, exposure, and confirmation requirements.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      inputSchema: z.object({}).strict(),
      outputSchema: ToolResultBaseSchema,
      execute(_args, context) {
        return {
          ok: true,
          tool: "runtime.tool.governance",
          data: {
            tools: toolRegistry.list(context).map((tool) => ({
              name: tool.name,
              risk_level: tool.metadata?.risk_level ?? "read",
              required_permissions: tool.metadata?.required_permissions ?? [],
              expose_to_agentic: tool.metadata?.expose_to_agentic === true,
              requires_confirmation: tool.metadata?.requires_confirmation === true,
              scenarios: tool.metadata?.scenarios ?? [],
              steps: tool.metadata?.steps ?? []
            }))
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

function buildTraceReport(events: Array<{ at: string; type: TranscriptEventType; data: JsonObject }>): JsonObject {
  const ordered = events.slice().sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const startMs = ordered.length ? Date.parse(ordered[0].at) : Date.now();
  const endMs = ordered.length ? Date.parse(ordered[ordered.length - 1].at) : startMs;
  const failures = ordered
    .filter((event) => event.type === "error" || event.data?.ok === false || Boolean(event.data?.error))
    .map((event) => ({
      at: event.at,
      type: event.type,
      error: stringifyOrNull(event.data?.error ?? event.data?.code),
      message: stringifyOrNull(event.data?.message)
    }));
  const route = ordered.find((event) => event.type === "route_decision")?.data?.route;
  const toolGovernance = ordered.filter((event) => event.type === "tool_governance");
  const context = ordered.find((event) => event.type === "context_assembly")?.data;
  return {
    timeline: ordered.map((event, index) => ({
      index,
      at: event.at,
      offset_ms: Math.max(0, Date.parse(event.at) - startMs),
      type: event.type,
      span: spanForEvent(event.type),
      title: titleForEvent(event),
      status: statusForEvent(event)
    })),
    metrics: {
      duration_ms: Math.max(0, endMs - startMs),
      event_count: ordered.length,
      tool_call_count: ordered.filter((event) => event.type === "tool_call").length,
      tool_governance_count: toolGovernance.length,
      failed_event_count: failures.length,
      context_used_chars: readNestedNumber(context, ["budget", "used_chars"]),
      context_dropped_count: Array.isArray(context?.dropped) ? context.dropped.length : 0
    },
    route_summary: summarizeRoute(route),
    governance_summary: {
      allowed: toolGovernance.filter((event) => event.data?.decision === "allowed").length,
      confirmation_required: toolGovernance.filter((event) => event.data?.decision === "confirmation_required").length,
      denied: toolGovernance.filter((event) => event.data?.decision === "permission_denied").length
    },
    failures
  };
}

function spanForEvent(type: TranscriptEventType): string {
  if (type === "turn_start" || type === "turn_end") return "turn";
  if (type === "context_assembly") return "context";
  if (type === "route_decision") return "router";
  if (type === "tool_call" || type === "tool_result" || type === "tool_governance") return "tool";
  if (type === "agent_step") return "agent";
  return "message";
}

function titleForEvent(event: { type: TranscriptEventType; data: JsonObject }): string {
  if (event.type === "route_decision") return `route:${String((event.data.route as JsonObject | undefined)?.intent_code ?? "unknown")}`;
  if (event.type === "tool_call" || event.type === "tool_result" || event.type === "tool_governance") return `tool:${String(event.data.tool ?? event.data.name ?? "unknown")}`;
  if (event.type === "agent_step") return String(event.data.title ?? event.data.phase ?? "agent_step");
  return event.type;
}

function statusForEvent(event: { type: TranscriptEventType; data: JsonObject }): string {
  if (event.type === "error" || event.data?.ok === false || event.data?.error) return "failed";
  if (event.data?.decision === "confirmation_required") return "waiting_confirmation";
  return "completed";
}

function summarizeRoute(route: unknown): JsonObject | null {
  if (!route || typeof route !== "object" || Array.isArray(route)) return null;
  const record = route as Record<string, unknown>;
  return {
    intent_code: stringifyOrNull(record.intent_code),
    execution_class: stringifyOrNull(record.execution_class),
    handler_type: stringifyOrNull(record.handler_type),
    confidence: stringifyOrNull(record.confidence),
    source: stringifyOrNull(record.source ?? record.router_source)
  };
}

function readNestedNumber(value: unknown, path: string[]): number | null {
  let current = value as unknown;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "number" ? current : null;
}

function stringifyOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}
