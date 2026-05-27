/**
 * PlanMode — Phase 4 新增
 *
 * 实现 Claude Code 风格的 read/ask/deny 权限分层：
 *
 * - allow/read：低风险读取操作，自动执行
 * - ask/confirm：中风险操作，生成 pending action 等待用户确认
 * - deny：高风险或无权限操作，直接拒绝并说明原因
 * - plan_only：Plan Mode 下只允许 route / inspect / read，不允许 write / external side effect
 *
 * PlanModeGuard 在 ToolRegistry.execute() 之前介入，
 * 根据工具元数据 + 用户权限 + 当前模式决定"执行 / 暂缓 / 拒绝"。
 *
 * PendingAction 机制：
 * - ask 级别工具触发时，生成 PendingAction 记录（写入 PendingActionStore）
 * - 返回 { ok: false, code: "confirmation_required", pending_action_id: "..." }
 * - A2UI 收到后渲染 PendingActionSurface，等待用户 confirm/cancel
 * - 用户 confirm 后调用 /api/actions/{id}/confirm，PlanModeGuard 重新执行工具
 */

import type { JsonObject, ToolMetadata, UserContext } from "../types/agent-contracts.js";
import type { ToolDescription } from "./registry.js";

export type PlanModeDecision =
  | { action: "allow" }
  | { action: "ask"; reason: string; pending_action_id?: string }
  | { action: "deny"; reason: string; code: string };

export interface PlanModeConfig {
  /** 是否启用 Plan Mode（限制为 read-only） */
  plan_only: boolean;
  /** 是否严格模式：ask 工具也直接 deny（适合自动化场景） */
  strict: boolean;
  /** 允许跳过确认的工具名（白名单） */
  auto_confirm_tools: string[];
}

const DEFAULT_PLAN_MODE_CONFIG: PlanModeConfig = {
  plan_only: false,
  strict: false,
  auto_confirm_tools: []
};

export class PlanModeGuard {
  private readonly config: PlanModeConfig;

  constructor(config: Partial<PlanModeConfig> = {}) {
    this.config = { ...DEFAULT_PLAN_MODE_CONFIG, ...config };
  }

  /**
   * evaluate() — 评估一次工具调用请求，返回"执行/暂缓/拒绝"决定。
   *
   * @param tool - 工具描述（来自 ToolRegistry.list()）
   * @param user - 当前用户
   * @param args - 工具调用参数（用于生成 pending action 描述）
   */
  evaluate(tool: ToolDescription, user?: UserContext, args?: JsonObject): PlanModeDecision {
    const riskLevel = getRiskLevel(tool.metadata);
    const hasPermission = checkPermissions(tool, user);

    // 权限不足 → deny
    if (!hasPermission) {
      return {
        action: "deny",
        reason: `工具 "${tool.name}" 需要权限 [${(tool.metadata?.required_permissions ?? []).join(", ")}]，当前用户无此权限。`,
        code: "permission_denied"
      };
    }

    // Plan Mode 下只允许 read
    if (this.config.plan_only && riskLevel !== "read" && riskLevel !== "sandboxed_compute") {
      return {
        action: "deny",
        reason: `Plan Mode 下不允许执行 "${tool.name}"（risk_level: ${riskLevel}）。仅允许读取操作。`,
        code: "plan_mode_write_blocked"
      };
    }

    // 高风险操作 → deny
    if (riskLevel === "destructive") {
      return {
        action: "deny",
        reason: `工具 "${tool.name}" 是高风险破坏性操作，已被系统拒绝。如需执行，请联系管理员配置。`,
        code: "destructive_operation_denied"
      };
    }

    // 白名单工具（auto_confirm）直接 allow
    if (this.config.auto_confirm_tools.includes(tool.name)) {
      return { action: "allow" };
    }

    // 需要确认或中风险 → ask（严格模式下 → deny）
    if (tool.metadata?.requires_confirmation === true || riskLevel === "write" || riskLevel === "sensitive_read") {
      if (this.config.strict) {
        return {
          action: "deny",
          reason: `严格模式下不允许执行需要确认的工具 "${tool.name}"。`,
          code: "strict_mode_blocked"
        };
      }
      const reason = buildAskReason(tool, args);
      return { action: "ask", reason };
    }

    return { action: "allow" };
  }

  /**
   * evaluateBatch() — 批量评估工具调用计划。
   *
   * 常用于 Plan Mode 下 agent 生成执行计划时，先检查整批工具的可执行性。
   */
  evaluateBatch(tools: Array<{ tool: ToolDescription; args?: JsonObject }>, user?: UserContext): Array<{ name: string; decision: PlanModeDecision }> {
    return tools.map(({ tool, args }) => ({
      name: tool.name,
      decision: this.evaluate(tool, user, args)
    }));
  }

  /**
   * toResult() — 将拒绝/暂缓决定转换为统一的 ToolResult 格式。
   */
  toResult(decision: PlanModeDecision, toolName: string): JsonObject | null {
    if (decision.action === "allow") return null;
    if (decision.action === "deny") {
      return {
        ok: false,
        tool: toolName,
        code: decision.code,
        error: decision.reason,
        message: decision.reason
      };
    }
    // ask
    return {
      ok: false,
      tool: toolName,
      code: "confirmation_required",
      error: decision.reason,
      message: decision.reason,
      pending_action_id: decision.pending_action_id ?? null,
      requires_confirmation: true
    };
  }
}

// ── 内部工具 ──────────────────────────────────────────────────────────────

function getRiskLevel(metadata?: ToolMetadata): string {
  return String(metadata?.risk_level ?? "read").toLowerCase();
}

function checkPermissions(tool: ToolDescription, user?: UserContext): boolean {
  const required = tool.metadata?.required_permissions ?? [];
  if (!required.length) return true;
  const userPerms = new Set(user?.permissions ?? []);
  return required.every((perm) => userPerms.has(perm) || userPerms.has("admin") || userPerms.has("*"));
}

function buildAskReason(tool: ToolDescription, args?: JsonObject): string {
  const argStr = args && Object.keys(args).length > 0
    ? `参数：${JSON.stringify(args).slice(0, 200)}`
    : "";
  const riskNote = tool.metadata?.risk_level === "sensitive_read"
    ? "（此操作涉及敏感数据）"
    : "（此操作将产生写入/外部副作用）";
  return `工具 "${tool.name}" ${riskNote}，需要您确认后才能执行。${argStr ? ` ${argStr}` : ""}`;
}
