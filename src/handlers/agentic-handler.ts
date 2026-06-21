/**
 * AgenticHandler：跨意图的 LLM tool-calling 循环。
 *
 * 设计原则：
 *   - intent_code 是 agent 的工具，但不是唯一来源。getAvailableTools()
 *     按三类拼装：intent.* / skill.* / tool.*。第一版只有 intent，后两类
 *     返回空数组占位。
 *   - 每一步 LLM 决定调哪个工具；调 intent.* 时落到 IntentQueryHandler.execute；
 *     调 skill.* / tool.* 进入对应注入式 skill 或原子工具。
 *   - 步数上限 5；每步超时 20s；总超时 60s。
 *   - 不重写 router、不重写 IntentQueryHandler，只是另一种调度方式。
 *
 * 未来扩展（v3 hook）：
 *   - 在 decide 阶段，LLM 可以输出 action.type=propose_tool，描述一个临时步骤。
 *     由系统决定是否实现。本期不做，但 normalizeAction 已经预留了分支。
 */
import { applyPromptCache } from "../llm/prompt-cache.js";
import { createOpenUILangGenerationPrompt } from "../openui-lang/generation-prompt.js";
import { buildItemStartEvent, buildItemEndEvent, nextAgentItemId } from "../runtime/agent-events.js";
import { RuntimeHooks } from "../runtime/hooks.js";
import { composeReportFromRegistry, getAgenticFallbacks } from "../domains/runtime-registry.js";
import { domainMismatchMessage, intentDomainId, routeMatchesSelectedDomain, toolMatchesSelectedDomain } from "../domains/domain-isolation.js";
import type { IntentManifest, IntentRegistry, JsonObject, JsonValue, Route, ToolCall, ToolResult, UserContext } from "../types/agent-contracts.js";

interface AgenticIntentQueryHandler {
  execute(input: Record<string, unknown>): Promise<{
    answer?: unknown;
    table?: { rows?: JsonObject[] };
    debug?: Record<string, unknown>;
  }>;
}

interface AgenticSkillRegistry {
  listForAgent?(input: { user?: UserContext; workspace?: unknown }): Array<Record<string, unknown>>;
  loadForInjection?(input: { id?: string; args?: JsonObject; user?: UserContext; workspace?: unknown }): Promise<Record<string, unknown>> | Record<string, unknown>;
}

interface AgenticToolRegistry {
  list(input?: Record<string, unknown>): Array<{
    name: string;
    description?: string;
    schema?: { properties?: Record<string, { type?: string; description?: string }> };
    metadata?: Record<string, unknown>;
  }>;
  get?(name: string): { metadata?: Record<string, unknown> } | undefined;
  execute(call: ToolCall, context?: Record<string, unknown>): Promise<ToolResult | unknown>;
}

interface AgenticHandlerOptions {
  intentRegistry?: IntentRegistry;
  intentQueryHandler?: AgenticIntentQueryHandler;
  skillRegistry?: AgenticSkillRegistry | null;
  toolRegistry?: AgenticToolRegistry | null;
  hooks?: RuntimeHooks;
}

interface AgenticToolView {
  name: string;
  kind: "intent" | "skill" | "tool";
  description?: string;
  params_schema?: Record<string, { type?: string; description?: string }>;
  manifest?: IntentManifest;
  underlying?: string;
  id?: string;
  [key: string]: unknown;
}

interface AgenticStreams {
  lifecycle: Array<Record<string, unknown>>;
  assistant: Array<Record<string, unknown>>;
  tool: Array<Record<string, unknown>>;
}

interface PlannerState {
  objective: string;
  plan: string[];
  completed: string[];
  missing: string[];
  evidence: Array<Record<string, unknown>>;
  tasks?: Array<Record<string, unknown>>;
  claimed_task?: Record<string, unknown> | null;
}

interface AgenticDecision extends Record<string, unknown> {
  action?: string;
  answer?: string;
  reason?: string;
  tool_name?: string;
  tool?: string;
  args?: JsonObject;
  tools?: unknown[];
  plan?: unknown;
  steps?: unknown;
  state_update?: Partial<Pick<PlannerState, "plan" | "completed" | "missing">>;
  proposed_tool?: unknown;
  proposal?: unknown;
}

interface AgenticToolCall {
  tool_name: string;
  args: JsonObject;
  id?: string;
}

interface AgenticObservation extends Record<string, unknown> {
  ok?: boolean;
  error?: string;
  message?: string;
  intent_code?: string;
  row_count?: number;
  data?: { rows?: unknown[]; value?: JsonValue };
  _kind?: string;
  skill?: unknown;
  injection_text?: string;
}

interface AgenticObservationItem {
  call: AgenticToolCall;
  observation: AgenticObservation;
}

interface DagNode {
  id: string;
  tool_name: string;
  args: JsonObject;
  depends_on: string[];
}

type EmitFn = (event: Record<string, unknown>) => Promise<void> | void;
type LifecyclePush = (event: string, extra?: Record<string, unknown>) => void;
type StreamPush = (entry: Record<string, unknown>) => void;
type ToolStartPush = (input: { tool: string; args?: JsonValue; step?: number; dagNode?: string }) => string;

interface AgenticExecuteInput {
  user?: UserContext;
  workspace?: unknown;
  message?: string;
  route?: Route;
  session?: Record<string, unknown>;
  selectedDomain?: string;
  onEmit?: EmitFn;
}

// 三类工具组合时，典型路径：intent×2 + tool.safe_compute + skill.* 注入 + answer = 5 步起。
// 留点余量给单步抖动重试，定 7。
const MAX_ITERATIONS = 7;
// system prompt 里要列 intent.* / tool.* / skill.* 三类工具，整个 prompt 接近 4-5KB，
// MiniMax-M2.7 单步推理 20s 容易超时；适度放宽到 35s。总时长同步拉到 120s。
const STEP_TIMEOUT_MS = 35000;
const TOTAL_TIMEOUT_MS = 180000;

export class AgenticHandler {
  private readonly intentRegistry?: IntentRegistry;
  private readonly intentQueryHandler?: AgenticIntentQueryHandler;
  private readonly skillRegistry: AgenticSkillRegistry | null;
  private readonly toolRegistry: AgenticToolRegistry | null;
  private readonly hooks: RuntimeHooks;

  constructor({ intentRegistry, intentQueryHandler, skillRegistry = null, toolRegistry = null, hooks }: AgenticHandlerOptions = {}) {
    this.intentRegistry = intentRegistry;
    this.intentQueryHandler = intentQueryHandler;
    this.skillRegistry = skillRegistry;
    this.toolRegistry = toolRegistry;
    this.hooks = hooks ?? new RuntimeHooks();
  }

