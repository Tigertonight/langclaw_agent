/**
 * Engine Contract: Query
 * Stability: stable
 *
 * 查询适配协议。DomainPack 通过此协议声明查询适配器、过滤转换、查询 schema 等。
 * Engine 的 QueryEngine / IntentQueryHandler 消费这些协议。
 */

import type {
  JsonObject,
  JsonValue,
  IntentManifest,
  QueryFilter,
  QuerySort,
  ToolResult,
  Route,
  UserContext,
} from "./base-types.js";

// ─── Filter Transform ────────────────────────────────────────────────────────

/**
 * FilterTransform 上下文：传递给 transform 函数的运行时信息。
 */
export interface FilterTransformContext {
  /** 原始用户消息 */
  message?: string;
  /** 用户上下文（权限、门店等） */
  user?: UserContext;
  /** mapping rule 定义（来自 intent manifest 的 param_mapping） */
  rule: JsonObject;
}

/**
 * FilterTransform 函数签名。
 *
 * 接收参数原始值和上下文，返回转换后的值。
 * 返回值可以是：
 * - JsonValue：简单值替换
 * - QueryFilter：单个过滤条件
 * - QueryFilter[]：多个过滤条件
 * - null：跳过此参数
 */
export type FilterTransformFn = (
  value: unknown,
  ctx: FilterTransformContext
) => JsonValue | QueryFilter | QueryFilter[] | null;

// ─── Query Adapter ───────────────────────────────────────────────────────────

export interface QueryAdapterInput {
  intentCode: string;
  resource: string;
  params: JsonObject;
  manifest: IntentManifest;
}

export interface DefaultsInput extends QueryAdapterInput {
  message: string;
  user?: UserContext;
}

export interface DefaultsResult {
  params?: JsonObject;
  filters?: QueryFilter[];
}

export interface FiltersInput extends QueryAdapterInput {
  message: string;
  user?: UserContext;
  existingFilters?: QueryFilter[];
}

export interface SortInput extends QueryAdapterInput {
  message: string;
}

export interface AnswerPostProcessInput {
  answer: string;
  rows: Record<string, JsonValue | undefined>[];
  toolResult?: ToolResult;
  params: JsonObject;
  route: Route;
  manifest: IntentManifest;
  user?: UserContext;
  message?: string;
}

export interface DomainQueryAdapter {
  /** 所属 domain id */
  domain: string;
  /** 判断此 adapter 是否处理给定的查询 */
  supports(input: QueryAdapterInput): boolean;
  /** 注入默认参数和过滤条件 */
  applyDefaults?(input: DefaultsInput): DefaultsResult | null;
  /** 构建业务特定的过滤条件 */
  buildFilters?(input: FiltersInput): QueryFilter[] | null;
  /** 构建业务特定的排序规则 */
  buildSort?(input: SortInput): QuerySort[] | null;
  /** 对最终答案做后处理（如补丁文案） */
  postProcessAnswer?(input: AnswerPostProcessInput): string;
  /**
   * 判断用户问题是否属于此 domain 的业务范围（NLP 启发式）。
   * 用于 query-parser 的意图分流，替代硬编码的 isDomainRelevantQuestion 等函数。
   */
  isRelevantQuestion?(question: string): boolean;
  /**
   * 判断用户问题是否属于此 domain 的分析类问题。
   * 用于 query-parser 的分析意图识别。
   */
  isAnalysisQuestion?(question: string): boolean;
  /**
   * 解析用户问题为 QueryIR（NLP 启发式）。
   * 用于 query-parser 的本地查询解析，替代硬编码的 parseDealerQuery 等函数。
   */
  parseQuery?(input: { question: string; operation: string; forcedTarget?: string; user?: import("../../types/agent-contracts.js").UserContext }): import("../../types/agent-contracts.js").QueryIR | null;
  /**
   * 规划多资源查询（NLP 启发式）。
   * 用于 query-parser 的多资源查询规划，替代硬编码的 planDomainMultiQuery。
   */
  planMultiQuery?(input: { question: string; operation?: string }): import("../../types/agent-contracts.js").QueryIR[] | null;
  /**
   * 从 NLP 启发式推断会话任务（用于 conversation-context 的 inferTaskFromText）。
   * 返回 null 表示此 adapter 不处理该问题。
   */
  inferTask?(question: string): { intent_code: string; selected_skill: string; target: string; operation: string } | null;
}

// ─── Query Resource Schema ───────────────────────────────────────────────────

/**
 * 查询资源 schema 定义。
 * 用于 query-compiler 编译 QueryIR 时确定字段白名单、默认字段、默认排序。
 * 与 ResourceConfig.schema（字段描述）互补：querySchemas 面向查询编译，
 * ResourceConfig.schema 面向 UI 展示和 LLM 提示。
 */
export interface QueryResourceSchema {
  /** 实体名称（如 "dealer_vehicle"、"leave_request"） */
  entity: string;
  /** 所有可查询字段 */
  fields: string[];
  /** 默认返回字段（未指定 fields 时使用） */
  defaultFields: string[];
  /** 默认排序规则 */
  defaultSort: QuerySort[];
}
