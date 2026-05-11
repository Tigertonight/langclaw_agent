import { AgenticLoop } from "./agentic-loop.js";
import { chooseExecutionMode } from "./execution-mode-router.js";
import { summarizeUser } from "../auth/users.js";
import {
  executeToolsNode,
  generateAnswerNode,
  planFollowUpToolCallsNode,
  planToolCallsNode
} from "../agent/nodes.js";
import {
  createAgentStep,
  createObservationStep,
  createPlanStep,
  createToolSteps,
  splitForStreaming
} from "./agent-events.js";
import {
  createAgentState,
  decideContinuation,
  recordPlan,
  recordToolRound,
  snapshotAgentState
} from "./agent-state.js";

export class FreeAgentLoop {
  constructor({ llm, knowledgeBase, toolRegistry }) {
    this.llm = llm;
    this.knowledgeBase = knowledgeBase;
    this.toolRegistry = toolRegistry;
    this.agenticLoop = new AgenticLoop({ llm, toolRegistry });
  }

  async run(input) {
    const execution = chooseExecutionMode(input);
    if (execution.mode === "agentic_task") {
      return this.agenticLoop.run({ ...input, maxIterations: execution.budget.max_iterations, execution });
    }
    return this.runFastGrounded({ ...input, execution });
  }

  async runStream(input) {
    const execution = chooseExecutionMode(input);
    if (execution.mode === "agentic_task") {
      return this.agenticLoop.runStream({ ...input, maxIterations: execution.budget.max_iterations, execution });
    }
    return this.runFastGroundedStream({ ...input, execution });
  }

  async runFastGrounded({ user, message, route, history = [], skills = [], selectedSkill, enterpriseContext, conversationContext, agentSteps, execution }) {
    const state = createAgentState({ user, message, route, history, skills, enterpriseContext });
    agentSteps.push(createAgentStep("select_execution_mode", "选择执行模式", `使用 fast_grounded：${execution.reason}`));
    const groundedLlm = this.llm.local ?? this.llm;
    const toolPlan = await planToolCallsNode({
      llm: groundedLlm,
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
    if (toolPlan.clarification && !toolPlan.calls?.length) {
      agentSteps.push(createAgentStep("ask_user", "需要补充信息", toolPlan.clarification));
      return { docs: [], toolPlan, toolResults, answer: toolPlan.clarification, agentSteps, agentState: snapshotAgentState(state) };
    }

    if (toolPlan.calls?.length) {
      const roundResults = await executeToolsNode({ toolRegistry: this.toolRegistry, user, toolPlan });
      toolResults.push(...roundResults);
      recordToolRound(state, toolPlan, roundResults);
      agentSteps.push(...createToolSteps(toolPlan, roundResults));
      agentSteps.push(createObservationStep(state));

      const followUpPlan = await planFollowUpToolCallsNode({
        llm: groundedLlm,
        toolRegistry: this.toolRegistry,
        user,
        message,
        route,
        history,
        toolResults,
        previousCalls: toolPlan.calls,
        agentState: snapshotAgentState(state)
      });
      decideContinuation(state, followUpPlan);
      if (followUpPlan.calls?.length) {
        agentSteps.push(createAgentStep("plan_follow_up", "继续判断", "fast grounded 发现还需要补充一次查询。", {
          action: {
            type: "tool_call",
            tools: followUpPlan.calls.map((call) => call.name)
          }
        }));
        const followUpResults = await executeToolsNode({ toolRegistry: this.toolRegistry, user, toolPlan: followUpPlan });
        toolResults.push(...followUpResults);
        recordToolRound(state, followUpPlan, followUpResults);
        toolPlan.calls.push(...followUpPlan.calls);
        agentSteps.push(...createToolSteps(followUpPlan, followUpResults));
        agentSteps.push(createObservationStep(state));
        decideContinuation(state, { calls: [] });
      } else {
        decideContinuation(state, followUpPlan);
      }
    } else {
      decideContinuation(state, { calls: [] });
    }

    const docs = collectKnowledgeDocs(toolResults);
    const answerLlm = typeof this.llm.generateFastGroundedAnswer === "function"
      ? { generateAnswer: (input) => this.llm.generateFastGroundedAnswer(input) }
      : this.llm;
    const generated = await generateAnswerNode({
      llm: answerLlm,
      user: summarizeUser(user),
      message,
      route,
      docs,
      toolResults,
      enterpriseContext,
      conversationContext
    });
    agentSteps.push(createAgentStep("final_answer", "生成最终答复", "已使用 fast grounded 路径基于工具结果组织回答。"));
    return {
      docs,
      toolPlan,
      toolResults,
      answer: generated.answer,
      artifacts: generated.artifacts ?? [],
      agentSteps,
      agentState: snapshotAgentState(state)
    };
  }

  async runFastGroundedStream(input) {
    const { emit, pushStep, agentSteps } = input;
    const result = await this.runFastGrounded({
      ...input,
      agentSteps: []
    });
    for (const step of result.agentSteps) {
      agentSteps.push(step);
      await pushStep?.(step);
    }
    for (const token of splitForStreaming(result.answer)) {
      await emit?.({ type: "delta", text: token });
      await new Promise((resolve) => setTimeout(resolve, 12));
    }
    return {
      ...result,
      agentSteps,
      answerAlreadyStreamed: true
    };
  }
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
