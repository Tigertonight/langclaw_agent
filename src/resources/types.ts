/**
 * ResourceRegistry 类型定义。
 *
 * ResourceConfig 描述一个可查询的业务数据资源（如 dealer_vehicles、leave_requests）。
 * ResourceRegistry 管理所有已注册的资源配置，供 BusinessDataTool 在运行时查找。
 */

import type { JsonValue } from "../types/agent-contracts.js";

type DataRow = Record<string, unknown>;

export interface BusinessToolContext {
  user: {
    id: string;
    name?: string;
    department?: string;
    permissions?: string[];
    /**
     * 业务字段（如 dealer 的 accessible_customer_ids）通过索引签名传递。
     * 引擎层用 bracket access 读取，避免对业务字段做硬编码声明。
     */
    [key: string]: unknown;
  };
}

/**
 * 资源配置：描述一个可查询的业务数据资源。
 *
 * 每个资源对应一个 JSON 数据文件（或自定义 loader），
 * 以及字段白名单、用户作用域、字段标签等元数据。
 */
export interface ResourceConfig {
  /** 数据文件路径（相对 cwd），与 loader 二选一 */
  file?: string;
  /** 数据行上的作用域字段名（如 "id"），与 userScopeField 配对：保留行的条件是 row[scopeField] ∈ user[userScopeField]。 */
  scopeField?: string;
  /**
   * 用户上下文中提供"允许的 ID 列表"的字段名（如 dealer 的 "accessible_customer_ids"）。
   * 当 scopeField 命中时，按 user[userScopeField] 数组做行级过滤。
   * 不声明时引擎不做行级过滤，避免引擎硬编码业务字段名。
   */
  userScopeField?: string;
  /** 作用域类型："self_user" 表示按 selfUserIdField 过滤 */
  scopeType?: string;
  /**
   * self_user 模式下的用户 ID 字段名（如 "applicant_user_id"）。
   * 当 scopeType === "self_user" 时，运行时用此字段做行级权限过滤。
   * 默认值："user_id"。
   */
  selfUserIdField?: string;
  /**
   * self_user 模式下的用户姓名字段名（如 "applicant_name"）。
   * 当 scopeType === "self_user" 时，运行时用此字段判断是否有按姓名过滤。
   */
  selfUserNameField?: string;
  /** 允许的字段白名单 */
  fields: string[];
  /** 自定义数据加载器（如 dealer_metrics 的动态计算） */
  loader?: (context: BusinessToolContext) => Promise<DataRow[]>;
  /** 所属 domain id（可选，用于追溯） */
  domain?: string;
  /**
   * 展示列定义（用于 Markdown 表格和 LLM 答案生成）。
   * 每项为 [field, label] 元组。
   * 如果未定义，IntentQueryHandler 会从 rows 的 keys 中自动推断。
   */
  displayColumns?: Array<[string, string]>;
  /**
   * 资源中文标签（如 "整车库存"、"请假记录"）。
   * 用于 readableResourceName 等场景，替代硬编码映射。
   */
  label?: string;
  /**
   * 资源中文业务说明。
   * 用于把表/实体含义传给 LLM 与 OpenUI，避免前台直接暴露资源 key。
   */
  description?: string;
  /**
   * 行模板函数：将单行数据格式化为人类可读的摘要字符串。
   * 用于 formatRowByResource 等场景，替代硬编码 if/else。
   */
  rowTemplate?: (row: DataRow, fieldLabels?: FieldLabels) => string;
  /**
   * 结果格式化函数：将整个 query_business_data 结果格式化为人类可读的字符串。
   * 比 rowTemplate 更强大，可以处理聚合、特殊查询模式（如领导查询）等复杂场景。
   * 如果定义了 resultFormatter，formatBusinessDataResult 会优先使用它。
   */
  resultFormatter?: (data: DataRow) => string | null;
  /**
   * Debug 字段列表：用于 pickDebugRowFields 等场景。
   * 如果未定义，使用 fields 白名单。
   */
  debugFields?: string[];
  /**
   * Fact key 映射：资源查询结果在 AgentState 中的 fact key。
   * 如 "dealer_metrics" → "dealer_metrics"，"dealer_vehicles" → "dealer_inventory_detail"。
   */
  factKey?: string;
  /**
   * 资源 schema 定义（字段名 → 字段描述/类型）。
   * 用于 query-parser / schema-catalog 等场景，替代硬编码 schema。
   */
  schema?: Record<string, string | { type?: string; description?: string; enum?: string[] }>;
  /**
   * 数据行规范化函数。
   * 在查询结果返回前对每行数据做格式化/规范化处理。
   * 如 leave_requests 的时间格式化。
   */
  normalizer?: (row: DataRow) => DataRow;
  /**
   * 查询默认返回行数上限。
   * 用于 query-compiler 的 defaultLimitForTarget，替代硬编码 if/else。
   * 如果未定义，使用全局默认值（20）。
   */
  defaultLimit?: number;
}

/**
 * 字段标签映射：field name → 中文展示标签。
 */
export type FieldLabels = Record<string, string>;
