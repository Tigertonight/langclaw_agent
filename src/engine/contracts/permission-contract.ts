/**
 * Engine Contract: Permission
 * Stability: stable
 *
 * 权限规则协议。DomainPack 通过此协议声明域特定的权限规则。
 * Engine 的权限检查器在执行查询前遍历所有注册的权限规则。
 */

import type { UserContext, IntentManifest } from "./base-types.js";

/**
 * PermissionRule 输入：传递给权限规则函数的运行时信息。
 */
export interface PermissionRuleInput {
  /** 资源标识（来自 manifest.tool_binding.resource） */
  resource?: string;
  /** 用户上下文 */
  user: UserContext;
  /** 用户已有权限集合 */
  userPermissions: Set<string>;
  /** 意图清单 */
  manifest: IntentManifest;
}

/**
 * PermissionRule 函数签名。
 *
 * 返回 { ok: true } 表示放行（跳过后续检查），
 * 返回 null 表示此规则不处理（继续检查下一条规则）。
 */
export type PermissionRuleFn = (input: PermissionRuleInput) => { ok: true } | null;
