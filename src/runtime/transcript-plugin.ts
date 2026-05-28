import { TranscriptStore } from "../transcript/transcript-store.js";
import type { JsonObject, ToolResult } from "../types/agent-contracts.js";
import type { RuntimePlugin } from "./hooks.js";
import { resolveUserWorkspace } from "./workspace-context.js";
import { getMemoryClient } from "../memory/service-client.js";
import { QueuedMemoryClient } from "../memory/queued-client.js";
import type { MessageItem } from "../../packages/memory-sdk/src/index.js";
import { getActiveTraceContext } from "./observability-plugin.js";

export interface TranscriptPluginOptions {
  transcriptStore?: TranscriptStore;
  /**
   * 注入 QueuedMemoryClient 工厂，主要给 smoke 用。生产路径下走默认逻辑：
   * getMemoryClient() → 包一层 QueuedMemoryClient（按 workspace 自动隔离队列文件）。
   * 返回 null 时跳过 memory-service 写入（保留与 Phase 1 的兼容）。
   */
  memoryClientFactory?: (workspace: ReturnType<typeof resolveUserWorkspace>) => QueuedMemoryClient | null;
}

export function createTranscriptPlugin({
  transcriptStore = new TranscriptStore(),
  memoryClientFactory
}: TranscriptPluginOptions = {}): RuntimePlugin {
  // 每个 session 维护一个递增的 turn_index 计数器，用于 batchMessages。
  const nextTurnIndex = new Map<string, number>();
  const allocateTurnIndices = (sessionId: string, count: number): number[] => {
    const start = nextTurnIndex.get(sessionId) ?? 0;
    nextTurnIndex.set(sessionId, start + count);
    return Array.from({ length: count }, (_, i) => start + i);
  };
  const queuedClientCache = new Map<string, QueuedMemoryClient | null>();
  const resolveQueuedClient = (workspace: ReturnType<typeof resolveUserWorkspace>): QueuedMemoryClient | null => {
    if (memoryClientFactory) return memoryClientFactory(workspace);
    const cacheKey = `${workspace.business_id}:${workspace.user_id}`;
    if (queuedClientCache.has(cacheKey)) return queuedClientCache.get(cacheKey) ?? null;
    const base = getMemoryClient();
    const wrapped = base ? new QueuedMemoryClient({ client: base, workspace }) : null;
    queuedClientCache.set(cacheKey, wrapped);
    return wrapped;
  };

  return {
    name: "transcript-store",
    register(hooks) {
      hooks.on("turn_start", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const sessionId = typeof event.session_id === "string" ? event.session_id : "";
        if (!userId || !sessionId) return;
        await transcriptStore.append(resolveUserWorkspace(userId), sessionId, "turn_start", {
          run_id: typeof event.run_id === "string" ? event.run_id : undefined,
          message_preview: String(event.message ?? "").slice(0, 300)
        });
      });
      hooks.on("context_ingest", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const sessionId = typeof event.session_id === "string" ? event.session_id : "";
        if (!userId || !sessionId) return;
        await transcriptStore.append(resolveUserWorkspace(userId), sessionId, "context_ingest", {
          run_id: typeof event.run_id === "string" ? event.run_id : undefined,
          stage: typeof event.stage === "string" ? event.stage : "ingest",
          sources: event.sources && typeof event.sources === "object" && !Array.isArray(event.sources) ? event.sources as JsonObject : {}
        });
      });
      hooks.on("context_assembly", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const sessionId = typeof event.session_id === "string" ? event.session_id : "";
        if (!userId || !sessionId) return;
        await transcriptStore.append(resolveUserWorkspace(userId), sessionId, "context_assembly", {
          run_id: typeof event.run_id === "string" ? event.run_id : undefined,
          budget: event.budget && typeof event.budget === "object" && !Array.isArray(event.budget) ? event.budget as JsonObject : {},
          sections: Array.isArray(event.sections) ? event.sections as never : [],
          dropped: Array.isArray(event.dropped) ? event.dropped as never : []
        });
      });
      hooks.on("route_decision", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const sessionId = typeof event.session_id === "string" ? event.session_id : "";
        if (!userId || !sessionId) return;
        await transcriptStore.append(resolveUserWorkspace(userId), sessionId, "route_decision", {
          run_id: typeof event.run_id === "string" ? event.run_id : undefined,
          message: String(event.message ?? ""),
          route: event.route && typeof event.route === "object" && !Array.isArray(event.route) ? event.route as JsonObject : {}
        });
      });
      hooks.on("tool_result", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const sessionId = typeof event.session_id === "string" ? event.session_id : "";
        if (!userId || !sessionId) return;
        await transcriptStore.append(resolveUserWorkspace(userId), sessionId, "tool_governance", {
          run_id: typeof event.run_id === "string" ? event.run_id : undefined,
          tool: String(event.tool ?? ""),
          decision: String(event.decision ?? ""),
          code: typeof event.code === "string" ? event.code : undefined,
          message: typeof event.message === "string" ? event.message : undefined,
          risk_level: typeof event.risk_level === "string" ? event.risk_level : "read",
          requires_confirmation: event.requires_confirmation === true
        });
      });
      hooks.on("turn_end", async (event) => {
        const userId = typeof event.user_id === "string" ? event.user_id : "";
        const sessionId = typeof event.session_id === "string" ? event.session_id : "";
        if (!userId || !sessionId) return;
        const workspace = resolveUserWorkspace(userId);
        await transcriptStore.appendTurn(workspace, sessionId, {
          runId: typeof event.run_id === "string" ? event.run_id : undefined,
          message: String(event.message ?? ""),
          answer: String(event.answer ?? ""),
          route: event.route && typeof event.route === "object" ? event.route as JsonObject : {},
          toolCalls: Array.isArray(event.tool_calls) ? event.tool_calls as never : [],
          toolResults: Array.isArray(event.tool_results) ? event.tool_results as ToolResult[] : [],
          agentSteps: Array.isArray(event.agent_steps) ? event.agent_steps as Array<Record<string, unknown>> : []
        });

        // Spec 1.12：把 user/assistant 消息镜像到 memory-service。
        const queued = resolveQueuedClient(workspace);
        if (!queued) return;
        const message = String(event.message ?? "");
        const answer = String(event.answer ?? "");
        const items: MessageItem[] = [];
        if (message) items.push({ session_id: sessionId, turn_index: 0, role: "user", content: message });
        if (answer) items.push({ session_id: sessionId, turn_index: 0, role: "assistant", content: answer });
        if (!items.length) return;
        const indices = allocateTurnIndices(sessionId, items.length);
        items.forEach((m, i) => { m.turn_index = indices[i]; });
        const runId = typeof event.run_id === "string" ? event.run_id : undefined;
        const traceCtx = getActiveTraceContext(runId);
        const ctx = {
          business_id: workspace.business_id,
          user_id: workspace.user_id,
          agent_id: typeof event.agent_id === "string" ? event.agent_id : undefined,
          trace_id: traceCtx?.trace_id,
          run_id: traceCtx?.run_id ?? runId
        };
        await queued.batchMessages(ctx, items);
      });
    }
  };
}
