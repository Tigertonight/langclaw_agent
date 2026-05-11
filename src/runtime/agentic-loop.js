import { INTENTS } from "../agent/ports.js";
import { enforceSkillContracts } from "../agent/nodes.js";
import { checkToolPermission } from "../auth/permissions.js";
import { summarizeUser } from "../auth/users.js";
import { planDealerEvidenceFollowUp } from "../dealer/dealer-evidence.js";
import {
  createAgentStep,
  createToolSteps
} from "./agent-events.js";
import {
  createAgentTaskState,
  recordAgentAskUser,
  recordAgentBlocked,
  recordAgentDecision,
  recordAgentFinished,
  recordAgentToolRound,
  snapshotAgentTaskState
} from "./agent-task-state.js";

export class AgenticLoop {
  constructor({ llm, toolRegistry, maxIterations = 6 }) {
    this.llm = llm;
    this.toolRegistry = toolRegistry;
    this.maxIterations = maxIterations;
  }

  async run(input) {
    return this.runInternal({ ...input, stream: false });
  }

  async runStream(input) {
    return this.runInternal({ ...input, stream: true });
  }

  async runInternal({
    user,
    message,
    route,
    history = [],
    skills = [],
    selectedSkill,
    enterpriseContext,
    conversationContext,
    agentSteps,
    stream = false,
    emit,
    pushStep,
    maxIterations = this.maxIterations,
    execution
  }) {
    const state = createAgentTaskState({
      user,
      message,
      route,
      history,
      skills,
      enterpriseContext,
      maxIterations
    });
    if (execution) {
      state.execution_mode = execution.mode;
      state.execution_reason = execution.reason;
    }
    const toolResults = [];
    const previousCalls = [];
    let docs = [];
    let earlyAnswer = null;
    let answerAlreadyStreamed = false;

    const addStep = async (step) => {
      if (stream) {
        await pushStep?.(step);
      } else {
        agentSteps.push(step);
      }
    };

    for (let index = 0; index < maxIterations; index += 1) {
      const availableTools = listAgentTools(this.toolRegistry, { user, route });
      const decision = await this.decide({
        user,
        message,
        question: message,
        route,
        history,
        skills,
        selectedSkill,
        enterpriseContext,
        conversationContext,
        state: snapshotAgentTaskState(state),
        toolResults,
        previousCalls,
        availableTools
      });
      recordAgentDecision(state, decision);
      await addStep(createDecisionStep(decision, state.iteration));

      const action = normalizeAction(decision.action);
      if (action.type === "ask_user") {
        const question = action.question || decision.reason || "还需要补充信息后才能继续。";
        recordAgentAskUser(state, question);
        await addStep(createAgentStep("ask_user", "需要补充信息", question));
        earlyAnswer = question;
        break;
      }

      if (action.type === "answer" || action.type === "finish") {
        recordAgentFinished(state, action.type);
        if (action.answer) earlyAnswer = action.answer;
        break;
      }

      if (action.type !== "tool_call") {
        recordAgentBlocked(state, `模型返回了暂不支持的动作：${action.type || "unknown"}`);
        break;
      }

      const contractedPlan = await enforceSkillContracts({ calls: normalizeToolCalls(action) }, {
        message,
        selectedSkill,
        enterpriseContext
      });
      const calls = contractedPlan.calls ?? [];
      if (!calls.length) {
        recordAgentFinished(state, "no_tool_calls");
        break;
      }

      await addStep(createAgentStep("tool_round", `第 ${state.iteration} 轮执行`, describeToolRound(state.iteration, calls)));
      const roundResults = await executeToolCalls({
        toolRegistry: this.toolRegistry,
        user,
        calls
      });
      toolResults.push(...roundResults);
      previousCalls.push(...calls);
      recordAgentToolRound(state, calls, roundResults);
      docs = collectKnowledgeDocs(toolResults);
      for (const step of createToolSteps({ calls }, roundResults)) {
        await addStep(step);
      }
      await addStep(createAgentObservationStep(state));
      if (stream && docs.length) await emitSources(emit, docs);

      const evidenceFollowUpPlan = planDealerEvidenceFollowUp({
        message,
        route,
        agentState: snapshotAgentTaskState(state),
        previousCalls
      });
      if (evidenceFollowUpPlan.calls?.length && state.iteration < maxIterations) {
        await addStep(createAgentStep("plan_evidence", "补齐证据", "经营分析还缺少可引用的数据明细，系统补充了一组证据查询。", {
          action: {
            type: "tool_call",
            tools: evidenceFollowUpPlan.calls.map((call) => call.name)
          }
        }));
        const evidenceResults = await executeToolCalls({
          toolRegistry: this.toolRegistry,
          user,
          calls: evidenceFollowUpPlan.calls
        });
        toolResults.push(...evidenceResults);
        previousCalls.push(...evidenceFollowUpPlan.calls);
        recordAgentToolRound(state, evidenceFollowUpPlan.calls, evidenceResults);
        docs = collectKnowledgeDocs(toolResults);
        for (const step of createToolSteps(evidenceFollowUpPlan, evidenceResults)) {
          await addStep(step);
        }
        await addStep(createAgentObservationStep(state));
      }
    }

    docs = collectKnowledgeDocs(toolResults);
    if (!earlyAnswer && state.status === "running") {
      recordAgentFinished(state, "max_iterations_or_ready");
    }

    let answer = earlyAnswer;
    let artifacts = [];
    if (!answer) {
      await addStep(createAgentStep("final_answer", "生成最终答复", stream
        ? "正在结合目标、计划、观察结果和工具返回组织回答。"
        : "已结合目标、计划、观察结果和工具返回组织回答。"));
      const generated = stream
        ? await this.streamAnswer({ user, message, route, docs, toolResults, enterpriseContext, conversationContext, emit })
        : await this.llm.generateAnswer({
          user: summarizeUser(user),
          question: message,
          route,
          docs,
          toolResults,
          enterpriseContext,
          conversationContext,
          agentState: snapshotAgentTaskState(state)
        });
      answer = generated.answer;
      artifacts = generated.artifacts ?? [];
      answerAlreadyStreamed = Boolean(stream);
    } else {
      await addStep(createAgentStep("final_answer", "生成最终答复", "模型判断当前应直接给出答复或追问。"));
      if (stream) {
        await streamText(emit, answer);
        answerAlreadyStreamed = true;
      }
    }

    return {
      docs,
      toolPlan: { calls: previousCalls },
      toolResults,
      answer,
      artifacts,
      agentSteps,
      agentState: snapshotAgentTaskState(state),
      answerAlreadyStreamed
    };
  }

