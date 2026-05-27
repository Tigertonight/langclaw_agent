/**
 * Engine Contract: Base Types
 * Stability: frozen
 *
 * contracts 层的基础类型定义。
 * 这些类型是所有 contract 的公共基础，不依赖任何运行时模块。
 * agent-contracts.ts 从此处 re-export，保证依赖方向为 contracts → runtime。
 */

// ─── JSON 基础类型 ───────────────────────────────────────────────────────────

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

// ─── 通用枚举 ────────────────────────────────────────────────────────────────

export type Confidence = "low" | "medium" | "high";
export type ExecutionClass = "controlled_execution" | "autonomous_planning";
export type HandlerType = "intent_query" | "agentic" | "workflow" | "chitchat" | "knowledge_lookup";

// ─── Intent 相关 ─────────────────────────────────────────────────────────────

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

export interface IntentToolBinding {
  tool_name?: string;
  resource?: string;
  operation?: "search" | "aggregate" | string;
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

// ─── Route 相关 ──────────────────────────────────────────────────────────────

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

// ─── User Context ────────────────────────────────────────────────────────────

export interface UserContext {
  id: string;
  name?: string;
  role: string;
  department?: string;
  permissions?: string[];
  /**
   * 业务域可通过索引签名扩展用户字段（如 dealer 的 default_store /
   * accessible_customer_ids）。引擎层不内置任何业务字段，业务侧通过 bracket
   * access 或 DomainPack.userFieldSources 读取。
   */
  [key: string]: unknown;
}

// ─── Query 基础类型 ──────────────────────────────────────────────────────────

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

// ─── Tool 基础类型 ───────────────────────────────────────────────────────────

export interface ToolMetadata {
  required_permissions?: string[];
  intents?: string[];
  scenarios?: string[];
  steps?: string[];
  timeout_ms?: number;
  risk_level?: string;
  requires_confirmation?: boolean;
  [key: string]: unknown;
}

export interface ToolExecutionContext {
  user?: UserContext;
  workspace?: unknown;
  intent?: string;
  scenario?: string;
  step?: string;
  signal?: AbortSignal;
  [key: string]: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  schema?: JsonObject;
  inputSchema?: unknown;
  outputSchema?: unknown;
  metadata?: ToolMetadata;
  execute(args?: JsonObject, context?: ToolExecutionContext): Promise<unknown> | unknown;
}

export interface ToolResult {
  ok?: boolean;
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

export interface ToolCall {
  name: string;
  args?: JsonObject;
  metadata?: JsonObject;
}