  /**
   * @param {{
   *   user?: import("../types/agent-contracts.js").UserContext,
   *   message?: string,
   *   route?: import("../types/agent-contracts.js").Route,
   *   session?: Record<string, unknown>,
   *   onEmit?: (event: Record<string, unknown>) => Promise<void> | void
   * }} [input]
   */
  async execute({ user, workspace, message, route, session, selectedDomain, onEmit }: AgenticExecuteInput = {}) {
    const startedAt = Date.now();
    const tools = this.getAvailableTools({ user, workspace, selectedDomain });
    // 三流 traces（参考 openclaw agent loop）：
    //   - lifecycle：步骤级里程碑（start / decided / step_failed / answered / total_timeout / fallback）
    //   - assistant：LLM 侧事件（每一轮决策、propose_tool 提议）
    //   - tool     ：工具调用 + 观察摘要
    // 同时输出一份合并后的 flat traces 供旧消费者使用（orchestrator 步骤摘要、router-poc 断言）。
    const streams: AgenticStreams = { lifecycle: [], assistant: [], tool: [] };
    // onEmit 是流式回调：runStream 路径下每个事件实时推到 SSE。非流式（router-poc / run）传空就跳过。
    const safeEmit = typeof onEmit === "function" ? async (ev: Record<string, unknown>) => { try { await onEmit(ev); } catch {} } : null;
    const pushLifecycle: LifecyclePush = (event, extra) => {
      const entry = { ts: Date.now() - startedAt, event, ...extra };
      streams.lifecycle.push(entry);
      if (safeEmit) safeEmit({ kind: "agentic_lifecycle", ...entry });
    };
    const pushAssistant: StreamPush = (entry) => {
      const full = { ts: Date.now() - startedAt, ...entry };
      streams.assistant.push(full);
      if (safeEmit) safeEmit({ kind: "agentic_assistant", ...full });
    };
    /**
     * 在工具真正调用前发 phase=start 的 item 事件。
     * 返回 itemId，调用方在 pushTool 时回填，让 start/end 共享同一个 id。
     */
    const pushToolStart: ToolStartPush = (input) => {
      const itemId = nextAgentItemId("tool");
      const ts = Date.now() - startedAt;
      if (safeEmit) {
        const item = buildItemStartEvent({
          itemId,
          stream: "tool",
          kind: "tool",
          title: input.tool,
          summary: `调用 ${input.tool}`,
          meta: {
            args: input.args ?? null,
            step: input.step ?? null,
            dag_node: input.dagNode ?? null
          },
          ts
        });
        safeEmit({ kind: "agentic_item", ...item });
      }
      return itemId;
    };
    const pushTool: StreamPush = (entry) => {
      const ts = Date.now() - startedAt;
      const full = { ts, ...entry };
      streams.tool.push(full);
      if (safeEmit) safeEmit({ kind: "agentic_tool", ...full });
      // 同步发出强类型 item 事件（agent-events.AgentItemEvent），让消费者（业务流 / Debug 流 /
      // 时间流）能用同一个 itemId 串联同一次工具调用。不改 streams.tool 形态，纯增量。
      if (safeEmit && entry && typeof entry.type === "string" && entry.type === "tool_call") {
        const toolName = String(entry.tool ?? "");
        // 优先使用调用方传入的 itemId（pushToolStart 返回的），让 start/end 共享同一个 id；
        // 调用方未传时回退到新生成 id（兼容旧路径）。
        const itemId = typeof entry.item_id === "string" && entry.item_id
          ? entry.item_id
          : nextAgentItemId("tool");
        const observation = (entry.observation_summary ?? entry.observation) as JsonObject | undefined;
        const failedFromObs = !!observation && (observation.ok === false || observation.isError === true);
        const summary = typeof entry.observation_summary === "object" && entry.observation_summary
          ? `${toolName} ${failedFromObs ? "失败" : "完成"}`
          : `调用 ${toolName}`;
        const item = buildItemEndEvent({
          itemId,
          stream: "tool",
          kind: "tool",
          status: failedFromObs ? "failed" : "completed",
          title: toolName,
          summary,
          meta: {
            args: entry.args as JsonValue ?? null,
            step: entry.step as JsonValue ?? null,
            dag_node: entry.dag_node as JsonValue ?? null
          },
          ts,
          error: failedFromObs
            ? { code: String(observation?.code ?? observation?.error ?? "execution_failed"), message: String(observation?.message ?? "") }
            : undefined
        });
        safeEmit({ kind: "agentic_item", ...item });
      }
    };

    pushLifecycle("start", { message_preview: typeof message === "string" ? message.slice(0, 80) : null, tools_count: tools.length });

    let answer: string | null = null;
    let lastError: string | null = null;
    const executedToolResults: Array<Record<string, unknown>> = [];
    let plannerState = createInitialPlannerState(message);
    const taskContext = await this.prepareTaskContext({ user, message, answerHint: route?.intent_code });
    if (taskContext.relevant.length || taskContext.claimed) {
      plannerState = {
        ...plannerState,
        tasks: taskContext.relevant,
        claimed_task: taskContext.claimed
      };
      pushLifecycle("task_context_loaded", {
        relevant_task_count: taskContext.relevant.length,
        claimed_task_id: taskContext.claimed?.id ?? null
      });
      if (safeEmit && taskContext.claimed) {
        await safeEmit({
          kind: "task_continuity",
          type: "task_resumed",
          task: taskContext.claimed,
          summary: createTaskContinuitySummary(taskContext.claimed)
        });
      }
    }

    const forcedCloudCall = shouldUseDeterministicCloudShortcut()
      ? deterministicCloudToolCall(route?.intent_code, route?.params ?? {})
      : null;
    if (forcedCloudCall) {
      pushLifecycle("deterministic_cloud_tool_started", { intent_code: route?.intent_code, tool: forcedCloudCall.tool_name });
      const itemId = pushToolStart({ tool: forcedCloudCall.tool_name, args: forcedCloudCall.args, step: 0 });
      const observation = await this.callTool({ callName: forcedCloudCall.tool_name, args: forcedCloudCall.args, user, workspace, session, selectedDomain });
      const toolName = forcedCloudCall.tool_name.replace(/^tool\./, "");
      const toolResult = {
        ok: observation?.ok !== false,
        tool: toolName,
        data: observation,
        error: observation?.error,
        message: observation?.message
      };
      executedToolResults.push(toolResult);
      pushTool({ step: 0, type: "tool_call", tool: forcedCloudCall.tool_name, args: forcedCloudCall.args, observation_summary: summarizeObservation(observation), item_id: itemId });
      const composed = composeReportFromRegistry({ question: String(message ?? ""), route, toolResults: [toolResult as ToolResult] });
      answer = composed?.answer ?? summarizeDeterministicCloudObservation(observation);
      pushLifecycle("answered", { source: "deterministic_cloud_tool", intent_code: route?.intent_code });
      await this.recordTaskProgress({ user, claimedTask: taskContext.claimed, answer, plannerState });
      const flatTraces = mergeStreams(streams);
      return {
        answer,
        table: { rows: [] as JsonObject[], fields: [] as string[] },
        debug: {
          intent_code: route?.intent_code,
          agentic: true,
          deterministic_cloud_tool: true,
          iterations: flatTraces.length,
          traces: flatTraces,
          streams,
          planner_state: plannerState,
          latency_ms: Date.now() - startedAt
        },
        toolPlan: { calls: streams.tool.filter((call) => call.type === "tool_call").map((call) => ({ name: String(call.tool ?? ""), args: call.args as JsonObject })) },
        toolResults: executedToolResults
      };
    }

    if (getAgenticFallbacks().some((fb) => fb.preferLocal === true && fb.matches(String(message ?? "")))) {
      const localResult = await this.tryLocalAgenticFallback({ user, workspace, message, route, session, selectedDomain, streams, pushLifecycle, pushTool, pushToolStart });
      if (localResult) return localResult;
    }

    const apiKey = process.env.LLM_DECISION_API_KEY ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const localResult = await this.tryLocalAgenticFallback({ user, workspace, message, route, session, selectedDomain, streams, pushLifecycle, pushTool, pushToolStart });
      if (localResult) return localResult;
      pushLifecycle("fallback", { reason: "no_api_key" });
      return this.buildFallback({ message, route, reason: "未配置 LLM_API_KEY，agentic 直接兜底返回。", streams });
    }

    const conversation = [
      { role: "system", content: this.buildSystemPrompt({ tools, user, route }) },
      { role: "user", content: buildPlannerUserMessage({ message, plannerState, route }) }
    ];

