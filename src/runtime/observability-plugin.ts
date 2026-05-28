/**
 * ObservabilityPlugin —— 把 runtime 的 hook 流转成 Langfuse trace。
 *
 * 设计要点：
 *   1. 与业务代码完全解耦：只订阅 hook 事件，不改业务路径
 *   2. 严格异步、严格只读：handler 内部不抛、不阻塞，错了只 console.warn
 *   3. trace 边界：turn_start 开 trace，turn_end 关 trace + flush
 *   4. 跨 hook 共享：用 run_id 作为 key 在 map 里查 TraceHandle
 *   5. 适配现有 hook 名：以实际 emit 端用到的为主，新 Phase 8 hook 兼容（没 emit 也不报错）
 *
 * 关键约束：runtime hook handler 是 await 的，handler 必须 fast。
 *   - 所有 SDK 调用本身已是 fire-and-forget batch（LangfuseAdapter 包了 try/catch）
 *   - 我们不在 handler 内做 await flush（flush 留给 turn_end 之后）
 */

import type { JsonObject } from "../types/agent-contracts.js";
import type {
  Channel,
  Env,
  SpanHandle,
  TraceEmitter,
  TraceHandle,
  TraceTags
} from "../../packages/observability-sdk/src/index.js";
import { getEmitter } from "../../packages/observability-sdk/src/index.js";
import type { RuntimePlugin } from "./hooks.js";

export interface ObservabilityPluginOptions {
  /** 注入 emitter，主要给 smoke/test 用。默认从 getEmitter() 取 */
  emitter?: TraceEmitter;
  /** env 标签，默认从 NODE_ENV 推断 */
  env?: Env;
}

/**
 * 跨服务 trace 续接所需的最小上下文。供 service-client 等下游调用方查询，
 * 把 trace_id / run_id 注入到外部 HTTP 调用的 headers 里。
 */
export interface ActiveTraceContext {
  trace_id: string;
  run_id: string;
}

/** run_id → trace_id 镜像。turn_start 写入，turn_end 删除。 */
const activeContexts = new Map<string, ActiveTraceContext>();

/**
 * 按 run_id 查询当前正在跑的 trace 上下文。
 * 用于把 memory-service 等下游服务的 span 挂到同一 trace 下。
 * 没有匹配 / observability 未启用 时返回 undefined（调用方应判空跳过）。
 */
export function getActiveTraceContext(runId: string | undefined | null): ActiveTraceContext | undefined {
  if (!runId) return undefined;
  return activeContexts.get(runId);
}

interface PerRunState {
  trace: TraceHandle;
  /** 工具名 → 当前未结束的 span（同一个工具被并发调用时只追踪最近的） */
  toolSpans: Map<string, SpanHandle>;
  /** 当前 turn 的 LLM/agent generation span */
  agenticSpan?: SpanHandle;
  /** 当前 turn 的 route span */
  routeSpan?: SpanHandle;
  startedAt: number;
}

const RUN_TTL_MS = 5 * 60 * 1000; // 5 分钟没结束的 run 视为遗弃，主动清理避免内存泄漏