  async decide(input) {
    if (typeof this.llm.decideNextAction === "function") {
      const decision = await this.llm.decideNextAction(input);
      if (decision?.action?.type) return decision;
    }
    return createFallbackDecision(input);
  }

  async streamAnswer({ user, message, route, docs, toolResults, enterpriseContext, conversationContext, emit }) {
    let answer = "";
    const generated = await this.llm.streamAnswer({
      user: summarizeUser(user),
      question: message,
      route,
      docs,
      toolResults,
      enterpriseContext,
      conversationContext
    }, {
      onToken: async (token) => {
        answer += token;
        await emit?.({ type: "delta", text: token });
      },
      onThinking: async ({ delta, text }) => {
        await emit?.({
          type: "thinking",
          model_thinking: true,
          delta,
          text,
          step: {
            phase: "model_thinking",
            title: "思考中",
            detail: text,
            status: "running"
          }
        });
      }
    });
    return {
      ...generated,
      answer: generated.answer || answer
    };
  }
}

async function executeToolCalls({ toolRegistry, user, calls }) {
  const results = [];
  for (const call of calls) {
    const permission = await checkToolPermission(user, call);
    if (!permission.allow) {
      results.push({
        ok: false,
        tool: call.name,
        error: "permission_denied",
        code: permission.code,
        message: permission.message
      });
      continue;
    }
    results.push(await toolRegistry.execute(call, { user }));
  }
  return results;
}

function listAgentTools(toolRegistry, { user, route }) {
  const intents = route.intent === INTENTS.KNOWLEDGE_QA
    ? [INTENTS.KNOWLEDGE_QA, INTENTS.DATA_QUERY]
    : route.intent === INTENTS.MIXED
      ? [INTENTS.MIXED, INTENTS.DATA_QUERY, INTENTS.KNOWLEDGE_QA]
      : [route.intent];
  const byName = new Map();
  for (const intent of intents) {
    for (const tool of toolRegistry.list({ user, intent })) {
      byName.set(tool.name, tool);
    }
  }
  return [...byName.values()];
}