    for (let step = 0; step < MAX_ITERATIONS; step += 1) {
      if (Date.now() - startedAt > TOTAL_TIMEOUT_MS) {
        lastError = "agentic 总时长超时";
        pushLifecycle("total_timeout", { step });
        break;
      }
      // 单步 LLM 失败时最多重试 3 次（共 4 次），覆盖 MiniMax 偶发空 content / 非 JSON / 超时
      let decision: AgenticDecision | undefined;
      let stepErr: unknown = null;
      let attemptsUsed = 0;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        attemptsUsed = attempt + 1;
        try {
          decision = await this.decideNext({ conversation, apiKey });
          stepErr = null;
          break;
        } catch (err) {
          stepErr = err;
          if (attempt < 3) await new Promise((r) => setTimeout(r, 400));
        }
      }
      if (stepErr) {
        lastError = stepErr instanceof Error ? stepErr.message : String(stepErr);
        pushLifecycle("step_failed", { step, error: lastError, attempts: attemptsUsed });
        const localResult = await this.tryLocalAgenticFallback({ user, workspace, message, route, session, selectedDomain, streams, pushLifecycle, pushTool, pushToolStart });
        if (localResult) return localResult;
        break;
      }
      if (!decision) {
        lastError = "agentic LLM 未返回决策";
        pushLifecycle("step_failed", { step, error: lastError, attempts: attemptsUsed });
        break;
      }
      plannerState = applyPlannerStateUpdate(plannerState, decision.state_update);
      pushLifecycle("decided", { step, action: decision.action, attempts: attemptsUsed, planner_state: summarizePlannerState(plannerState) });
      pushAssistant({ step, type: "decision", action: decision.action, reason: decision.reason, planner_state: summarizePlannerState(plannerState) });
      conversation.push({ role: "assistant", content: JSON.stringify(decision) });

