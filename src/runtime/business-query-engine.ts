import { createDefaultSessionId } from "../agent/session-store.js";
import type { JsonObject, JsonValue, UserContext } from "../types/agent-contracts.js";
import { ContextAssembler } from "./context-assembler.js";
import type { RuntimeHooks } from "./hooks.js";
import { resolveUserWorkspace, type WorkspaceContext } from "./workspace-context.js";

interface BusinessAgent {
  run(input: { userId?: string; userContext?: Record<string, unknown>; wecomUserId?: string; message: string; sessionId?: string; runId?: string; debug?: boolean }): Promise<unknown>;
}

interface UserContextResolverLike {
  resolve(input: { userId?: string; userContext?: Record<string, unknown>; wecomUserId?: string }): Promise<UserContext>;
}

interface EnterpriseContextProviderLike {
  load(input: { user: UserContext; workspace: WorkspaceContext; message?: string; sessionId?: string }): Promise<unknown>;
}

export interface QueryEngineInput {
  userId?: string;
  userContext?: Record<string, unknown>;
  wecomUserId?: string;
  message: string;
  sessionId?: string;
  debug?: boolean;
}

export interface QueryEngineResult extends JsonObject {
  session_id: string;
  run_id: string;
  answer: string;
  output: JsonValue;
  execution_plan?: JsonObject;
  trace: JsonObject;
  context_budget: JsonObject;
}

export class BusinessQueryEngine {
  private readonly agent: BusinessAgent;
  private readonly userContextResolver: UserContextResolverLike;
  private readonly enterpriseContextProvider: EnterpriseContextProviderLike;
  private readonly contextAssembler: ContextAssembler;
  private readonly hooks?: RuntimeHooks;

  constructor({
    agent,
    userContextResolver,
    enterpriseContextProvider,
    contextAssembler = new ContextAssembler(),
    hooks
  }: {
    agent: BusinessAgent;
    userContextResolver: UserContextResolverLike;
    enterpriseContextProvider: EnterpriseContextProviderLike;
    contextAssembler?: ContextAssembler;
    hooks?: RuntimeHooks;
  }) {
    this.agent = agent;
    this.userContextResolver = userContextResolver;
    this.enterpriseContextProvider = enterpriseContextProvider;
    this.contextAssembler = contextAssembler;
    this.hooks = hooks;
  }

  async submitMessage(input: QueryEngineInput): Promise<QueryEngineResult> {
    const startedAt = Date.now();
    const runId = createRunId();
    const user = await this.userContextResolver.resolve({
      userId: input.userId,
      userContext: input.userContext,
      wecomUserId: input.wecomUserId
    });
    const workspace = resolveUserWorkspace(user);
    const sessionId = input.sessionId ?? createDefaultSessionId(user.id);
    let enterpriseContext: unknown = {};
    let ingestError: Error | null = null;
    try {
      enterpriseContext = await this.enterpriseContextProvider.load({
        user,
        workspace,
        message: input.message,
        sessionId
      });
    } catch (error) {
      ingestError = error instanceof Error ? error : new Error(String(error));
      console.warn(`[query-engine] enterpriseContextProvider.load failed for user=${user.id}: ${ingestError.message}`);
    }
    await this.hooks?.emit("context_ingest", {
      user_id: user.id,
      session_id: sessionId,
      run_id: runId,
      stage: "ingest",
      sources: summarizeIngestSources(enterpriseContext),
      error: ingestError ? { name: ingestError.name, message: ingestError.message } : null,
      degraded: ingestError !== null
    });
    const assembled = this.contextAssembler.assemble({
      user,
      workspace,
      message: input.message,
      enterpriseContext
    });
    await this.hooks?.emit("context_assembly", {
      user_id: user.id,
      session_id: sessionId,
      run_id: runId,
      budget: assembled.budget,
      sections: assembled.sections.map((section) => ({
        name: section.name,
        chars: section.chars,
        priority: section.priority,
        stage: section.stage
      })),
      dropped: assembled.dropped,
      estimated_tokens: assembled.estimated_tokens,
      prompt_authority: assembled.prompt_authority,
      stages: assembled.stages
    });
    const output = await this.agent.run({
      userId: input.userId,
      userContext: input.userContext,
      wecomUserId: input.wecomUserId,
      message: input.message,
      sessionId,
      runId,
      debug: input.debug
    });
    const record = output && typeof output === "object" && !Array.isArray(output) ? output as Record<string, unknown> : {};
    return {
      session_id: String(record.session_id ?? sessionId),
      run_id: String(record.run_id ?? runId),
      user_message: input.message,
      answer: String(record.answer ?? ""),
      output: normalizeJson(output),
      context_budget: assembled.budget,
      execution_plan: buildExecutionPlan(record),
      trace: {
        engine: "business_query_engine",
        run_id: runId,
        user_id: user.id,
        workspace_user_id: workspace.user_id,
        latency_ms: Date.now() - startedAt,
        task_retrieval: summarizeTaskRetrieval(enterpriseContext),
        source_attribution: summarizeSourceAttribution(record),
        context_sections: assembled.sections.map((section) => ({
          name: section.name,
          chars: section.chars,
          priority: section.priority
        })),
        context_dropped: assembled.dropped
      }
    };
  }
}

