import type { QuerySort } from "../types/agent-contracts.js";
import { getQuerySchemas } from "../domains/runtime-registry.js";

export interface ResourceSchema {
  entity: string;
  fields: string[];
  defaultFields: string[];
  defaultSort: QuerySort[];
}

/**
 * 获取资源 schema。
 * 从 DomainRegistry 动态获取，未注册时返回 undefined。
 */
export function getResourceSchema(resource: string): ResourceSchema | undefined {
  return getQuerySchemas()[resource];
}

/**
 * 获取所有已注册的资源 schema。
 */
export function getAllResourceSchemas(): Record<string, ResourceSchema> {
  return getQuerySchemas();
}

/**
 * @deprecated 使用 getResourceSchema() 或 getAllResourceSchemas() 代替。
 * 保留为 fallback，当 registry 未初始化时使用。
 */
export const RESOURCE_SCHEMAS: Record<string, ResourceSchema> = new Proxy({} as Record<string, ResourceSchema>, {
  get(_target, prop: string) {
    return getResourceSchema(prop);
  },
  ownKeys() {
    return Object.keys(getAllResourceSchemas());
  },
  has(_target, prop: string) {
    return getResourceSchema(prop) !== undefined;
  },
  getOwnPropertyDescriptor(_target, prop: string) {
    const schema = getResourceSchema(prop);
    if (!schema) return undefined;
    return { configurable: true, enumerable: true, value: schema, writable: false };
  },
});

export const QUERY_OPERATIONS = {
  SEARCH: "search",
  AGGREGATE: "aggregate"
} as const;