      if (decision.action === "answer") {
        answer = decision.answer ?? "";
        pushAssistant({ step, type: "answer", reason: decision.reason, answer_chars: typeof answer === "string" ? answer.length : 0 });
        pushLifecycle("answered", { step });
        break;
      }
      if (decision.action === "plan" || decision.action === "dag_plan") {
        const planToolValidation = validateRoutePlanToolChoice(route, decision.plan ?? decision.steps);
        if (planToolValidation.ok === false) {
          pushLifecycle("route_tool_mismatch", {
            step,
            intent_code: route?.intent_code,
            expected: planToolValidation.expected.tool_name,
            actual: planToolValidation.actual
          });
          conversation.push({
            role: "user",
            content: JSON.stringify({
              correction: "上一轮计划中的工具与当前业务路由不一致，请重新规划。",
              route_intent: route?.intent_code,
              required_first_tool: planToolValidation.expected.tool_name,
              required_args: planToolValidation.expected.args,
              rejected_tools: planToolValidation.actual,
              instruction: "请返回 action=tool_call，tool_name 使用 required_first_tool，args 使用 required_args；不要直接 answer。你仍然是在 agentic loop 中自主重判，系统不会替你执行工具。"
            }, null, 2)
          });
          continue;
        }
        const dagResult = await this.executeDagPlan({ plan: decision.plan ?? decision.steps, user, workspace, session, selectedDomain, step, pushLifecycle, pushTool, pushToolStart });
        if (!dagResult.ok) {
          lastError = dagResult.message;
          pushLifecycle("step_failed", { step, error: lastError });
          break;
        }
        for (const item of dagResult.results) {
          const observation = item.observation;
          executedToolResults.push({
            ok: item.observation?.ok !== false,
            tool: item.call.tool_name,
            data: observation,
            error: observation.error,
            message: observation.message
          });
          plannerState = recordEvidence(plannerState, item);
        }
        conversation.push({ role: "user", content: buildObservationMessage({ observations: dagResult.results, plannerState }) });
        continue;
      }
      if (decision.action === "tool_call") {
        let calls = normalizeToolCalls(decision);
        if (!calls.length) {
          lastError = "agentic tool_call 缺少工具名";
          pushLifecycle("step_failed", { step, error: lastError });
          break;
        }
        const routeToolValidation = validateRouteToolChoice(route, calls);
        if (routeToolValidation.ok === false) {
          pushLifecycle("route_tool_mismatch", {
            step,
            intent_code: route?.intent_code,
            expected: routeToolValidation.expected.tool_name,
            actual: routeToolValidation.actual
          });
          calls = [routeToolValidation.expected];
          pushLifecycle("route_tool_enforced", {
            step,
            intent_code: route?.intent_code,
            tool: routeToolValidation.expected.tool_name
          });
        }
        pushLifecycle("parallel_tools_started", { step, count: calls.length });
        const observations = await Promise.all(calls.map(async (call) => {
          const itemId = pushToolStart({ tool: call.tool_name, args: call.args, step });
          const observation = await this.callTool({ callName: call.tool_name, args: call.args, user, workspace, session, selectedDomain });
          return { call, observation, itemId };
        }));
        for (const { call, observation, itemId } of observations) {
          executedToolResults.push({
            ok: observation?.ok !== false,
            tool: call.tool_name,
            data: observation,
            error: observation.error,
            message: observation.message
          });
          plannerState = recordEvidence(plannerState, { call, observation });
          pushTool({ step, type: "tool_call", tool: call.tool_name, args: call.args, observation_summary: summarizeObservation(observation), item_id: itemId });
        }
        conversation.push({ role: "user", content: buildObservationMessage({ observations, plannerState }) });
        continue;
      }
      // v3 thin：propose_tool 只观察、不真造工具；写进 traces 后给 LLM 推回 stub
      // 让它改用现有 intent.* / tool.* / skill.* 或直接 answer。计入步数，避免反复刷。
      if (decision.action === "propose_tool") {
        const proposal = normalizeProposal(decision.proposed_tool ?? decision.proposal ?? {});
        pushAssistant({ step, type: "propose_tool", proposal, reason: decision.reason });
        conversation.push({
          role: "user",
          content: `已记录你的工具提议「${proposal.name ?? "(unnamed)"}」（仅作后续设计参考，本期不会动态创建工具）。请用现有 intent.* / tool.* / skill.* 完成任务，或直接 answer。`
        });
        continue;
      }
      lastError = `agentic 未识别的 action：${decision.action}`;
      pushLifecycle("unknown_action", { step, action: decision.action });
      break;
    }

    if (!answer) {
      if (process.env.AGENTIC_DEBUG === "1") {
        console.error("[agentic] no answer; streams=", JSON.stringify(streams, null, 2), "lastError=", lastError);
      }
      pushLifecycle("fallback", { reason: lastError ?? "no_answer_in_max_steps" });
      return this.buildFallback({ message, route, reason: lastError ?? "未在步数上限内得到答案", streams });
    }
    await this.recordTaskProgress({ user, claimedTask: taskContext.claimed, answer, plannerState });
    const flatTraces = mergeStreams(streams);
    return {
      answer,
      table: { rows: [] as JsonObject[], fields: [] as string[] },
      debug: {
        intent_code: route?.intent_code,
        agentic: true,
        iterations: flatTraces.length,
        traces: flatTraces,
        streams,
        planner_state: plannerState,
        latency_ms: Date.now() - startedAt
      },
      toolPlan: { calls: streams.tool.filter((call) => call.type === "tool_call").map((call) => ({ name: String(call.tool ?? ""), args: call.args as JsonObject })) },
      toolResults: executedToolResults
    };
  }

  getAvailableTools({ user, workspace, selectedDomain }: { user?: UserContext; workspace?: unknown; selectedDomain?: string }): AgenticToolView[] {
    const list: AgenticToolView[] = [];
    // 1. intent.*
    for (const manifest of this.intentRegistry.listCodes()) {
      // 跨意图规划只暴露 intent_query / 聚合类（chitchat/agentic 不该被自己调用）
      if (manifest.handler_type !== "intent_query") continue;
      if (!routeMatchesSelectedDomain(manifest, selectedDomain)) continue;
      list.push({
        name: `intent.${manifest.intent_code}`,
        kind: "intent",
        description: manifest.description ?? manifest.intent_code,
        params_schema: manifest.params_schema ?? {},
        manifest
      });
    }
    // 2. skill.*（注入式 skill）
    if (this.skillRegistry?.listForAgent) {
      for (const skill of this.skillRegistry.listForAgent({ user, workspace }) ?? []) {
        const id = typeof skill.id === "string" ? skill.id : "";
        if (id) list.push({ ...skill, kind: "skill", name: `skill.${id}` } as AgenticToolView);
      }
    }
    // 3. tool.*（只露出标了 expose_to_agentic 的）
    if (this.toolRegistry?.list) {
      for (const tool of this.toolRegistry.list({ user, workspace }) ?? []) {
        if (!tool.metadata?.expose_to_agentic) continue;
        if (!toolMatchesSelectedDomain(tool, selectedDomain)) continue;
        // tool.schema 是 JSON Schema（type=object, properties=...），转成统一的 {key:{type,description}}
        const params_schema: Record<string, { type?: string; description?: string }> = {};
        const props = tool.schema?.properties ?? {};
        for (const [k, v] of Object.entries(props)) {
          params_schema[k] = { type: v?.type ?? "string", description: v?.description ?? "" };
        }
        list.push({
          name: `tool.${tool.name}`,
          kind: "tool",
          description: tool.description,
          params_schema,
          underlying: tool.name
        });
      }
    }
    return list;
  }

  buildSystemPrompt({ tools, user, route }: { tools: AgenticToolView[]; user?: UserContext; route?: Route }) {
    const toolLines = tools.map((t) => {
      const params = Object.entries(t.params_schema ?? {})
        .map(([k, s]) => `${k}(${s?.type ?? "string"})`)
        .join(", ");
      return `- ${t.name} [${t.kind}]: ${t.description}${params ? `；参数: ${params}` : ""}`;
    }).join("\n");
    return [
      "你是企业 agent 的跨意图规划器。当用户的问题需要组合多个查询、对比、归因、推理时由你处理。",
      "",
      `当前用户：${user?.name ?? "?"}（${user?.role ?? "?"}/${user?.department ?? "?"}）`,
      `当前路由意图：${route?.intent_code ?? "unknown"}；路由参数：${JSON.stringify(route?.params ?? {})}`,
      "",
      "可用工具：",
      "- intent.* ：业务高级查询（按口径返回 rows/answer，先用它拿数据）。",
      "- tool.*   ：原子能力，例如 tool.safe_compute 在沙箱里跑 JS 算精确指标（加权库龄、占比、差额等）。",
      "- skill.*  ：注入式『写作/汇报包』。调用后会把它的 SKILL.md + 模板渲染结果塞进上下文，下一步你直接 answer 输出文案。",
      "- task.*   ：长程任务状态能力。遇到『继续上次那个』或跨轮任务，优先使用 task.retrieve / task.update / task.complete 维护任务状态。",
      toolLines,
      "",
      "工作流程：每一轮你输出严格 JSON，schema 如下，不要 markdown：",
      `{
  "action": "tool_call" | "plan" | "answer",
  "tool_name": "<当 action=tool_call 时填工具名>",
  "args": { ... },
  "tools": [{"tool_name": "<可选：多个相互独立的工具并发执行>", "args": { ... }}],
  "plan": [{"id": "step1", "tool_name": "intent.<domain>.<action>.<resource>", "args": {}, "depends_on": []}],
  "state_update": {
    "plan": ["下一步计划"],
    "completed": ["已经完成的事实收集/计算"],
    "missing": ["仍缺少的证据"]
  },
  "answer": "<当 action=answer 时填最终回答>",
  "reason": "<一句话理由>"
}`,
      "",
      "硬规则：",
      "1. action=tool_call 时只能调 上面列表里的 工具；args 严格按 params_schema。",
      "2. 如果多个 intent.* 查询相互独立，可以用 tools 数组一次返回多个工具，系统会并发执行；有依赖关系的步骤仍分轮执行。",
      "3. 如果任务天然是 DAG（先查多个数据，再用 safe_compute 计算），可以 action=plan 并返回 plan 数组；depends_on 为空的节点会并发执行。",
      "4. 用户没明确给出的字段填 null；不要瞎猜具体值。",
      "5. 有充分信息就直接 action=answer 给最终回答，回答里把『我做了什么、看到了什么、结论』讲清楚。",
      "6. 如果跨意图任务其实只需要单个 intent，仍然走单个 tool_call → answer 两步。",
      "7. 需要结构化 UI 展示时优先调用 tool.openui.lang.delegate；调用后不要再输出 Markdown 文案。",
      "8. 罕见情况：如果你强烈认为现有工具列表完全不够、需要某个全新能力，可以把 action 设为 propose_tool 并附 proposed_tool: {name, what_it_does, why_needed}（仅做记录，本期不会真执行；下一步你还得用现有工具或 answer）。绝大多数任务都不该走这条。",
      "9. 云商品专用规则：当前路由意图为 cloud.master_data.impact_review 时，第一步必须调用 tool.cloud_master_data_impact_review；cloud.financial.commercialization_review 调用 tool.cloud_financial_commercialization_review；cloud.customer.explanation 调用 tool.cloud_customer_explanation；cloud.product_change.impact_review 调用 tool.cloud_product_change_impact_review；cloud.post_launch.health_check 调用 tool.cloud_post_launch_health_check；cloud.productization.readiness_review 调用 tool.cloud_productization_readiness_review；cloud.offer.design_review 调用 tool.cloud_offer_design_review；cloud.plan.entitlement_review 调用 tool.cloud_plan_entitlement_review；cloud.channel.publication_review 调用 tool.cloud_channel_publication_review；cloud.sre.launch_gate_review 调用 tool.cloud_sre_launch_gate_review；cloud.ipd.readiness_review 调用 tool.cloud_ipd_readiness_review；cloud.gtm.package_draft 调用 tool.cloud_gtm_package_draft；cloud.capacity.risk_review 调用 tool.cloud_capacity_risk_review；cloud.gmv.target_briefing 调用 tool.cloud_gmv_target_briefing；cloud.ops.incident_impact 调用 tool.cloud_ops_incident_business_impact；cloud.ops.degradation_plan 调用 tool.cloud_ops_degradation_plan；cloud.agent_plan.overage_policy 调用 tool.cloud_agent_plan_overage_policy；cloud.retrospective.template 调用 tool.cloud_retrospective_template；cloud.executive.briefing 调用 tool.cloud_executive_briefing，不要先用 intent.cloud.query.operations 单表查询；cloud.solution.recommendation 调用 tool.cloud_solution_recommendation；cloud.quote.self_service 调用 tool.cloud_self_service_quote；cloud.estimate.seedance_video_seconds 调用 tool.estimate_seedance_video_seconds；cloud.estimate.agent_plan_rounds 调用 tool.estimate_agent_plan_rounds；cloud.workflow.release_request 优先调用 tool.create_cloud_approval_summary 或 tool.simulate_cloud_closed_loop，不要调用 tool.cloud_solution_recommendation。",
      "10. 云商品 OpenUI 展示规则：只要问题涉及经营、报价、估算、方案、上架、建模、风险、审批、流程、续约、账单、合同或客户自助询价，拿到云商品工具结果后必须优先调用 tool.openui.lang.delegate。委托后不要再输出 Markdown；如果确实不委托，最终回答也必须保持短、中文业务化、可直接给客户看。",
      "11. 云商品展示契约：老板/管理者问题展示“结论、KPI、风险排序、影响金额/客户、负责人、下一步动作、证据来源、demo/mock 数据边界”；询价/销售问题展示“套餐/估算、公式、关键假设、报价边界、置信度”；IPD/上架问题展示“商品模型、购买页字段、IPD 检查点、缺口、负责人、下一步”；GTM 问题展示“目标客户、卖点、FAQ、销售话术、不可承诺项、报价前检查”；容量/SRE 问题展示“地域容量、健康度、限售/灰度建议、负责人”；运维事件问题展示“影响订单、GMV、客户、收入确认风险、回滚和客户沟通”；发布问题展示“字段清单、缺失项、风险、人审要求、审批摘要、回滚检查点”。",
      "12. 云商品销售方案最终回答必须显式包含三个小节标题：关键假设、报价边界、置信度。云商品老板经营简报最终回答必须显式包含：结论、风险排序、影响金额/客户、负责人、下一步动作、证据来源、demo/mock 数据边界。",
      "13. 最终回答必须面向业务用户，不得复制工具内部字段、筛选表达式或资源表名。禁止出现 severity=high、delay_hours>0、arr_at_risk_cny、owner_user_id、owner_team、metric_id、source_type、cloud_* 这类表达；要改写成“高严重度风险”“已经延期的阻塞项”“续约风险金额”“负责人”“负责团队”“经营指标样本/风险信号/流程任务”等中文业务话术。",
      "14. “下一步动作”必须是可执行的人话动作，例如“请财务复核负责人今天内补齐价格证据并解除阻塞”；不要写成条件判断、字段过滤或查询规则。“证据来源”只写业务口径，例如“经营指标、风险信号、流程任务、续约机会”，不要写数据库/资源 ID。",
      "",
      createOpenUILangGenerationPrompt()
    ].join("\n");
  }

  async decideNext({ conversation, apiKey }: { conversation: Array<{ role: string; content: string }>; apiKey: string }): Promise<AgenticDecision> {
    const baseUrl = (process.env.LLM_DECISION_BASE_URL ?? process.env.LLM_BASE_URL ?? process.env.OPENAI_BASE_URL ?? "https://api.minimaxi.com/v1").replace(/\/$/, "");
    const model = process.env.LLM_DECISION_MODEL ?? process.env.LLM_MODEL ?? process.env.OPENAI_MODEL ?? "MiniMax-M2.7";
    const body = {
      model,
      messages: conversation,
      temperature: 0,
      stream: false,
      response_format: { type: "json_object" }
    };
    applyPromptCache(body, { baseUrl, model, scope: "agentic.loop_decision" });
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
      body: JSON.stringify(body)
    });
    if (!response.ok) {
      // 部分服务端不支持 response_format，剥掉重试
      delete body.response_format;
      const retry = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(STEP_TIMEOUT_MS),
        body: JSON.stringify(body)
      });
      if (!retry.ok) throw new Error(`agentic LLM HTTP ${retry.status}`);
      return parseDecision(await retry.json());
    }
    return parseDecision(await response.json());
  }

  async callTool({ callName, args, user, workspace, session, selectedDomain }: { callName?: string; args?: JsonObject; user?: UserContext; workspace?: unknown; session?: Record<string, unknown>; selectedDomain?: string }): Promise<AgenticObservation> {
    if (callName?.startsWith("intent.")) {
      const intent_code = callName.slice("intent.".length);
      const manifest = this.intentRegistry.getCode(intent_code);
      if (!manifest) return { ok: false, error: "unknown_intent", message: `intent ${intent_code} 不存在` };
      if (!routeMatchesSelectedDomain(manifest, selectedDomain)) {
        return {
          ok: false,
          error: "domain_mismatch",
          message: domainMismatchMessage({ selectedDomain, actualDomain: intentDomainId(intent_code), subject: intent_code }),
        };
      }
      const result = await this.intentQueryHandler.execute({
        user,
        workspace,
        message: "(by agentic)",
        intent_code,
        params: args ?? {},
        route: { intent_code, params: args ?? {}, source: "agentic" },
        session,
        selectedDomain
      });
      return {
        ok: !Boolean(result.debug?.denied),
        intent_code,
        answer: result.answer,
        rows: result.table?.rows ?? [],
        row_count: typeof result.debug?.row_count === "number" ? result.debug.row_count : (result.table?.rows?.length ?? 0)
      };
    }
    if (callName?.startsWith("skill.")) {
      const requested = callName.slice("skill.".length);
      if (!this.skillRegistry?.loadForInjection) {
        return { ok: false, error: "skill_not_wired", message: "AgenticSkillView 未接入" };
      }
      // LLM 可能把 dash/underscore 写混（summarize-alert vs summarize_alert），统一兜底
      const skills = (this.skillRegistry as { readonly skills?: Array<{ id: string }> }).skills ?? [];
      const skillId = skills.find?.((s) => s.id === requested)
        ? requested
        : skills.find((s) => normalizeSkillId(s.id) === normalizeSkillId(requested))?.id ?? requested;
      const inj = await this.skillRegistry.loadForInjection({ id: skillId, args, user, workspace });
      if (inj.ok === false) return inj as AgenticObservation;
      return {
        _kind: "skill_injection",
        ok: true,
        skill: inj.skill,
        injection_text: typeof inj.injection_text === "string" ? inj.injection_text : "",
        preprocess_vars: inj.preprocess_vars
      };
    }
    if (callName?.startsWith("tool.")) {
      const underlying = callName.slice("tool.".length);
      if (!this.toolRegistry?.execute) {
        return { ok: false, error: "tool_not_wired", message: "ToolRegistry 未接入" };
      }
      const tool = this.toolRegistry.get?.(underlying);
      if (!tool) return { ok: false, error: "unknown_tool", message: `tool ${underlying} 不存在` };
      if (!tool.metadata?.expose_to_agentic) {
        return { ok: false, error: "tool_not_exposed", message: `tool ${underlying} 未授权 agentic 直接调用` };
      }
      const result = await this.toolRegistry.execute({ name: underlying, args }, { user, workspace, selected_domain: selectedDomain });
      return normalizeObservation(result);
    }
    return { ok: false, error: "unknown_tool_namespace", message: `工具名 ${callName} 必须以 intent./skill./tool. 开头` };
  }

  async tryLocalAgenticFallback({
    user,
    workspace,
    message,
    route,
    session,
    selectedDomain,
    streams,
    pushLifecycle,
    pushTool,
    pushToolStart
  }: {
    user?: UserContext;
    workspace?: unknown;
    message?: string;
    route?: Route;
    session?: Record<string, unknown>;
    selectedDomain?: string;
    streams: AgenticStreams;
    pushLifecycle: LifecyclePush;
    pushTool: StreamPush;
    pushToolStart?: ToolStartPush;
  }) {
    const text = String(message ?? "");
    // 从 registry 动态查找匹配的 agentic fallback
    const fallbacks = getAgenticFallbacks();
    const matched = fallbacks.find((fb) => fb.matches(text));
    if (!matched) return null;
    const fallbackCalls = matched.calls(text);
    const calls: AgenticToolCall[] = fallbackCalls.map((c) => ({ tool_name: c.tool_name, args: c.args }));
    pushLifecycle("local_fallback_started", { reason: matched.id });
    const domainMismatch = calls.find((call) => !toolMatchesSelectedDomain({ name: normalizeToolName(call.tool_name), metadata: {} }, selectedDomain));
    if (domainMismatch) {
      const answer = domainMismatchMessage({ selectedDomain, actualDomain: "cloud_commodity", subject: "这个问题" });
      pushLifecycle("fallback_domain_mismatch", { tool: domainMismatch.tool_name, selected_domain: selectedDomain });
      const flatTraces = mergeStreams(streams);
      return {
        answer,
        table: { rows: [] as JsonObject[], fields: [] as string[] },
        debug: {
          intent_code: route?.intent_code,
          agentic: true,
          local_fallback: true,
          domain_mismatch: true,
          fallback_id: matched.id,
          iterations: flatTraces.length,
          traces: flatTraces,
          streams,
        },
        toolPlan: { calls: [] },
        toolResults: []
      };
    }
    const observations: AgenticObservationItem[] = [];
    for (const [index, call] of calls.entries()) {
      const itemId = pushToolStart?.({ tool: call.tool_name, args: call.args as JsonValue, step: index });
      const observation = await this.callTool({ callName: call.tool_name, args: call.args, user, workspace, session, selectedDomain });
      observations.push({ call, observation });
      pushTool({ step: index, type: "tool_call", tool: call.tool_name, args: call.args, observation_summary: summarizeObservation(observation), item_id: itemId });
    }
    const answer = matched.composeAnswer(observations.map((item) => ({
      call: item.call,
      answer: typeof item.observation?.answer === "string" ? item.observation.answer : undefined,
      observation: item.observation as JsonObject,
    })));
    const flatTraces = mergeStreams(streams);
    pushLifecycle("answered", { source: "local_agentic_fallback" });
    return {
      answer,
      table: { rows: [] as JsonObject[], fields: [] as string[] },
      debug: {
        intent_code: route?.intent_code ?? "general",
        agentic: true,
        local_fallback: true,
        traces: mergeStreams(streams),
        streams,
        planner_state: createInitialPlannerState(message),
        latency_ms: flatTraces.length
      },
      toolPlan: { calls: streams.tool.filter((call) => call.type === "tool_call").map((call) => ({ name: String(call.tool ?? ""), args: call.args as JsonObject })) },
      toolResults: observations.map((item) => ({
        ok: item.observation?.ok !== false,
        tool: item.call.tool_name,
        data: item.observation,
        error: item.observation.error,
        message: item.observation.message
      }))
    };
  }

  async executeDagPlan({ plan, user, workspace, session, selectedDomain, step, pushLifecycle, pushTool, pushToolStart }: {
    plan?: unknown;
    user?: UserContext;
    workspace?: unknown;
    session?: Record<string, unknown>;
    selectedDomain?: string;
    step: number;
    pushLifecycle: LifecyclePush;
    pushTool: StreamPush;
    pushToolStart?: ToolStartPush;
  }): Promise<{ ok: boolean; message?: string; results: AgenticObservationItem[] }> {
    const nodes = normalizeDagPlan(plan);
    if (!nodes.length) return { ok: false, message: "agentic DAG plan 为空", results: [] };
    const completed = new Map<string, AgenticObservation>();
    const results: AgenticObservationItem[] = [];
    const pending = new Map(nodes.map((node) => [node.id, node]));
    for (let wave = 0; pending.size > 0 && wave < nodes.length; wave += 1) {
      const ready = [...pending.values()].filter((node) => node.depends_on.every((id) => completed.has(id)));
      if (!ready.length) return { ok: false, message: "agentic DAG plan 存在循环依赖或缺失依赖", results };
      pushLifecycle("dag_wave_started", { step, wave, count: ready.length, node_ids: ready.map((node) => node.id) });
      const waveResults = await Promise.all(ready.map(async (node) => {
        const args = resolveDagArgs(node.args, completed);
        const itemId = pushToolStart?.({ tool: node.tool_name, args: args as JsonValue, step, dagNode: node.id });
        const observation = await this.callTool({ callName: node.tool_name, args, user, workspace, session, selectedDomain });
        return { call: { tool_name: node.tool_name, args, id: node.id }, observation, itemId };
      }));
      for (const result of waveResults) {
        completed.set(result.call.id, result.observation);
        pending.delete(result.call.id);
        results.push(result);
        pushTool({ step, type: "tool_call", tool: result.call.tool_name, args: result.call.args, observation_summary: summarizeObservation(result.observation), dag_node: result.call.id, item_id: result.itemId });
      }
    }
    return { ok: true, results };
  }

  buildFallback({ route, reason, streams }: { message?: string; route?: Route; reason: string; streams?: AgenticStreams }) {
    const safeStreams = streams ?? { lifecycle: [], assistant: [], tool: [] };
    return {
      answer: `这个问题暂时无法直接给出答案（${reason}）。建议拆成更具体的查询再问一次。`,
      table: { rows: [] as JsonObject[], fields: [] as string[] },
      debug: {
        intent_code: route?.intent_code ?? "general",
        agentic: true,
        fallback: true,
        reason,
        traces: mergeStreams(safeStreams),
        streams: safeStreams
      },
      toolPlan: { calls: [] as ToolCall[] },
      toolResults: [] as ToolResult[]
    };
  }

  async prepareTaskContext({ user, message, answerHint }: { user?: UserContext; message?: string; answerHint?: string }): Promise<{ relevant: Array<Record<string, unknown>>; claimed: Record<string, unknown> | null }> {
    if (!user?.id || !message?.trim()) return { relevant: [], claimed: null };
    const result = await this.hooks.dispatch("agentic_prepare", {
      user_id: user.id,
      user: normalizeHookJson(user),
      message,
      route_hint: answerHint
    });
    return {
      relevant: Array.isArray(result.relevant_tasks) ? result.relevant_tasks as Array<Record<string, unknown>> : [],
      claimed: result.claimed_task && typeof result.claimed_task === "object" && !Array.isArray(result.claimed_task)
        ? result.claimed_task as Record<string, unknown>
        : null
    };
  }

  async recordTaskProgress({ user, claimedTask, answer, plannerState }: { user?: UserContext; claimedTask?: Record<string, unknown> | null; answer: string; plannerState: PlannerState }): Promise<void> {
    if (!user?.id || !claimedTask?.id || !claimedTask.task_list_id) return;
    await this.hooks.emit("agentic_complete", {
      user_id: user.id,
      user: normalizeHookJson(user),
      claimed_task: normalizeHookJson(claimedTask),
      answer,
      planner_state: normalizeHookJson(plannerState)
    });
  }
}

function normalizeHookJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}

function parseDecision(json: unknown): AgenticDecision {
  const record = json as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
  const raw = record.choices?.[0]?.message?.content ?? "";
  if (!raw || !raw.trim()) {
    if (process.env.AGENTIC_DEBUG === "1") {
      console.error("[agentic] LLM 返回空 content（finish_reason=", record.choices?.[0]?.finish_reason, "）");
    }
    throw new Error("agentic LLM 返回空 content");
  }
  const cleaned = stripCodeFence(raw);
  const parsed = tryParseJSON(cleaned);
  if (!parsed || typeof parsed !== "object") {
    if (process.env.AGENTIC_DEBUG === "1") {
      console.error("[agentic] JSON parse failed; raw content (first 600 chars):", String(raw).slice(0, 600));
    }
    throw new Error("agentic LLM 输出无法解析为 JSON");
  }
  return parsed as AgenticDecision;
}

function createInitialPlannerState(message: unknown): PlannerState {
  return {
    objective: String(message ?? "").slice(0, 500),
    plan: [],
    completed: [],
    missing: [],
    evidence: []
  };
}

function buildPlannerUserMessage({ message, plannerState, route }: { message?: string; plannerState: PlannerState; route?: Route }): string {
  const cloudToolHint = deterministicCloudToolCall(route?.intent_code, route?.params ?? {});
  return JSON.stringify({
    user_request: message,
    route_hint: route ? {
      intent_code: route.intent_code,
      params: route.params ?? {},
      source: route.source ?? null,
      recommended_first_tool: cloudToolHint?.tool_name ?? null,
      recommended_args: cloudToolHint?.args ?? null
    } : null,
    planner_state: plannerState,
    continuity_summary: plannerState.claimed_task ? createTaskContinuitySummary(plannerState.claimed_task) : null,
    task_instruction: plannerState.claimed_task
      ? "你已经恢复了一个相关长程任务。回答开头应自然承接：说明恢复到哪个任务、当前进度/next_action、接下来要做什么；然后继续执行。必要时调用 task.update/task.complete。"
      : "如用户表达继续上次、刚才那个、长期跟进，请优先使用 task.retrieve 找到相关任务。",
    instruction: "请先判断是否需要工具。多个独立查询可以在同一轮用 tools 数组并发返回。若 route_hint.recommended_first_tool 非空，除非用户问题明显不匹配，否则第一轮应调用该工具；这仍然是 agentic loop 决策，不是系统代你执行。"
  }, null, 2);
}

