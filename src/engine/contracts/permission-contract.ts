/**
 * Engine Contract: Permission
 * Stability: stable
 *
 * 权限规则协议。DomainPack 通过此协议声明域特定的权限规则。
 * Engine 的权限检查器在执行查询前遍历所有注册的权限规则。
 */

import type { UserContext, IntentManifest, ToolCall } from "./base-types.js";
import type { PermissionDecision } from "../../types/agent-contracts.js";

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

/**
 * ToolPermissionPolicy 输入：传递给工具级权限策略的运行时信息。
 */
export interface ToolPermissionPolicyInput {
  user: UserContext;
  toolCall: ToolCall;
}

/**
 * ToolPermissionPolicy：域级别的工具权限策略。
 *
 * 与 PermissionRuleFn（资源级、同步、只能放行）不同：
 * - 工作在工具调用粒度（matches 决定是否处理该 toolCall）
 * - 支持 async（可加载数据做 scope 校验，如客户归属）
 * - 可以返回明确的 deny（带 code 和 message）
 *
 * 使用场景：dealer 的 customer scope 校验、sales_report 的部门隔离等。
 */
export interface ToolPermissionPolicy {
  /** 策略名（用于日志和 PermissionDecision.policy） */
  name: string;
  /** 是否处理该 toolCall。返回 false 时跳过 authorize。 */
  matches(input: ToolPermissionPolicyInput): boolean;
  /**
   * 授权判断。
   * 返回 PermissionDecision 表示给出最终决定（无论 allow 或 deny），停止后续策略。
   * 返回 null 表示此策略不下结论，继续检查下一条策略。
   */
  authorize(input: ToolPermissionPolicyInput): Promise<PermissionDecision | null>;
}
