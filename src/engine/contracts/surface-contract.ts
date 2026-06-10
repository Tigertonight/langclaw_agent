/**
 * Engine Contract: Surface
 * Stability: stable
 *
 * UI Surface 协议。DomainPack 通过此协议声明 OpenUI Lang Surface 构建器。
 * Engine 的 OpenUI Lang response builder 消费这些构建器生成业务 UI 面板。
 */

import type { JsonObject, ToolResult, Route, UserContext } from "./base-types.js";

// ─── OpenUI Lang Surface ─────────────────────────────────────────────────────

export interface SurfaceBuildInput {
  intentCode: string;
  resource?: string;
  toolResult?: ToolResult;
  params?: JsonObject;
  route?: Route;
  user?: UserContext;
}

/**
 * Domain Surface Builder：由 domain 注册，用于生成业务 UI 面板。
 *
 * 多个 SurfaceBuilder 同时 supports() 时，取注册顺序中第一个返回非 null 的结果；
 * domain 可通过声明 priority 显式控制顺序。
 */
export interface DomainSurfaceBuilder {
  id: string;
  domain: string;
  priority?: number;
  supports(input: SurfaceBuildInput): boolean;
  build(input: SurfaceBuildInput): JsonObject | null;
}