function createTaskContinuitySummary(task: Record<string, unknown>): string {
  return [
    `恢复任务：${String(task.subject ?? task.id ?? "unknown")}`,
    task.status ? `状态：${String(task.status)}` : "",
    task.next_action ? `下一步：${String(task.next_action)}` : "",
    task.reason ? `召回原因：${String(task.reason)}` : ""
  ].filter(Boolean).join("；");
}

function applyPlannerStateUpdate(state: PlannerState, update: AgenticDecision["state_update"]): PlannerState {
  if (!update || typeof update !== "object") return state;
  return {
    ...state,
    plan: mergeShortStrings(state.plan, update.plan),
    completed: mergeShortStrings(state.completed, update.completed),
    missing: mergeShortStrings(state.missing, update.missing)
  };
}

function summarizePlannerState(state: PlannerState): Record<string, number> {
  return {
    plan_count: state.plan?.length ?? 0,
    completed_count: state.completed?.length ?? 0,
    missing_count: state.missing?.length ?? 0,
    evidence_count: state.evidence?.length ?? 0
  };
}

function normalizeToolCalls(decision: AgenticDecision): AgenticToolCall[] {
  const raw = Array.isArray(decision?.tools) && decision.tools.length
    ? decision.tools
    : [{ tool_name: decision?.tool_name ?? decision?.tool, args: decision?.args ?? {} }];
  return raw
    .map((item) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        tool_name: typeof record.tool_name === "string" ? record.tool_name : typeof record.name === "string" ? record.name : typeof record.tool === "string" ? record.tool : null,
        args: record.args && typeof record.args === "object" ? record.args as JsonObject : {}
      };
    })
    .filter((item): item is AgenticToolCall => Boolean(item.tool_name));
}