function createRunId(): string {
  return `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function buildExecutionPlan(output: Record<string, unknown>): JsonObject {
  const debug = output.debug && typeof output.debug === "object" && !Array.isArray(output.debug) ? output.debug as Record<string, unknown> : {};
  const route = debug.route && typeof debug.route === "object" && !Array.isArray(debug.route) ? debug.route as Record<string, unknown> : {};
  const toolCalls = Array.isArray(debug.tool_calls) ? debug.tool_calls as Array<Record<string, unknown>> : [];
  const steps = Array.isArray(debug.steps) ? debug.steps as Array<Record<string, unknown>> : Array.isArray(debug.agent_steps) ? debug.agent_steps as Array<Record<string, unknown>> : [];
  return {
    objective: String(output.answer ?? "").slice(0, 160),
    route: {
      intent_code: stringifyOrNull(route.intent_code),
      execution_class: stringifyOrNull(route.execution_class),
      handler_type: stringifyOrNull(route.handler_type),
      confidence: stringifyOrNull(route.confidence)
    },
    tools: toolCalls.map((call) => ({
      name: stringifyOrNull(call.name),
      resource: stringifyOrNull(call.resource),
      operation: stringifyOrNull(call.operation)
    })),
    steps: steps.map((step) => ({
      phase: stringifyOrNull(step.phase ?? step.id ?? step.type),
      status: stringifyOrNull(step.status) ?? "completed",
      title: stringifyOrNull(step.title)
    })),
    requires_followup: /需要|请补充|确认|等待/.test(String(output.answer ?? ""))
  };
}

function stringifyOrNull(value: unknown): string | null {
  return value == null ? null : String(value);
}

function summarizeTaskRetrieval(enterpriseContext: unknown): JsonObject {
  const enterprise = enterpriseContext && typeof enterpriseContext === "object" && !Array.isArray(enterpriseContext) ? enterpriseContext as Record<string, unknown> : {};
  const tasks = enterprise.tasks && typeof enterprise.tasks === "object" && !Array.isArray(enterprise.tasks) ? enterprise.tasks as Record<string, unknown> : {};
  const relevant = Array.isArray(tasks.relevant) ? tasks.relevant as Array<Record<string, unknown>> : [];
  return {
    relevant_count: relevant.length,
    top: relevant.slice(0, 3).map((task) => ({
      id: stringifyOrNull(task.id),
      task_list_id: stringifyOrNull(task.task_list_id),
      subject: stringifyOrNull(task.subject),
      active_form: stringifyOrNull(task.active_form),
      goal: stringifyOrNull(task.goal),
      status: stringifyOrNull(task.status),
      priority: stringifyOrNull(task.priority),
      next_action: stringifyOrNull(task.next_action),
      updated_at: stringifyOrNull(task.updated_at),
      relevance: typeof task.relevance === "number" ? task.relevance : null,
      reason: stringifyOrNull(task.reason)
    }))
  };
}

/**
 * 把 enterpriseContext 顶层字段拍成 hook payload 用的"来源清单"。
 * 不暴露原始 payload（可能很大也可能含 PII），只暴露每个 ingest 来源的形状/规模，
 * 让监听方可以判断"是否拿到了 admin/memory/tasks"以及"哪一段最大"。
 */
function summarizeIngestSources(enterpriseContext: unknown): JsonObject {
  const record = enterpriseContext && typeof enterpriseContext === "object" && !Array.isArray(enterpriseContext)
    ? enterpriseContext as Record<string, unknown>
    : {};
  const summary: JsonObject = {};
  for (const [key, value] of Object.entries(record)) {
    summary[key] = describeIngestValue(value);
  }
  return summary;
}

function describeIngestValue(value: unknown): JsonObject {
  if (value === null || value === undefined) return { kind: "empty", chars: 0 };
  if (Array.isArray(value)) return { kind: "array", count: value.length, chars: JSON.stringify(value).length };
  if (typeof value === "object") return { kind: "object", keys: Object.keys(value as object).length, chars: JSON.stringify(value).length };
  if (typeof value === "string") return { kind: "string", chars: value.length };
  return { kind: typeof value, chars: String(value).length };
}

function summarizeSourceAttribution(output: Record<string, unknown>): JsonObject {
  const sources = Array.isArray(output.sources) ? output.sources as Array<Record<string, unknown>> : [];
  return {
    source_count: sources.length,
    sources: sources.slice(0, 5).map((source) => ({
      id: stringifyOrNull(source.id),
      source: stringifyOrNull(source.source),
      title: stringifyOrNull(source.title),
      heading: stringifyOrNull(source.heading),
      score: typeof source.score === "number" ? source.score : null
    }))
  };
}
