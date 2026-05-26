/**
 * Engine Contract: Resource
 * Stability: stable
 *
 * 资源定义协议。DomainPack 通过此协议声明业务数据资源。
 * Engine 不关心资源的业务语义，只关心资源的结构和元数据。
 */

import type { JsonValue } from "./base-types.js";

export interface ResourceFieldDef {
  type?: string;
  label?: string;
  filterable?: boolean;
  sortable?: boolean;
  [key: string]: JsonValue | undefined;
}

export interface ResourceConfig {
  /** 资源标识，如 "dealer_vehicles"、"leave_requests" */
  id: string;
  /** 数据文件路径（相对 cwd） */
  dataPath: string;
  /** 允许的字段白名单 */
  allowedFields: string[];
  /** 字段定义（可选，用于 UI 展示和校验） */
  fieldDefs?: Record<string, ResourceFieldDef>;
  /** 用户作用域字段（如 "store_id"、"applicant_id"），用于自动注入权限过滤 */
  userScopeField?: string;
  /** 所属 domain id */
  domain?: string;
  [key: string]: JsonValue | undefined;
}