function validateRouteToolChoice(route: Route | undefined, calls: AgenticToolCall[]): { ok: true } | { ok: false; expected: AgenticToolCall; actual: string[] } {
  const expected = deterministicCloudToolCall(route?.intent_code, route?.params ?? {});
  if (!expected || !calls.length) return { ok: true };
  const expectedName = normalizeToolName(expected.tool_name);
  const matches = calls.some((call) => normalizeToolName(call.tool_name) === expectedName);
  if (matches) return { ok: true };
  return { ok: false, expected, actual: calls.map((call) => call.tool_name) };
}

function validateRoutePlanToolChoice(route: Route | undefined, plan: unknown): { ok: true } | { ok: false; expected: AgenticToolCall; actual: string[] } {
  const nodes = normalizeDagPlan(plan);
  return validateRouteToolChoice(route, nodes.map((node) => ({ tool_name: node.tool_name, args: node.args })));
}

function normalizeToolName(name: string): string {
  return name.replace(/^tool\./, "");
}

function deterministicCloudToolCall(intentCode: string | undefined, params: JsonObject): AgenticToolCall | null {
  const productCode = typeof params.product_code === "string" ? params.product_code : "SEEDANCE";
  const releaseRequestId = typeof params.release_request_id === "string" ? params.release_request_id : "rel_seedance_mini_selfserve_202606";
  const period = typeof params.period === "string" ? params.period : "2026-06";
  const calls: Record<string, AgenticToolCall> = {
    "cloud.master_data.impact_review": {
      tool_name: "tool.cloud_master_data_impact_review",
      args: { product_code: productCode, field_name: typeof params.field_name === "string" ? params.field_name : undefined }
    },
    "cloud.financial.commercialization_review": {
      tool_name: "tool.cloud_financial_commercialization_review",
      args: { product_code: productCode }
    },
    "cloud.customer.explanation": {
      tool_name: "tool.cloud_customer_explanation",
      args: { product_code: productCode, scenario: typeof params.scenario === "string" ? params.scenario : undefined }
    },
    "cloud.product_change.impact_review": {
      tool_name: "tool.cloud_product_change_impact_review",
      args: { product_code: productCode, change_id: typeof params.change_id === "string" ? params.change_id : undefined }
    },
    "cloud.post_launch.health_check": {
      tool_name: "tool.cloud_post_launch_health_check",
      args: { product_code: productCode, release_request_id: releaseRequestId }
    },
    "cloud.productization.readiness_review": {
      tool_name: "tool.cloud_productization_readiness_review",
      args: { product_code: productCode }
    },
    "cloud.offer.design_review": {
      tool_name: "tool.cloud_offer_design_review",
      args: { product_code: productCode }
    },
    "cloud.plan.entitlement_review": {
      tool_name: "tool.cloud_plan_entitlement_review",
      args: { product_code: productCode }
    },
    "cloud.channel.publication_review": {
      tool_name: "tool.cloud_channel_publication_review",
      args: { product_code: productCode }
    },
    "cloud.sre.launch_gate_review": {
      tool_name: "tool.cloud_sre_launch_gate_review",
      args: { product_code: productCode, release_request_id: releaseRequestId }
    },
    "cloud.ipd.readiness_review": {
      tool_name: "tool.cloud_ipd_readiness_review",
      args: { product_code: productCode, release_request_id: releaseRequestId }
    },
    "cloud.gtm.package_draft": {
      tool_name: "tool.cloud_gtm_package_draft",
      args: {
        product_code: productCode,
        industry: typeof params.industry === "string" ? params.industry : undefined,
        customer_segment: typeof params.customer_segment === "string" ? params.customer_segment : undefined
      }
    },
    "cloud.capacity.risk_review": {
      tool_name: "tool.cloud_capacity_risk_review",
      args: {
        product_code: productCode,
        region_id: typeof params.region_id === "string" ? params.region_id : undefined,
        release_request_id: releaseRequestId
      }
    },
    "cloud.gmv.target_briefing": {
      tool_name: "tool.cloud_gmv_target_briefing",
      args: { product_code: productCode, period }
    },
    "cloud.ops.incident_impact": {
      tool_name: "tool.cloud_ops_incident_business_impact",
      args: {
        product_code: productCode,
        incident_id: typeof params.incident_id === "string" ? params.incident_id : "inc_ecs_gpu_sg_delay_001"
      }
    },
    "cloud.executive.briefing": {
      tool_name: "tool.cloud_executive_briefing",
      args: { focus: typeof params.focus === "string" ? params.focus : "risk_workflow_renewal" }
    },
    "cloud.modeling.product_to_commodity": {
      tool_name: "tool.cloud_product_model_draft",
      args: {
        product_code: typeof params.product_code === "string" ? params.product_code : undefined,
        product_name: typeof params.product_name === "string" ? params.product_name : undefined,
        product_description: typeof params.product_description === "string" ? params.product_description : undefined
      }
    },
    "cloud.solution.recommendation": {
      tool_name: "tool.cloud_solution_recommendation",
      args: {
        industry: typeof params.industry === "string" ? params.industry : undefined,
        budget_cny: typeof params.budget_cny === "number" ? params.budget_cny : undefined,
        needs: Array.isArray(params.needs) ? params.needs : undefined,
        customer_id: typeof params.customer_id === "string" ? params.customer_id : undefined
      }
    },
    "cloud.quote.self_service": {
      tool_name: "tool.cloud_self_service_quote",
      args: {
        budget_cny: typeof params.budget_cny === "number" ? params.budget_cny : 10000,
        quality: typeof params.quality === "string" ? params.quality : "720p_standard",
        target_duration_seconds: typeof params.target_duration_seconds === "number" ? params.target_duration_seconds : 5,
        package_id: typeof params.package_id === "string" ? params.package_id : "agent_plan_medium",
        scenario_type: typeof params.scenario_type === "string" ? params.scenario_type : "agent_with_search",
        customer_id: typeof params.customer_id === "string" ? params.customer_id : undefined
      }
    },
    "cloud.estimate.seedance_video_seconds": {
      tool_name: "tool.estimate_seedance_video_seconds",
      args: {
        budget_cny: typeof params.budget_cny === "number" ? params.budget_cny : 10000,
        quality: typeof params.quality === "string" ? params.quality : "720p_standard",
        target_duration_seconds: typeof params.target_duration_seconds === "number" ? params.target_duration_seconds : 5,
        customer_id: typeof params.customer_id === "string" ? params.customer_id : undefined
      }
    },
    "cloud.estimate.agent_plan_rounds": {
      tool_name: "tool.estimate_agent_plan_rounds",
      args: {
        package_id: typeof params.package_id === "string" ? params.package_id : "agent_plan_medium",
        scenario_type: typeof params.scenario_type === "string" ? params.scenario_type : undefined,
        extra_budget_cny: typeof params.extra_budget_cny === "number" ? params.extra_budget_cny : undefined
      }
    },
    "cloud.ops.degradation_plan": {
      tool_name: "tool.cloud_ops_degradation_plan",
      args: { product_code: productCode }
    },
    "cloud.agent_plan.overage_policy": {
      tool_name: "tool.cloud_agent_plan_overage_policy",
      args: {}
    },
    "cloud.retrospective.template": {
      tool_name: "tool.cloud_retrospective_template",
      args: { product_code: productCode }
    },
    "cloud.risk.release_review": {
      tool_name: "tool.cloud_release_risk_review",
      args: { release_request_id: releaseRequestId }
    },
    "cloud.workflow.release_request": {
      tool_name: "tool.create_cloud_approval_summary",
      args: { release_request_id: releaseRequestId }
    }
  };
  return intentCode ? calls[intentCode] ?? null : null;
}