export function createObservabilityPlugin(
  opts: ObservabilityPluginOptions = {}
): RuntimePlugin {
  const emitter = opts.emitter ?? getEmitter();
  const env: Env = opts.env ?? inferEnv();

  // run_id → state。即使 turn_end 没正确触发，定期清理过期 entry。
  const runs = new Map<string, PerRunState>();

  const cleanupStale = (): void => {
    const now = Date.now();
    for (const [runId, state] of runs.entries()) {
      if (now - state.startedAt > RUN_TTL_MS) {
        try {
          state.trace.end({ orphaned: true });
        } catch {
          /* ignore */
        }
        runs.delete(runId);
        activeContexts.delete(runId);
      }
    }
  };

  const safeHandler = (
    name: string,
    fn: (event: JsonObject) => void
  ) => {
    return (event: JsonObject): void => {
      try {
        fn(event);
      } catch (e) {
        console.warn(
          `[observability-plugin] hook ${name} crashed:`,
          e instanceof Error ? e.message : e
        );
      }
    };
  };

  return {
    name: "observability",
    register(hooks) {
      hooks.on(
        "turn_start",
        safeHandler("turn_start", (event) => {
          cleanupStale();
          const runId = pickStr(event, "run_id");
          const userId = pickStr(event, "user_id");
          const sessionId = pickStr(event, "session_id");
          if (!runId || !userId || !sessionId) return;

          const businessId = pickBusinessId(event) ?? "default";
          const channel = (pickStr(event, "channel") ?? "web") as Channel;
          const tags: TraceTags = {
            business_id: businessId,
            user_id: userId,
            session_id: sessionId,
            channel,
            env
          };
          const trace = emitter.startTrace({
            name: `turn:${channel}`,
            tags,
            input: pickStr(event, "message"),
            metadata: { run_id: runId }
          });
          runs.set(runId, {
            trace,
            toolSpans: new Map(),
            startedAt: Date.now()
          });
          activeContexts.set(runId, { trace_id: trace.traceId, run_id: runId });
        })
      );

      hooks.on(
        "context_ingest",
        safeHandler("context_ingest", (event) => {
          const state = stateOf(runs, event);
          if (!state) return;
          const span = state.trace.span({
            name: "context.ingest",
            metadata: {
              stage: pickStr(event, "stage") ?? "ingest",
              sources: event.sources ?? null
            }
          });
          // 没有显式的 ingest 结束 hook，立即 end 标记完成
          span.end({ ok: true });
        })
      );

      hooks.on(
        "context_assembly",
        safeHandler("context_assembly", (event) => {
          const state = stateOf(runs, event);
          if (!state) return;
          const span = state.trace.span({
            name: "context.assembly",
            metadata: {
              budget: event.budget ?? null,
              sections_count: Array.isArray(event.sections)
                ? event.sections.length
                : 0,
              dropped_count: Array.isArray(event.dropped)
                ? event.dropped.length
                : 0
            }
          });
          span.end({ ok: true });
        })
      );

      // route 兼容两种 hook 名：老的 route_decision（一次性，事件即结果）
      // 和 Phase 8 的 before_route/after_route（前后包夹）
      hooks.on(
        "route_decision",
        safeHandler("route_decision", (event) => {
          const state = stateOf(runs, event);
          if (!state) return;
          const route = (event.route as JsonObject) ?? {};
          const span = state.trace.span({
            name: "route",
            input: pickStr(event, "message"),
            metadata: {
              chosen_intent: pickStr(route, "intent") ?? null,
              candidates: route.candidates ?? null,
              score: route.score ?? null,
              reason: pickStr(route, "reason") ?? null
            }
          });
          span.end({ route });
          // 把 intent 也回填到 trace 的 metadata 上方便过滤
          state.trace.update({
            intent: pickStr(route, "intent") ?? null
          });
        })
      );

      hooks.on(
        "before_route",
        safeHandler("before_route", (event) => {
          const state = stateOf(runs, event);
          if (!state) return;
          state.routeSpan = state.trace.span({
            name: "route",
            input: pickStr(event, "message")
          });
        })
      );

      hooks.on(
        "after_route",
        safeHandler("after_route", (event) => {
          const state = stateOf(runs, event);
          if (!state || !state.routeSpan) return;
          const route = (event.route as JsonObject) ?? {};
          state.routeSpan.update({
            chosen_intent: pickStr(route, "intent") ?? null,
            candidates: route.candidates ?? null,
            reason: pickStr(route, "reason") ?? null
          });
          state.routeSpan.end({ route });
          state.routeSpan = undefined;
          state.trace.update({ intent: pickStr(route, "intent") ?? null });
        })
      );

      hooks.on(
        "before_tool_call",
        safeHandler("before_tool_call", (event) => {
          const state = stateOf(runs, event);
          if (!state) return;
          const tool = pickStr(event, "tool") ?? "unknown";
          const span = state.trace.span({
            name: `tool:${tool}`,
            input: event.input ?? null,
            metadata: {
              tool,
              risk_level: pickStr(event, "risk_level") ?? null
            }
          });
          state.toolSpans.set(tool, span);
        })
      );

      hooks.on(
        "after_tool_call",
        safeHandler("after_tool_call", (event) => {
          const state = stateOf(runs, event);
          if (!state) return;
          const tool = pickStr(event, "tool") ?? "unknown";
          const span = state.toolSpans.get(tool);
          state.toolSpans.delete(tool);
          if (!span) return;
          const error = event.error ? new Error(String(event.error)) : undefined;
          span.update({
            ok: event.ok ?? null,
            duration_ms: event.duration_ms ?? null
          });
          span.end(event.output ?? event.result ?? null, error);
        })
      );

      // 老 hook：tool_result —— governance 决策（不一定有真正的工具调用）
      hooks.on(
        "tool_result",
        safeHandler("tool_result", (event) => {
          const state = stateOf(runs, event);
          if (!state) return;
          const tool = pickStr(event, "tool") ?? "unknown";
          const decision = pickStr(event, "decision") ?? "unknown";
          // 只是一个轻量事件，独立 span 一闪即灭
          const span = state.trace.span({
            name: `tool.governance:${tool}`,
            metadata: {
              decision,
              code: pickStr(event, "code") ?? null,
              risk_level: pickStr(event, "risk_level") ?? null,
              requires_confirmation: event.requires_confirmation === true
            }
          });
          span.end({ decision });
        })
      );

      hooks.on(
        "agentic_prepare",
        safeHandler("agentic_prepare", (event) => {
          const state = stateOf(runs, event);
          if (!state) return;
          state.agenticSpan = state.trace.generation({
            name: "agent.run",
            model: pickStr(event, "model") ?? undefined,
            prompt: event.prompt ?? null,
            metadata: {
              tools_available: Array.isArray(event.tools_available)
                ? event.tools_available.length
                : null
            }
          });
        })
      );

      hooks.on(
        "agentic_complete",
        safeHandler("agentic_complete", (event) => {
          const state = stateOf(runs, event);
          if (!state) return;
          if (!state.agenticSpan) {
            // 没有 prepare 直接 complete —— 补一条 generation span
            state.agenticSpan = state.trace.generation({
              name: "agent.run",
              model: pickStr(event, "model") ?? undefined
            });
          }
          state.agenticSpan.update({
            steps: Array.isArray(event.steps) ? event.steps.length : null,
            stop_reason: pickStr(event, "stop_reason") ?? null
          });
          const error = event.error ? new Error(String(event.error)) : undefined;
          state.agenticSpan.end(event.answer ?? event.completion ?? null, error);
          state.agenticSpan = undefined;
        })
      );

      hooks.on(
        "before_prompt_build",
        safeHandler("before_prompt_build", (event) => {
          const state = stateOf(runs, event);
          if (!state) return;
          // 这个 hook 只标记一下，不开 span（成本/价值不对等）
          state.trace.update({
            prompt_template: pickStr(event, "template") ?? null
          });
        })
      );

      hooks.on(
        "before_evolution_judge",
        safeHandler("before_evolution_judge", (event) => {
          const state = stateOf(runs, event);
          if (!state) return;
          const span = state.trace.span({
            name: "evolution.judge",
            metadata: { trigger: pickStr(event, "trigger") ?? null }
          });
          span.end({ ok: true });
        })
      );

      hooks.on(
        "after_evolution_apply",
        safeHandler("after_evolution_apply", (event) => {
          const state = stateOf(runs, event);
          if (!state) return;
          const span = state.trace.span({
            name: "evolution.apply",
            metadata: {
              extracted_memories: Array.isArray(event.memories)
                ? event.memories.length
                : 0,
              extracted_entities: Array.isArray(event.entities)
                ? event.entities.length
                : 0,
              extracted_relations: Array.isArray(event.relations)
                ? event.relations.length
                : 0
            }
          });
          span.end({ applied: true });
        })
      );

      hooks.on(
        "evolution_applied",
        safeHandler("evolution_applied", (event) => {
          const state = stateOf(runs, event);
          if (!state) return;
          const span = state.trace.span({
            name: "evolution.applied",
            metadata: {
              skill_count: Array.isArray(event.skills)
                ? event.skills.length
                : null,
              memory_count: Array.isArray(event.memories)
                ? event.memories.length
                : null
            }
          });
          span.end({ applied: true });
        })
      );

      hooks.on(
        "subagent_spawn",
        safeHandler("subagent_spawn", (event) => {
          const state = stateOf(runs, event);
          if (!state) return;
          state.trace.update({
            subagent_spawned: true,
            subagent_role: pickStr(event, "agent_role") ?? null
          });
        })
      );

      hooks.on(
        "session_end",
        safeHandler("session_end", (event) => {
          const state = stateOf(runs, event);
          if (!state) return;
          state.trace.update({ session_ended: true });
        })
      );

      hooks.on(
        "turn_end",
        safeHandler("turn_end", (event) => {
          const runId = pickStr(event, "run_id");
          if (!runId) return;
          const state = runs.get(runId);
          if (!state) return;

          // 把没结束的 tool span 全 end 掉
          for (const [, span] of state.toolSpans) {
            try {
              span.end({ orphaned: true });
            } catch {
              /* ignore */
            }
          }
          state.toolSpans.clear();
          if (state.agenticSpan) {
            try {
              state.agenticSpan.end({ orphaned: true });
            } catch {
              /* ignore */
            }
          }

          state.trace.update({
            tool_count: event.tool_count ?? null,
            duration_ms: Date.now() - state.startedAt
          });
          state.trace.end({
            answer: pickStr(event, "answer_preview") ?? pickStr(event, "answer")
          });
          runs.delete(runId);
          activeContexts.delete(runId);
        })
      );
    }
  };
}

/* ───── helpers ───── */

function pickStr(o: JsonObject, k: string): string | undefined {
  const v = o[k];
  return typeof v === "string" ? v : undefined;
}

function pickBusinessId(event: JsonObject): string | undefined {
  // Try several places: event.business_id / event.user.business_id / event.workspace.business_id
  if (typeof event.business_id === "string") return event.business_id;
  const user = event.user;
  if (user && typeof user === "object" && !Array.isArray(user)) {
    const bid = (user as JsonObject).business_id;
    if (typeof bid === "string") return bid;
  }
  const ws = event.workspace;
  if (ws && typeof ws === "object" && !Array.isArray(ws)) {
    const bid = (ws as JsonObject).business_id;
    if (typeof bid === "string") return bid;
  }
  return undefined;
}

function stateOf(runs: Map<string, PerRunState>, event: JsonObject): PerRunState | null {
  const runId = pickStr(event, "run_id");
  if (!runId) return null;
  return runs.get(runId) ?? null;
}

function inferEnv(): Env {
  const node = (process.env.NODE_ENV ?? "").toLowerCase();
  if (node === "production" || node === "prod") return "prod";
  if (node === "staging" || node === "test") return "staging";
  return "dev";
}
