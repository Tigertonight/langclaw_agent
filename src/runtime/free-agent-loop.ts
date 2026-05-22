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
  type AgentStep,
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
import type { ExecutionModeDecision } from "./execution-mode-router.js";
import type { LocalKnowledgeBase, KnowledgeSearchResult } from "../rag/local-knowledge-base.js";
import type { ToolRegistry } from "../tools/registry.js";
import type { JsonObject, JsonValue, Route, SkillDefinition, ToolPlan, ToolResult, UserContext } from "../types/agent-contracts.js";

interface AnswerResult {
  answer?: string;
  artifacts?: JsonValue[];
}

interface LlmClient {
  local?: LlmClient;
  planToolCalls(input: Record<string, unknown>): Promise<ToolPlan & { clarification?: string }>;
  planFollowUpToolCalls?(input: Record<string, unknown>): Promise<ToolPlan>;
  generateAnswer(input: Record<string, unknown>): Promise<AnswerResult>;
  generateFastGroundedAnswer?(input: Record<string, unknown>): Promise<AnswerResult>;
  [key: string]: unknown;
}

interface FreeAgentLoopOptions {
  llm: LlmClient;
  knowledgeBase: LocalKnowledgeBase;
  toolRegistry: ToolRegistry;
}

interface FreeAgentInput {
  user: UserContext;
  message: string;
  route: Partial<Route>;
  history?: unknown[];
  skills?: SkillDefinition[];
  selectedSkill?: SkillDefinition | null;
  workspace?: unknown;
  enterpriseContext?: unknown;
  conversationContext?: unknown;
  agentSteps?: AgentStep[];
  maxIterations?: number;
  execution?: ExecutionModeDecision;
  emit?: (event: JsonObject) => Promise<void> | void;
  pushStep?: (step: AgentStep) => Promise<void> | void;
}

type FastGroundedInput = Required<Pick<FreeAgentInput, "user" | "message" | "route" | "execution">>
  & Omit<FreeAgentInput, "user" | "message" | "route" | "execution">
  & { agentSteps: AgentStep[] };

interface FastGroundedResult {
  docs: KnowledgeSearchResult[];
  toolPlan: ToolPlan & { clarification?: string };
  toolResults: ToolResult[];
  answer: string;
  artifacts?: JsonValue[];
  agentSteps: AgentStep[];
  agentState: unknown;
  answerAlreadyStreamed?: boolean;
}

export class FreeAgentLoop {
  private readonly llm: LlmClient;
  private readonly knowledgeBase: LocalKnowledgeBase;
  private readonly toolRegistry: ToolRegistry;
  private readonly agenticLoop: AgenticLoop;

  constructor({ llm, knowledgeBase, toolRegistry }: FreeAgentLoopOptions) {
    this.llm = llm;
    this.knowledgeBase = knowledgeBase;
    this.toolRegistry = toolRegistry;
    this.agenticLoop = new AgenticLoop({ llm, toolRegistry });
  }

  async run(input: FreeAgentInput): Promise<unknown> {
    const execution = chooseExecutionMode(input);
    if (execution.mode === "agentic_task") {
      return this.agenticLoop.run({ ...input, maxIterations: execution.budget.max_iterations, execution });
    }
    return this.runFastGrounded({ ...input, agentSteps: input.agentSteps ?? [], execution });
  }

  async runStream(input: FreeAgentInput): Promise<unknown> {
    const execution = chooseExecutionMode(input);
    if (execution.mode === "agentic_task") {
      return this.agenticLoop.runStream({ ...input, maxIterations: execution.budget.max_iterations, execution });
    }
    return this.runFastGroundedStream({ ...input, execution });
  }

  async runFastGrounded({ user, message, route, history = [], skills = [], selectedSkill, workspace, enterpriseContext, conversationContext, agentSteps, execution }: FastGroundedInput): Promise<FastGroundedResult> {
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

    const toolResults: ToolResult[] = [];
    if (toolPlan.clarification && !toolPlan.calls?.length) {
      agentSteps.push(createAgentStep("ask_user", "需要补充信息", toolPlan.clarification));
      return { docs: [], toolPlan, toolResults, answer: toolPlan.clarification, agentSteps, agentState: snapshotAgentState(state) };
    }

    if (toolPlan.calls?.length) {
      const roundResults = await executeToolsNode({ toolRegistry: this.toolRegistry, user, workspace, toolPlan }) as ToolResult[];
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
        const followUpResults = await executeToolsNode({ toolRegistry: this.toolRegistry, user, workspace, toolPlan: followUpPlan }) as ToolResult[];
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
      ? { generateAnswer: (input: Record<string, unknown>) => this.llm.generateFastGroundedAnswer?.(input) ?? this.llm.generateAnswer(input) }
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
    }) as AnswerResult;
    agentSteps.push(createAgentStep("final_answer", "生成最终答复", "已使用 fast grounded 路径基于工具结果组织回答。"));
    return {
      docs,
      toolPlan,
      toolResults,
      answer: generated.answer ?? "",
      artifacts: generated.artifacts ?? [],
      agentSteps,
      agentState: snapshotAgentState(state)
    };
  }

  async runFastGroundedStream(input: FreeAgentInput & { execution: ExecutionModeDecision }): Promise<FastGroundedResult> {
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

function collectKnowledgeDocs(toolResults: ToolResult[] = []): KnowledgeSearchResult[] {
  const docs: KnowledgeSearchResult[] = [];
  const seen = new Set<string>();
  for (const result of toolResults) {
    if (result.tool !== "retrieve_knowledge" || !result.ok) continue;
    const resultDocs: KnowledgeSearchResult[] = Array.isArray(result.data?.docs)
      ? (result.data.docs as unknown[]).filter(isKnowledgeDoc)
      : [];
    for (const doc of resultDocs) {
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

function isKnowledgeDoc(value: unknown): value is KnowledgeSearchResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<KnowledgeSearchResult>;
  return typeof candidate.text === "string" && Boolean(candidate.metadata) && typeof candidate.score === "number";
}
