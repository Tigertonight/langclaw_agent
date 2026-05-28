import type { JsonObject, JsonValue, Route, ToolCall, ToolResult, UserContext } from "../types/agent-contracts.js";
import type { WorkspaceContext } from "../runtime/workspace-context.js";

export interface EvolutionTraceTurn {
  at: string;
  user_message: string;
  assistant_answer: string;
  route?: Partial<Route> | JsonObject;
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
  agent_steps?: Array<Record<string, unknown>>;
  task_snapshot?: unknown;
}

export interface EvolutionSessionTrace {
  started_at?: string;
  updated_at?: string;
  turns: EvolutionTraceTurn[];
  failures?: Array<JsonObject>;
  interruptions?: Array<JsonObject>;
  task_state_changes?: Array<JsonObject>;
}

export interface EvolutionTurnInput {
  trigger: "agent_finish" | "manual" | "session_idle";
  user: UserContext;
  workspace: WorkspaceContext;
  sessionId: string;
  message: string;
  answer: string;
  route?: Partial<Route> | JsonObject;
  toolPlan?: { calls?: ToolCall[] };
  toolResults?: ToolResult[];
  conversationContext?: unknown;
  enterpriseContext?: unknown;
  agentSteps?: Array<Record<string, unknown>>;
  sessionTrace?: EvolutionSessionTrace;
  /**
   * 在 turn_end 时从 ObservabilityPlugin.getActiveTraceContext() 抓拍到的 trace_id / run_id。
   * SignalCollector 异步触发 reviewTurn 时 trace 已经 end，但 traceId 仍可用——
   * memory-service 收到后会把 evolution write span 续到同一 trace 下。
   */
  traceId?: string;
  runId?: string;
}

export interface EvolutionDecision {
  should_evolve: boolean;
  confidence?: number;
  reason?: string;
  memory_actions?: MemoryAction[];
  task_actions?: TaskAction[];
  skill_actions?: SkillAction[];
}

export interface MemoryAction extends JsonObject {
  op: "upsert" | "remove";
  type: "preference" | "fact" | "procedure" | "episode" | "feedback" | "project" | "reference" | "user";
  key: string;
  value?: string;
  confidence?: number;
  source?: string;
}

export interface TaskAction extends JsonObject {
  op: "upsert" | "complete" | "archive" | "remove";
  task_id?: string;
  title?: string;
  goal?: string;
  status?: "active" | "waiting_user" | "completed" | "archived";
  known_facts?: string[];
  open_questions?: string[];
  next_action?: string;
  confidence?: number;
}

export interface SkillAction extends JsonObject {
  op: "preference";
  skill_id?: string;
  value: string;
  confidence?: number;
}

export interface EvolutionResult extends JsonObject {
  status: "disabled" | "skipped" | "applied" | "rejected";
  trigger: EvolutionTurnInput["trigger"];
  reason?: string;
  decision?: JsonObject;
  applied?: {
    memory?: number;
    tasks?: number;
    skills?: number;
    /** Phase 2.5：通过结构化抽取写入的实体数 */
    entities?: number;
    /** Phase 2.5：通过结构化抽取写入的关系数 */
    relations?: number;
  };
  errors?: JsonValue[];
}
