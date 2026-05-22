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
import { RuntimeHooks } from "../runtime/hooks.js";
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

interface AgenticExecuteInput {
  user?: UserContext;
  workspace?: unknown;
  message?: string;
  route?: Route;
  session?: Record<string, unknown>;
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
  async execute({ user, workspace, message, route, session, onEmit }: AgenticExecuteInput = {}) {
    const startedAt = Date.now();
    const tools = this.getAvailableTools({ user, workspace });
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
    const pushTool: StreamPush = (entry) => {
      const full = { ts: Date.now() - startedAt, ...entry };
      streams.tool.push(full);
      if (safeEmit) safeEmit({ kind: "agentic_tool", ...full });
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

    const apiKey = process.env.LLM_DECISION_API_KEY ?? process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      const localResult = await this.tryLocalAgenticFallback({ user, workspace, message, route, session, streams, pushLifecycle, pushTool });
      if (localResult) return localResult;
      pushLifecycle("fallback", { reason: "no_api_key" });
      return this.buildFallback({ message, route, reason: "未配置 LLM_API_KEY，agentic 直接兜底返回。", streams });
    }

    const conversation = [
      { role: "system", content: this.buildSystemPrompt({ tools, user }) },
      { role: "user", content: buildPlannerUserMessage({ message, plannerState }) }
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
        const localResult = await this.tryLocalAgenticFallback({ user, workspace, message, route, session, streams, pushLifecycle, pushTool });
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
        const dagResult = await this.executeDagPlan({ plan: decision.plan ?? decision.steps, user, workspace, session, step, pushLifecycle, pushTool });
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
        const calls = normalizeToolCalls(decision);
        if (!calls.length) {
          lastError = "agentic tool_call 缺少工具名";
          pushLifecycle("step_failed", { step, error: lastError });
          break;
        }
        pushLifecycle("parallel_tools_started", { step, count: calls.length });
        const observations = await Promise.all(calls.map(async (call) => {
          const observation = await this.callTool({ callName: call.tool_name, args: call.args, user, workspace, session });
          return { call, observation };
        }));
        for (const { call, observation } of observations) {
          executedToolResults.push({
            ok: observation?.ok !== false,
            tool: call.tool_name,
            data: observation,
            error: observation.error,
            message: observation.message
          });
          plannerState = recordEvidence(plannerState, { call, observation });
          pushTool({ step, type: "tool_call", tool: call.tool_name, args: call.args, observation_summary: summarizeObservation(observation) });
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

  getAvailableTools({ user, workspace }: { user?: UserContext; workspace?: unknown }): AgenticToolView[] {
    const list: AgenticToolView[] = [];
    // 1. intent.*
    for (const manifest of this.intentRegistry.listCodes()) {
      // 跨意图规划只暴露 intent_query / 聚合类（chitchat/agentic 不该被自己调用）
      if (manifest.handler_type !== "intent_query") continue;
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

  buildSystemPrompt({ tools, user }: { tools: AgenticToolView[]; user?: UserContext }) {
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
  "plan": [{"id": "inventory", "tool_name": "intent.dealer.query.inventory", "args": {}, "depends_on": []}],
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
      "4. 用户没明确给出的字段填 null；不要瞎猜门店/车系。",
      "5. 有充分信息就直接 action=answer 给最终回答，回答里把『我做了什么、看到了什么、结论』讲清楚。",
      "6. 如果跨意图任务其实只需要单个 intent，仍然走单个 tool_call → answer 两步。",
      "7. 罕见情况：如果你强烈认为现有工具列表完全不够、需要某个全新能力，可以把 action 设为 propose_tool 并附 proposed_tool: {name, what_it_does, why_needed}（仅做记录，本期不会真执行；下一步你还得用现有工具或 answer）。绝大多数任务都不该走这条。"
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

  async callTool({ callName, args, user, workspace, session }: { callName?: string; args?: JsonObject; user?: UserContext; workspace?: unknown; session?: Record<string, unknown> }): Promise<AgenticObservation> {
    if (callName?.startsWith("intent.")) {
      const intent_code = callName.slice("intent.".length);
      const manifest = this.intentRegistry.getCode(intent_code);
      if (!manifest) return { ok: false, error: "unknown_intent", message: `intent ${intent_code} 不存在` };
      const result = await this.intentQueryHandler.execute({
        user,
        workspace,
        message: "(by agentic)",
        intent_code,
        params: args ?? {},
        route: { intent_code, params: args ?? {}, source: "agentic" },
        session
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
      const result = await this.toolRegistry.execute({ name: underlying, args }, { user, workspace });
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
    streams,
    pushLifecycle,
    pushTool
  }: {
    user?: UserContext;
    workspace?: unknown;
    message?: string;
    route?: Route;
    session?: Record<string, unknown>;
    streams: AgenticStreams;
    pushLifecycle: LifecyclePush;
    pushTool: StreamPush;
  }) {
    const text = String(message ?? "");
    if (!/(维修工单|工单|售后).*(上周|对比|相比|环比|跟上周比|和上周比)/.test(text)) return null;
    const calls: AgenticToolCall[] = [
      { tool_name: "intent.dealer.aggregate.repair_orders", args: { metric: "total_receivable", time_range: "本周" } },
      { tool_name: "intent.dealer.aggregate.repair_orders", args: { metric: "total_receivable", time_range: "上周" } }
    ];
    pushLifecycle("local_fallback_started", { reason: "repair_week_over_week" });
    const observations: AgenticObservationItem[] = [];
    for (const [index, call] of calls.entries()) {
      const observation = await this.callTool({ callName: call.tool_name, args: call.args, user, workspace, session });
      observations.push({ call, observation });
      pushTool({ step: index, type: "tool_call", tool: call.tool_name, args: call.args, observation_summary: summarizeObservation(observation) });
    }
    const current = observations[0]?.observation?.answer ?? "本周暂无数据";
    const previous = observations[1]?.observation?.answer ?? "上周暂无数据";
    const answer = `我分别查了本周和上周的售后维修工单结算金额。\n\n本周：${current}\n\n上周：${previous}\n\n当前离线环境无法调用规划模型做进一步归因，但两段口径已经按同一维修工单聚合指标返回，可用于人工对比。`;
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

  async executeDagPlan({ plan, user, workspace, session, step, pushLifecycle, pushTool }: {
    plan?: unknown;
    user?: UserContext;
    workspace?: unknown;
    session?: Record<string, unknown>;
    step: number;
    pushLifecycle: LifecyclePush;
    pushTool: StreamPush;
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
        const observation = await this.callTool({ callName: node.tool_name, args, user, workspace, session });
        return { call: { tool_name: node.tool_name, args, id: node.id }, observation };
      }));
      for (const result of waveResults) {
        completed.set(result.call.id, result.observation);
        pending.delete(result.call.id);
        results.push(result);
        pushTool({ step, type: "tool_call", tool: result.call.tool_name, args: result.call.args, observation_summary: summarizeObservation(result.observation), dag_node: result.call.id });
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

function buildPlannerUserMessage({ message, plannerState }: { message?: string; plannerState: PlannerState }): string {
  return JSON.stringify({
    user_request: message,
    planner_state: plannerState,
    continuity_summary: plannerState.claimed_task ? createTaskContinuitySummary(plannerState.claimed_task) : null,
    task_instruction: plannerState.claimed_task
      ? "你已经恢复了一个相关长程任务。回答开头应自然承接：说明恢复到哪个任务、当前进度/next_action、接下来要做什么；然后继续执行。必要时调用 task.update/task.complete。"
      : "如用户表达继续上次、刚才那个、长期跟进，请优先使用 task.retrieve 找到相关任务。",
    instruction: "请先判断是否需要工具。多个独立查询可以在同一轮用 tools 数组并发返回。"
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