function shouldUseDeterministicCloudShortcut(): boolean {
  return /^(1|true|yes)$/i.test(process.env.CLOUD_AGENTIC_DETERMINISTIC_SHORTCUT ?? "");
}

function summarizeDeterministicCloudObservation(observation: Record<string, unknown>): string {
  if (observation.ok === false) {
    return `云商品工具执行失败：${String(observation.message ?? observation.error ?? "未知错误")}`;
  }
  return "已完成云商品业务分析。该结果来自演示数据和估算假设，不代表正式价格、库存、SLA 或生产变更。";
}

function normalizeDagPlan(plan: unknown): DagNode[] {
  const raw = Array.isArray(plan) ? plan : [];
  return raw
    .map((item, index) => {
      const record = item && typeof item === "object" ? item as Record<string, unknown> : {};
      return {
        id: String(record.id ?? `step_${index + 1}`),
        tool_name: typeof record.tool_name === "string" ? record.tool_name : typeof record.tool === "string" ? record.tool : typeof record.name === "string" ? record.name : null,
        args: record.args && typeof record.args === "object" ? record.args as JsonObject : {},
        depends_on: Array.isArray(record.depends_on) ? record.depends_on.map(String) : []
      };
    })
    .filter((item): item is DagNode => Boolean(item.tool_name));
}

function normalizeObservation(value: unknown): AgenticObservation {
  if (value && typeof value === "object") return value as AgenticObservation;
  return { ok: true, data: { value: value as JsonValue } };
}

function resolveDagArgs(args: JsonObject, completed: Map<string, AgenticObservation>): JsonObject {
  return JSON.parse(JSON.stringify(args ?? {}), (_key, value) => {
    if (typeof value !== "string") return value;
    const match = value.match(/^\$\{([^}]+)\}$/);
    if (!match) return value;
    const [nodeId, ...path] = match[1].split(".");
    let current: unknown = completed.get(nodeId);
    for (const segment of path) current = current && typeof current === "object" ? (current as Record<string, unknown>)[segment] : undefined;
    return current ?? null;
  });
}

function recordEvidence(state: PlannerState, { call, observation }: AgenticObservationItem): PlannerState {
  const evidence = [
    ...(state.evidence ?? []),
    {
      tool: call.tool_name,
      ok: observation?.ok !== false,
      row_count: observation?.row_count ?? observation?.data?.rows?.length ?? null,
      error: observation?.error ?? null
    }
  ].slice(-20);
  return { ...state, evidence };
}

function buildObservationMessage({ observations, plannerState }: { observations: AgenticObservationItem[]; plannerState: PlannerState }): string {
  const skillInjections = observations
    .filter(({ observation }) => observation?._kind === "skill_injection")
    .map(({ call, observation }) => `（由 ${call.tool_name} 注入的写作说明 / 上下文）\n${truncate(observation.injection_text, 6000)}`);
  const toolPayload = observations.map(({ call, observation }) => ({
    tool: call.tool_name,
    args: call.args,
    observation
  }));
  return [
    skillInjections.join("\n\n"),
    `工具观察结果：\n${truncate(JSON.stringify(toolPayload), 8000)}`,
    `当前 planner_state：\n${truncate(JSON.stringify(plannerState), 3000)}`
  ].filter(Boolean).join("\n\n");
}

function mergeShortStrings(current: unknown[] = [], incoming: unknown[] = []): string[] {
  const list = Array.isArray(incoming) ? incoming : [];
  const merged = (Array.isArray(current) ? current : []).filter((item): item is string => typeof item === "string");
  for (const item of list) {
    if (typeof item !== "string") continue;
    const value = item.trim().slice(0, 160);
    if (value && !merged.includes(value)) merged.push(value);
  }
  return merged.slice(-12);
}

function stripCodeFence(text: unknown): string {
  if (typeof text !== "string") return "";
  let trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    trimmed = trimmed.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "");
  }
  trimmed = trimmed.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return trimmed;
}

function tryParseJSON(text: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function truncate(text: unknown, max: number): string {
  if (typeof text !== "string") return "";
  return text.length > max ? text.slice(0, max) + "...(truncated)" : text;
}

function normalizeSkillId(s: unknown): string {
  return String(s ?? "").replace(/[-_]/g, "").toLowerCase();
}

function normalizeProposal(raw: unknown): Record<string, unknown> {
  const record = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  if (!raw || typeof raw !== "object") return { name: null, what_it_does: null, why_needed: null, sample_args: null };
  return {
    name: typeof record.name === "string" ? record.name.slice(0, 120) : null,
    what_it_does: typeof record.what_it_does === "string" ? record.what_it_does.slice(0, 600) : null,
    why_needed: typeof record.why_needed === "string" ? record.why_needed.slice(0, 600) : null,
    sample_args: record.sample_args ?? null
  };
}

// 合并 tool + assistant(只挑用户可见动作) 为按时间排序的 flat traces，
// 字段与改造前一致，这样 orchestrator 步骤摘要 / router-poc 里
// `traces.find(t => t.type === "propose_tool")` 这类断言无须改动。
// lifecycle 事件不进 flat，留在 streams.lifecycle 单独看。
function mergeStreams(streams: AgenticStreams): Array<Record<string, unknown>> {
  const all: Array<Record<string, unknown>> = [];
  for (const t of streams.tool ?? []) all.push(t); // type:"tool_call"
  for (const a of streams.assistant ?? []) {
    if (a.type === "decision") continue; // decision 是过程态，flat 只暴露最终 action
    all.push(a); // type:"answer" | "propose_tool"
  }
  all.sort((a, b) => Number(a.ts ?? 0) - Number(b.ts ?? 0));
  return all;
}

function summarizeObservation(observation: AgenticObservation | null | undefined): Record<string, unknown> | null {
  if (!observation) return null;
  if (observation._kind === "skill_injection") {
    return { kind: "skill_injection", skill: observation.skill, injected_chars: observation.injection_text?.length ?? 0 };
  }
  if (observation.intent_code) {
    return { intent_code: observation.intent_code, ok: observation.ok, row_count: observation.row_count };
  }
  if (observation.tool === "safe_compute") {
    return { tool: "safe_compute", ok: observation.ok, value_preview: JSON.stringify(observation.data?.value ?? null).slice(0, 120) };
  }
  return { ok: observation.ok, error: observation.error };
}
