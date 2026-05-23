export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

export type Confidence = "low" | "medium" | "high";
export type ExecutionClass = "controlled_execution" | "autonomous_planning";
export type HandlerType = "intent_query" | "agentic" | "workflow" | "chitchat" | "knowledge_lookup";

export interface IntentParamSchemaField {
  type?: "string" | "number" | "boolean" | "array" | "object" | "enum";
  required?: boolean;
  enum?: JsonValue[];
  values?: JsonValue[];
  default?: JsonValue;
  description?: string;
  examples?: JsonValue[];
}

export type IntentParamSchema = Record<string, IntentParamSchemaField>;

export interface DeterministicRuleManifest {
  name?: string;
  enabled?: boolean;
  priority?: number;
  intent_code?: string;
  patterns: string[];
  negative_patterns?: string[];
  params?: JsonObject;
  extractors?: Record<string, string>;
  reasoning?: string;
}

export interface IntentManifest {
  intent_code: string;
  description?: string;
  execution_class?: ExecutionClass;
  handler_type: HandlerType;
  confidence_threshold?: Confidence;
  params_schema?: IntentParamSchema;
  deterministic_rules?: DeterministicRuleManifest[];
  tool_binding?: IntentToolBinding;
  metric_definitions?: Record<string, JsonObject>;
  required_permissions?: string[];
  filter_mapping?: Record<string, JsonObject | JsonObject[]>;
  [key: string]: unknown;
}

export interface IntentRegistry {
  getCode(intentCode: string): IntentManifest | null | undefined;
  listCodes(): IntentManifest[];
  getAllExamples(): Array<{ intent_code: string; example: string }>;
}

export interface Route {
  intent?: string;
  intent_code: string;
  execution_class: ExecutionClass;
  handler_type: HandlerType;
  params: JsonObject;
  confidence: Confidence;
  reasoning?: string;
  source?: string;
  param_validation?: {
    ok: boolean;
    errors?: string[];
  };
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

export interface UserContext {
  id: string;
  name?: string;
  role: string;
  department?: string;
  default_store?: string;
  permissions?: string[];
  accessible_customer_ids?: string[];
  [key: string]: unknown;
}

export interface ToolCall {
  name: string;
  args?: JsonObject;
}

export interface QueryFilter extends JsonObject {
  field: string;
  op?: string;
  operator?: string;
  value?: JsonValue;
}

export interface QuerySort extends JsonObject {
  field: string;
  direction?: "asc" | "desc" | string;
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

export interface ToolMetadata {
  required_permissions?: string[];
  intents?: string[];
  scenarios?: string[];
  steps?: string[];
  /** 单个工具的硬超时（毫秒）。优先级高于 TOOL_EXECUTION_TIMEOUT_MS env。 */
  timeout_ms?: number;
  /** 风险等级。常见取值: read / write / destructive / sensitive_read / sandboxed_compute。 */
  risk_level?: string;
  /** 是否需要用户二次确认 */
  requires_confirmation?: boolean;
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema?: JsonObject;
  metadata?: ToolMetadata;
  execute(args?: JsonObject, context?: ToolExecutionContext): Promise<unknown> | unknown;
}

export interface ToolResult {
  ok?: boolean;
  /**
   * 显式失败标记。等价语义于 ok === false，但保留出来是为了与 LLM 的
   * function-calling 协议（如 Anthropic tool_result 的 is_error）对齐，
   * 让模型在 transcript 里能直接读到"工具失败"信号并自行决策。
   */
  isError?: boolean;
  tool?: string;
  error?: string;
  code?: string;
  message?: string;
  data?: {
    rows?: JsonObject[];
    fields?: string[];
    value?: JsonValue;
    [key: string]: JsonValue | JsonObject[] | string[] | undefined;
  };
  [key: string]: unknown;
}

export interface ToolPlan {
  calls: ToolCall[];
}

export interface ToolExecutionContext {
  user?: UserContext;
  workspace?: unknown;
  intent?: string;
  scenario?: string;
  step?: string;
  /**
   * 由 ToolRegistry.execute 注入的取消信号。工具实现应在 fetch / db 查询等
   * I/O 处把它透传下去（fetch 第二参 { signal }，pg 用 query.abort 等），
   * 这样 timeout / 用户取消 / 上层主动 abort 时能真正释放资源。
   * 旧工具忽略 signal 也不会出错，只是无法真正中断。
   */
  signal?: AbortSignal;
  [key: string]: unknown;
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

export interface IntentToolBinding {
  tool_name?: string;
  resource?: string;
  operation?: "search" | "aggregate" | string;
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

export interface QueryEntity {
  type?: string;
  id?: string;
  name?: string;
  include_children?: boolean;
  [key: string]: unknown;
}

export interface QueryMetric {
  type?: string;
  field?: string;
  as?: string;
  [key: string]: JsonValue | undefined;
}

export interface QueryIR {
  kind: "business_query_ir";
  version: number;
  domain: string;
  target: string;
  operation: string;
  entity?: QueryEntity | string | null;
  filters: QueryFilter[];
  metrics: QueryMetric[];
  fields: string[];
  sort: QuerySort[];
  limit: number;
  needsClarification?: string | null;
  reason?: string;
}

export interface CompiledBusinessQuery {
  calls: ToolCall[];
  clarification?: string;
  ir?: QueryIR;
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
