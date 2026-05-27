import { checkToolPermission } from "../auth/permissions.js";
import { enforceSkillContractsFromRegistry } from "../domains/runtime-registry.js";
import { INTENTS } from "./ports.js";
import type { KnowledgeSearchResult } from "../rag/local-knowledge-base.js";
import type { ToolDescription, ToolRegistry } from "../tools/registry.js";
import type {
  JsonObject,
  JsonValue,
  Route,
  SkillDefinition,
  ToolCall,
  ToolPlan,
  ToolResult,
  UserContext
} from "../types/agent-contracts.js";

const TOOL_INTENTS = [INTENTS.DATA_QUERY, INTENTS.MIXED, INTENTS.KNOWLEDGE_QA] as string[];
const KNOWLEDGE_INTENTS = [INTENTS.KNOWLEDGE_QA, INTENTS.MIXED] as string[];

interface LlmNodeClient {
  classifyIntent?(input: Record<string, unknown>): Promise<Route>;
  planToolCalls(input: Record<string, unknown>): Promise<ToolPlan & { clarification?: string }>;
  planFollowUpToolCalls?(input: Record<string, unknown>): Promise<ToolPlan>;
  generateAnswer(input: Record<string, unknown>): Promise<{ answer?: string; artifacts?: JsonValue[] }>;
}

interface KnowledgeBase {
  search(message: string, user: UserContext, options: { topK: number }): Promise<KnowledgeSearchResult[]>;
}

export async function classifyIntentNode({ llm, user, message, history = [], enterpriseContext, conversationContext }: {
  llm: Required<Pick<LlmNodeClient, "classifyIntent">>;
  user: UserContext;
  message: string;
  history?: unknown[];
  enterpriseContext?: unknown;
  conversationContext?: unknown;
}): Promise<Route> {
  return llm.classifyIntent({ user, question: message, history, enterpriseContext, conversationContext });
}

export async function retrieveKnowledgeNode({ knowledgeBase, user, message, route }: {
  knowledgeBase: KnowledgeBase;
  user: UserContext;
  message: string;
  route: Partial<Route>;
}): Promise<KnowledgeSearchResult[]> {
  // 如果 intent_code 包含 "." 且不是 knowledge 类意图，跳过知识库检索
  // （域特定的数据查询不需要知识库）
  const intentCode = String(route.intent_code ?? "");
  if (intentCode.includes(".") && !intentCode.startsWith("knowledge.")) {
    return [];
  }
  if (!KNOWLEDGE_INTENTS.includes(String(route.intent ?? ""))) {
    return [];
  }
  return knowledgeBase.search(message, user, { topK: 5 });
}

export async function planToolCallsNode({ llm, toolRegistry, user, message, route, history = [], skills = [], selectedSkill, enterpriseContext, conversationContext }: {
  llm: LlmNodeClient;
  toolRegistry: ToolRegistry;
  user: UserContext;
  message: string;
  route: Partial<Route>;
  history?: unknown[];
  skills?: SkillDefinition[];
  selectedSkill?: SkillDefinition | null;
  enterpriseContext?: unknown;
  conversationContext?: unknown;
}): Promise<ToolPlan & { clarification?: string }> {
  if (!TOOL_INTENTS.includes(String(route.intent ?? ""))) {
    return { calls: [] };
  }
  const plan = await llm.planToolCalls({
    user,
    question: message,
    history,
    route,
    skills,
    selectedSkill,
    enterpriseContext,
    conversationContext,
    tools: listAgentTools(toolRegistry, { user, route })
  });
  return enforceSkillContractsFromRegistry(plan, { message, selectedSkill, enterpriseContext });
}

export async function planFollowUpToolCallsNode({ llm, toolRegistry, user, message, route, history = [], toolResults = [], previousCalls = [], agentState }: {
  llm: LlmNodeClient;
  toolRegistry: ToolRegistry;
  user: UserContext;
  message: string;
  route: Partial<Route>;
  history?: unknown[];
  toolResults?: ToolResult[];
  previousCalls?: ToolCall[];
  agentState?: unknown;
}): Promise<ToolPlan> {
  if (!TOOL_INTENTS.includes(String(route.intent ?? ""))) {
    return { calls: [] };
  }
  if (typeof llm.planFollowUpToolCalls !== "function") {
    return { calls: [] };
  }
  return llm.planFollowUpToolCalls({
    user,
    question: message,
    route,
    history,
    toolResults,
    previousCalls,
    agentState,
    tools: listAgentTools(toolRegistry, { user, route })
  });
}

function listAgentTools(toolRegistry: ToolRegistry, { user, route }: { user: UserContext; route: Partial<Route> }): ToolDescription[] {
  const intents = route.intent === INTENTS.KNOWLEDGE_QA
    ? [INTENTS.KNOWLEDGE_QA, INTENTS.DATA_QUERY]
    : route.intent === INTENTS.MIXED
      ? [INTENTS.MIXED, INTENTS.DATA_QUERY, INTENTS.KNOWLEDGE_QA]
      : [route.intent];
  const byName = new Map<string, ToolDescription>();
  for (const intent of intents) {
    for (const tool of toolRegistry.list({ user, intent })) {
      byName.set(tool.name, tool);
    }
  }
  return [...byName.values()];
}

export async function executeToolsNode({ toolRegistry, user, workspace, toolPlan }: {
  toolRegistry: ToolRegistry;
  user: UserContext;
  workspace?: unknown;
  toolPlan: ToolPlan;
}): Promise<ToolResult[]> {
  const toolResults: ToolResult[] = [];

  for (const call of toolPlan.calls) {
    const permission = await checkToolPermission(user, call);
    if (!permission.allow) {
      toolResults.push({
        ok: false,
        tool: call.name,
        error: "permission_denied",
        code: permission.code,
        message: permission.message
      });
      continue;
    }

    const result = await toolRegistry.execute(call, { user, workspace });
    toolResults.push(result as ToolResult);
  }

  return toolResults;
}

export async function generateAnswerNode({ llm, user, message, route, docs, toolResults, enterpriseContext, conversationContext }: {
  llm: Pick<LlmNodeClient, "generateAnswer">;
  user: UserContext | JsonObject;
  message: string;
  route: Partial<Route>;
  docs: KnowledgeSearchResult[];
  toolResults: ToolResult[];
  enterpriseContext?: unknown;
  conversationContext?: unknown;
}): Promise<{ answer?: string; artifacts?: JsonValue[] }> {
  return llm.generateAnswer({
    user,
    question: message,
    route,
    docs,
    toolResults,
    enterpriseContext,
    conversationContext
  });
}

