/**
 * Agent Contracts — 运行时类型定义。
 *
 * 基础类型（JsonValue、IntentManifest、Route、UserContext 等）已提升到
 * src/engine/contracts/base-types.ts（frozen 层），此文件 re-export 它们
 * 以保持向后兼容。运行时独有的类型（RouterLLMResult、AgenticDecision 等）
 * 仍在此文件中定义。
 *
 * 依赖方向：engine/contracts/base-types.ts → 此文件 re-export
 */

// ── Re-export from contracts base-types (frozen) ─────────────────────────────

export type {
  JsonPrimitive,
  JsonValue,
  JsonObject,
  Confidence,
  ExecutionClass,
  HandlerType,
  IntentParamSchemaField,
  IntentParamSchema,
  DeterministicRuleManifest,
  IntentToolBinding,
  IntentManifest,
  Route,
  UserContext,
  QueryFilter,
  QuerySort,
  QueryEntity,
  QueryMetric,
  QueryIR,
  ToolMetadata,
  ToolExecutionContext,
  ToolDefinition,
  ToolResult,
  ToolCall,
} from "../engine/contracts/base-types.js";

// ── Re-import for local use ──────────────────────────────────────────────────

import type {
  JsonObject,
  JsonValue,
  Confidence,
  ExecutionClass,
  HandlerType,
  IntentManifest,
  QueryFilter,
  QuerySort,
  ToolCall,
  ToolResult,
  UserContext,
  IntentToolBinding,
} from "../engine/contracts/base-types.js";

// ── Runtime-only types (not in contracts) ────────────────────────────────────

export interface IntentRegistry {
  getCode(intentCode: string): IntentManifest | null | undefined;
  listCodes(): IntentManifest[];
  getAllExamples(): Array<{ intent_code: string; example: string }>;
}

export interface RouteRequest {
  message?: string;
  now?: string;
  user_context?: UserContext;
  session_state?: SessionState;
}

export interface RouterLLMResult {
  intent_code: string;
  execution_class: ExecutionClass;
  handler_type: HandlerType;
  params: JsonObject;
  confidence: Confidence;
  reasoning?: string;
  source: string;
  param_validation?: RouteParamValidation;
}

export interface RouteParamValidation {
  ok: boolean;
  errors: string[];
}

export interface LastQueryRoute {
  intent_code: string;
  params?: JsonObject;
  ts?: string;
}

export interface SessionState {
  last_query_route?: LastQueryRoute;
  [key: string]: unknown;
}

export interface QueryAggregation {
  type?: string;
  field?: string;
  as?: string;
  [key: string]: JsonValue | undefined;
}

export interface QueryDisplay extends JsonObject {
  domain?: string;
  target?: string;
  operation?: string;
  entity_type?: string;
  entity_name?: string;
  include_children?: boolean;
  reason?: string;
}

export interface BusinessQueryArgs extends JsonObject {
  resource: string;
  operation?: "search" | "aggregate" | string;
  filters?: QueryFilter[];
  metrics?: JsonObject[];
  aggregations?: QueryAggregation[];
  derived?: JsonObject[];
  fields?: string[];
  sort?: QuerySort[];
  group_by?: string;
  limit?: number;
  display?: QueryDisplay;
}

export interface PermissionDecision {
  allow: boolean;
  code?: string;
  message?: string;
  policy?: string;
}

export interface PlannerState {
  objective: string;
  plan: string[];
  completed: string[];
  missing: string[];
  evidence: JsonValue[];
}

export interface AgenticToolCall {
  id?: string;
  tool_name: string;
  args: JsonObject;
}

export interface AgenticDagNode {
  id: string;
  tool_name: string;
  args: JsonObject;
  depends_on: string[];
}

export interface AgenticDecision {
  action: "tool_call" | "plan" | "dag_plan" | "answer" | "propose_tool" | string;
  tool_name?: string;
  tool?: string;
  args?: JsonObject;
  tools?: AgenticToolCall[];
  plan?: AgenticDagNode[];
  steps?: AgenticDagNode[];
  state_update?: Partial<Pick<PlannerState, "plan" | "completed" | "missing">>;
  answer?: string;
  reason?: string;
  proposed_tool?: JsonObject;
  proposal?: JsonObject;
}

export interface AgenticObservation {
  ok?: boolean;
  error?: string;
  message?: string;
  intent_code?: string;
  answer?: string;
  rows?: JsonValue[];
  row_count?: number;
  _kind?: string;
  [key: string]: unknown;
}

export interface AgenticObservationResult {
  call: AgenticToolCall;
  observation: AgenticObservation;
}

export interface AgenticStreamEntry {
  ts?: number;
  event?: string;
  type?: string;
  [key: string]: unknown;
}

export interface AgenticStreams {
  lifecycle: AgenticStreamEntry[];
  assistant: AgenticStreamEntry[];
  tool: AgenticStreamEntry[];
}

export interface ToolPlan {
  calls: ToolCall[];
}

export interface IntentQueryDebug {
  intent_code: string;
  params?: JsonObject;
  filters?: QueryFilter[];
  tool_call?: ToolCall;
  row_count?: number;
  operation?: string;
  denied?: string;
  error?: string;
  defaults_applied?: JsonObject[];
  [key: string]: unknown;
}

export interface IntentQueryResult {
  answer: string;
  table: {
    rows: JsonObject[];
    fields: string[];
  };
  debug: IntentQueryDebug;
  toolPlan: ToolPlan;
  toolResults: ToolResult[];
}

export interface CompiledBusinessQuery {
  calls: ToolCall[];
  clarification?: string;
  ir?: import("../engine/contracts/base-types.js").QueryIR;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  intents: string[];
  intent_codes: string[];
  triggers: string[];
  required_permissions: string[];
  required_primitives: string[];
  output_modes: string[];
  planning_style: string;
  source: string;
  install_type: string;
  dir: string;
  manifest_path: string | null;
  skill_path: string;
  instructions: string;
  metadata: JsonObject;
}

export interface SkillRegistryConfig {
  installed: Array<{
    id: string;
    name?: string;
    version?: string;
    enabled?: boolean;
    source_path?: string;
    local_path?: string;
    installed_at?: string;
  }>;
  overrides: Record<string, { enabled?: boolean; version?: string }>;
}
