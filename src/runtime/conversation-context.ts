import type { JsonObject } from "../types/agent-contracts.js";
import type { AgentSession, SessionHistoryItem } from "../agent/session-store.js";
import { inferTaskFromRegistry, getStandaloneTaskKeywords } from "../domains/runtime-registry.js";

interface ConversationTask {
  intent: string | null;
  intent_code: string | null;
  selected_skill: string | null;
  target: string | null;
  operation: string | null;
  filters: unknown[];
  summary: string | null;
}

interface ConversationTurn {
  user: SessionHistoryItem;
  assistant?: SessionHistoryItem;
  metadata: JsonObject | null;
}

interface BuildConversationContextInput {
  session?: Partial<AgentSession> | null;
  currentMessage?: string;
  enterpriseContext?: {
    runtime?: unknown;
  } | null;
}

export interface ConversationContext {
  runtime: unknown;
  session: {
    id?: string;
    status?: string;
    active_intent: string | null;
    active_skill: string | null;
    scenario: ReturnType<typeof summarizeScenario>;
  };
  current_message: ReturnType<typeof analyzeCurrentMessage>;
  recent_messages: Array<{ messageId: string; role?: string; text: string }>;
  previous_turns: Array<ReturnType<typeof summarizeTurn>>;
  last_task: ConversationTask | null;
  continuation: {
    is_likely_continuation: boolean;
    reason: string;
    candidate_task: ConversationTask | null;
  };
}

export function buildConversationContext({ session, currentMessage, enterpriseContext }: BuildConversationContextInput): ConversationContext {
  const history = Array.isArray(session?.history) ? session.history : [];
  const previousTurns = toTurns(history).slice(-6);
  const lastTask = findLastTask(previousTurns, history);
  const current = analyzeCurrentMessage(currentMessage, lastTask);

  return {
    runtime: enterpriseContext?.runtime ?? null,
    session: {
      id: session?.id,
      status: session?.status,
      active_intent: session?.active_intent ?? null,
      active_skill: session?.active_skill ?? null,
      scenario: summarizeScenario(session?.scenario)
    },
    current_message: current,
    recent_messages: history.slice(-10).map((item, index) => ({
      messageId: item.messageId ?? item.id ?? `history-${index + 1}`,
      role: item.role,
      text: summarizeText(item.text)
    })),
    previous_turns: previousTurns.map(summarizeTurn),
    last_task: lastTask,
    continuation: {
      is_likely_continuation: current.is_likely_continuation,
      reason: current.continuation_reason,
      candidate_task: current.is_likely_continuation ? lastTask : null
    }
  };
}

export function summarizeConversationContext(context?: ConversationContext | null): Pick<ConversationContext, "session" | "current_message" | "last_task" | "continuation"> & { previous_turns?: ConversationContext["previous_turns"] } | null {
  if (!context) return null;
  return {
    session: context.session,
    current_message: context.current_message,
    last_task: context.last_task,
    continuation: context.continuation,
    previous_turns: context.previous_turns?.slice(-3)
  };
}

function toTurns(history: SessionHistoryItem[]): ConversationTurn[] {
  const turns: ConversationTurn[] = [];
  for (let index = 0; index < history.length; index += 1) {
    const item = history[index];
    if (item.role !== "user") continue;
    const assistant = history.slice(index + 1).find((next) => next.role === "assistant");
    turns.push({
      user: item,
      assistant,
      metadata: assistant?.metadata ?? item.metadata ?? null
    });
  }
  return turns;
}

function findLastTask(turns: ConversationTurn[], history: SessionHistoryItem[]): ConversationTask | null {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const task = taskFromMetadata(turns[index].metadata);
    if (task) return task;
  }
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const task = inferTaskFromText(history[index].text);
    if (task) return task;
  }
  return null;
}

function taskFromMetadata(metadata?: JsonObject | null): ConversationTask | null {
  const hasToolCalls = Array.isArray(metadata?.tool_calls) && metadata.tool_calls.length > 0;
  if (!metadata?.route && !metadata?.selected_skill && !hasToolCalls) return null;
  const route = isObject(metadata.route) ? metadata.route : {};
  const toolCalls = Array.isArray(metadata.tool_calls) ? metadata.tool_calls.filter(isObject) : [];
  const firstBusinessCall = toolCalls.find((call) => call.name === "query_business_data");
  const args = isObject(firstBusinessCall?.args) ? firstBusinessCall.args : {};
  return {
    intent: stringOrNull(route.intent),
    intent_code: stringOrNull(route.intent_code),
    selected_skill: stringOrNull(metadata.selected_skill),
    target: stringOrNull(args.resource),
    operation: stringOrNull(args.operation),
    filters: Array.isArray(args.filters) ? args.filters : [],
    summary: stringOrNull(metadata.answer_summary)
  };
}

function inferTaskFromText(text?: string): ConversationTask | null {
  const value = String(text ?? "");
  if (/(制度|政策|流程|规则|标准|手册|报销|试用期)/.test(value)) {
    return {
      intent: "knowledge_qa",
      intent_code: "knowledge.policy_qa",
      selected_skill: "knowledge-qa",
      target: null,
      operation: null,
      filters: [],
      summary: summarizeText(value)
    };
  }
  // 通过 registry 动态查找域特定的任务推断（包括 core 域的 business/org 和其他域如 attendance）
  const domainTask = inferTaskFromRegistry(value);
  if (domainTask) {
    return {
      intent: "data_query",
      intent_code: domainTask.intent_code,
      selected_skill: domainTask.selected_skill,
      target: domainTask.target,
      operation: domainTask.operation,
      filters: [],
      summary: summarizeText(value)
    };
  }
  return null;
}

function analyzeCurrentMessage(message: string | undefined, lastTask: ConversationTask | null): { text: string; is_likely_continuation: boolean; continuation_reason: string } {
  const text = String(message ?? "").trim();
  // 所有独立任务关键词均由 domain packs 声明，通过 registry 动态获取
  const allKeywords = getStandaloneTaskKeywords();
  const hasStandaloneTask = allKeywords.some((kw) => text.includes(kw));
  const hasRefinementSignal = /(全公司|整个公司|公司全员|所有|全部|最近|近\d+|近[一二两三四五六七八九十]+|本月|上月|今天|昨天|明天|这个月|三个月|半年|一年|按|只看|筛选|换成|改成|范围|时间)/.test(text);
  const isShort = text.length > 0 && text.length <= 24;
  const isLikelyContinuation = Boolean(lastTask) && !hasStandaloneTask && (hasRefinementSignal || isShort);
  return {
    text,
    is_likely_continuation: isLikelyContinuation,
    continuation_reason: isLikelyContinuation
      ? "当前消息更像是在补充范围、时间或筛选条件，应结合 last_task 理解。"
      : "当前消息可独立理解。"
  };
}

function summarizeTurn(turn: ConversationTurn): { user: string; assistant: string; task: ConversationTask | null } {
  return {
    user: summarizeText(turn.user?.text),
    assistant: summarizeText(turn.assistant?.text),
    task: taskFromMetadata(turn.metadata) ?? inferTaskFromText(`${turn.user?.text ?? ""}\n${turn.assistant?.text ?? ""}`)
  };
}

function summarizeScenario(scenario: unknown): { intent: unknown; step: unknown; slots: unknown } | null {
  if (!scenario) return null;
  const value = isObject(scenario) ? scenario : {};
  return {
    intent: value.intent,
    step: value.step,
    slots: value.slots
  };
}

function summarizeText(text: unknown, maxLength = 300): string {
  const normalized = String(text ?? "").replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