function normalizeAction(action = {}) {
  const type = action.type === "final_answer" ? "answer" : action.type;
  return { ...action, type };
}

function normalizeToolCalls(action = {}) {
  const raw = Array.isArray(action.tools)
    ? action.tools
    : action.tool
      ? [{ name: action.tool, args: action.args ?? {} }]
      : [];
  return raw.map((call) => ({
    name: call.name ?? call.tool,
    args: call.args ?? {}
  })).filter((call) => call.name);
}

function createFallbackDecision({ state, toolResults = [], previousCalls = [] }) {
  const fallbackCalls = state.next_fallback_calls ?? [];
  if (!previousCalls.length && fallbackCalls.length) {
    return {
      thought_summary: "使用本地兜底规划先获取必要信息。",
      reason: "远程决策不可用，回退到本地工具规划。",
      action: {
        type: "tool_call",
        tools: fallbackCalls
      }
    };
  }
  return {
    thought_summary: "当前没有新的可执行工具动作。",
    reason: toolResults.length ? "已有工具结果，进入回答阶段。" : "没有可用工具计划，直接回答。",
    action: {
      type: "answer"
    }
  };
}

function createDecisionStep(decision, iteration) {
  const action = normalizeAction(decision.action);
  const detail = [
    decision.decision_source ? `决策来源：${decision.decision_source}。` : null,
    decision.fallback_reason ? `回退原因：${decision.fallback_reason}。` : null,
    decision.thought_summary || `第 ${iteration} 轮判断下一步。`,
    action.type === "tool_call" ? `下一步调用工具：${normalizeToolCalls(action).map((call) => call.name).join("、")}。` : null,
    action.type === "ask_user" ? `需要追问：${action.question || decision.reason || ""}` : null,
    action.type === "answer" || action.type === "finish" ? "模型判断可以进入回答阶段。" : null
  ].filter(Boolean).join(" ");
  return createAgentStep("decide_next_action", "决定下一步", detail, {
    action: {
      type: action.type,
      tools: normalizeToolCalls(action).map((call) => call.name)
    }
  });
}

function createAgentObservationStep(state) {
  const latest = state.observations?.slice(-3) ?? [];
  const missing = state.missing_facts ?? [];
  const summaries = latest.map((item) => item.summary).filter(Boolean);
  return createAgentStep("observe_result", "观察结果", [
    summaries.length ? summaries.join("；") : "已整理当前执行结果。",
    missing.length ? `仍需关注：${missing.join("、")}。` : "当前关键事实已基本补齐。"
  ].join(" "), {
    observation: {
      known_facts: state.known_facts,
      missing_facts: state.missing_facts,
      status: state.status,
      iteration: state.iteration
    }
  });
}

function describeToolRound(iteration, calls) {
  const resources = calls.map((call) => call.args?.resource).filter(Boolean);
  const target = resources.length ? resources.join("、") : calls.map((call) => call.name).join("、");
  return `第 ${iteration} 轮根据观察结果执行：${target || "工具调用"}。`;
}

function collectKnowledgeDocs(toolResults = []) {
  const docs = [];
  const seen = new Set();
  for (const result of toolResults) {
    if (result.tool !== "retrieve_knowledge" || !result.ok) continue;
    for (const doc of result.data?.docs ?? []) {
      const key = [
        doc.metadata?.source,
        doc.metadata?.title,
        doc.metadata?.heading,
        doc.text
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      docs.push(doc);
    }
  }
  return docs;
}

async function emitSources(emit, docs) {
  await emit?.({ type: "sources", sources: docs.map((doc) => ({
    source: doc.metadata.source,
    title: doc.metadata.title,
    heading: doc.metadata.heading,
    score: doc.score
  })) });
}

async function streamText(emit, text) {
  const chunks = String(text ?? "").match(/.{1,8}/gs) ?? [];
  for (const chunk of chunks) {
    await emit?.({ type: "delta", text: chunk });
    await new Promise((resolve) => setTimeout(resolve, 12));
  }
}
