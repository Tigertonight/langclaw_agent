import { summarizeUser } from "../auth/users.js";
import { planDealerEvidenceFollowUp } from "../dealer/dealer-evidence.js";
import {
  executeToolsNode,
  generateAnswerNode,
  planFollowUpToolCallsNode,
  planToolCallsNode,
  retrieveKnowledgeNode
} from "../agent/nodes.js";
import {
  createAgentStep,
  createKnowledgeStep,
  createObservationStep,
  createPlanStep,
  createToolSteps
} from "./agent-events.js";
import {
  createAgentState,
  decideContinuation,
  recordKnowledgeObservation,
  recordPlan,
  recordToolRound,
  snapshotAgentState
} from "./agent-state.js";

export class FreeAgentLoop {
  constructor({ llm, knowledgeBase, toolRegistry }) {
    this.llm = llm;
    this.knowledgeBase = knowledgeBase;
    this.toolRegistry = toolRegistry;
    this.maxToolRounds = 3;
  }

  async run({ user, message, route, history = [], skills = [], selectedSkill, enterpriseContext, conversationContext, agentSteps }) {
    const state = createAgentState({ user, message, route, history, skills, enterpriseContext });
    const docs = await retrieveKnowledgeNode({
      knowledgeBase: this.knowledgeBase,
      user,
      message,
      route
    });
    recordKnowledgeObservation(state, docs);
    agentSteps.push(createKnowledgeStep(docs));

    const toolPlan = await planToolCallsNode({
      llm: this.llm,
      toolRegistry: this.toolRegistry,
      user,
      message,
      route,
      history,
      skills,
      selectedSkill,
      enterpriseContext,
      conversationContext
    });
    recordPlan(state, toolPlan);
    agentSteps.push(createPlanStep(toolPlan));

    const toolResults = [];
    if (toolPlan.clarification && toolPlan.calls.length === 0) {
      agentSteps.push(createAgentStep("ask_user", "需要补充信息", toolPlan.clarification));
      return { docs, toolPlan, toolResults, answer: toolPlan.clarification, agentSteps, agentState: snapshotAgentState(state) };
    }

    const previousCalls = [];
    let currentToolPlan = toolPlan;
    for (let round = 0; round < this.maxToolRounds && currentToolPlan.calls.length > 0; round += 1) {
      agentSteps.push(createAgentStep("tool_round", `第 ${round + 1} 轮执行`, describeToolRound(round, currentToolPlan)));
      const roundResults = await executeToolsNode({
        toolRegistry: this.toolRegistry,
        user,
        toolPlan: currentToolPlan
      });
      toolResults.push(...roundResults);
      previousCalls.push(...currentToolPlan.calls);
      recordToolRound(state, currentToolPlan, roundResults);
      agentSteps.push(...createToolSteps(currentToolPlan, roundResults));
      agentSteps.push(createObservationStep(state));

      const evidenceFollowUpPlan = planDealerEvidenceFollowUp({
        message,
        route,
        agentState: snapshotAgentState(state),
        previousCalls
      });
      decideContinuation(state, evidenceFollowUpPlan);
      if (evidenceFollowUpPlan.calls?.length && state.status === "running") {
        agentSteps.push(createAgentStep("plan_evidence", "补齐证据", "长任务还缺少可引用的数据明细，继续补齐经营分析证据。", {
          action: {
            type: "tool_call",
            tools: evidenceFollowUpPlan.calls.map((call) => call.name)
          }
        }));
        currentToolPlan = evidenceFollowUpPlan;
        continue;
      }

      const followUpPlan = await planFollowUpToolCallsNode({
        llm: this.llm,
        toolRegistry: this.toolRegistry,
        user,
        message,
        route,
        history,
        toolResults,
        previousCalls,
        agentState: snapshotAgentState(state)
      });
      decideContinuation(state, followUpPlan);
      if (!followUpPlan.calls?.length) break;
      agentSteps.push(createAgentStep("plan_follow_up", "继续判断", "根据上一轮工具结果，发现还需要补充查询。", {
        action: {
          type: "tool_call",
          tools: followUpPlan.calls.map((call) => call.name)
        }
      }));
      currentToolPlan = followUpPlan;
    }

    const generated = await generateAnswerNode({
      llm: this.llm,
      user: summarizeUser(user),
      message,
      route,
      docs,
      toolResults,
      enterpriseContext,
      conversationContext
    });

    agentSteps.push(createAgentStep("final_answer", "生成最终答复", "已结合可访问的数据、知识库片段和执行结果组织回答。"));
    return { docs, toolPlan: { calls: previousCalls }, toolResults, answer: generated.answer, artifacts: generated.artifacts ?? [], agentSteps, agentState: snapshotAgentState(state) };
  }

  async runStream({ user, message, route, history = [], skills = [], selectedSkill, enterpriseContext, conversationContext, agentSteps, emit, pushStep }) {
    const state = createAgentState({ user, message, route, history, skills, enterpriseContext });
    const docs = await retrieveKnowledgeNode({
      knowledgeBase: this.knowledgeBase,
      user,
      message,
      route,
      history
    });
    recordKnowledgeObservation(state, docs);
    await pushStep(createKnowledgeStep(docs));
    await emit({ type: "sources", sources: docs.map((doc) => ({
      source: doc.metadata.source,
      title: doc.metadata.title,
      heading: doc.metadata.heading,
      score: doc.score
    })) });

    const toolPlan = await planToolCallsNode({
      llm: this.llm,
      toolRegistry: this.toolRegistry,
      user,
      message,
      route,
      history,
      skills,
      selectedSkill,
      enterpriseContext,
      conversationContext
    });
    recordPlan(state, toolPlan);
    await pushStep(createPlanStep(toolPlan));

    const toolResults = [];
    if (toolPlan.clarification && toolPlan.calls.length === 0) {
      await pushStep(createAgentStep("ask_user", "需要补充信息", toolPlan.clarification));
      return { docs, toolPlan, toolResults, answer: toolPlan.clarification, agentSteps, agentState: snapshotAgentState(state) };
    }

    const previousCalls = [];
    let currentToolPlan = toolPlan;
    for (let round = 0; round < this.maxToolRounds && currentToolPlan.calls.length > 0; round += 1) {
      await pushStep(createAgentStep("tool_round", `第 ${round + 1} 轮执行`, describeToolRound(round, currentToolPlan)));
      const roundResults = await executeToolsNode({
        toolRegistry: this.toolRegistry,
        user,
        toolPlan: currentToolPlan
      });
      toolResults.push(...roundResults);
      previousCalls.push(...currentToolPlan.calls);
      recordToolRound(state, currentToolPlan, roundResults);
      for (const step of createToolSteps(currentToolPlan, roundResults)) {
        await pushStep(step);
      }
      await pushStep(createObservationStep(state));

      const evidenceFollowUpPlan = planDealerEvidenceFollowUp({
        message,
        route,
        agentState: snapshotAgentState(state),
        previousCalls
      });
      decideContinuation(state, evidenceFollowUpPlan);
      if (evidenceFollowUpPlan.calls?.length && state.status === "running") {
        await pushStep(createAgentStep("plan_evidence", "补齐证据", "长任务还缺少可引用的数据明细，继续补齐经营分析证据。", {
          action: {
            type: "tool_call",
            tools: evidenceFollowUpPlan.calls.map((call) => call.name)
          }
        }));
        currentToolPlan = evidenceFollowUpPlan;
        continue;
      }

      const followUpPlan = await planFollowUpToolCallsNode({
        llm: this.llm,
        toolRegistry: this.toolRegistry,
        user,
        message,
        route,
        history,
        toolResults,
        previousCalls,
        agentState: snapshotAgentState(state)
      });
      decideContinuation(state, followUpPlan);
      if (!followUpPlan.calls?.length) break;
      await pushStep(createAgentStep("plan_follow_up", "继续判断", "根据上一轮工具结果，发现还需要补充查询。", {
        action: {
          type: "tool_call",
          tools: followUpPlan.calls.map((call) => call.name)
        }
      }));
      currentToolPlan = followUpPlan;
    }

    await pushStep(createAgentStep("final_answer", "生成最终答复", "正在结合执行过程、工具结果和知识库内容组织回答。"));

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
        await emit({ type: "delta", text: token });
      }
    });

    return {
      docs,
      toolPlan: { calls: previousCalls },
      toolResults,
      answer: generated.answer || answer,
      artifacts: generated.artifacts ?? [],
      agentSteps,
      agentState: snapshotAgentState(state),
      answerAlreadyStreamed: true
    };
  }
}

function describeToolRound(round, toolPlan) {
  const resources = (toolPlan.calls ?? [])
    .map((call) => call.args?.resource)
    .filter(Boolean);
  const target = resources.length ? resources.join("、") : (toolPlan.calls ?? []).map((call) => call.name).join("、");
  if (round === 0) return `首轮查询核心事实：${target || "业务工具"}。`;
  return `第 ${round + 1} 轮 loop 补充缺失证据：${target || "业务工具"}。`;
}
