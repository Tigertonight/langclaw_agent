/**
 * Engine Contract: Workflow
 * Stability: stable
 *
 * 工作流、Skill 映射、Cron 模板等协议。
 * DomainPack 通过此协议声明 Skill 配置和定时任务模板。
 */

import type { JsonValue } from "./base-types.js";

// ─── Skill Config ────────────────────────────────────────────────────────────

export interface DomainSkillConfig {
  id: string;
  name: string;
  description?: string;
  intentCodes?: string[];
  [key: string]: JsonValue | undefined;
}

/**
 * Skill contract enforcer：在 LLM 规划工具调用后对特定 skill 的调用进行后处理。
 */
export interface SkillContractEnforcer {
  /** 判断此 enforcer 是否处理给定的 skill */
  matchesSkill(skill: { id: string; name: string } | null | undefined): boolean;
  /** 对工具调用计划进行后处理 */
  enforce(plan: { calls: Array<{ name: string; args?: Record<string, unknown> }> }, context: { message: string; enterpriseContext?: unknown }): Promise<{ calls: Array<{ name: string; args?: Record<string, unknown> }> }>;
}

/**
 * Skill Mapping 定义。
 * 由 DomainPack 声明，用于从 intent_code 推断对应的 skill id。
 */
export interface SkillMappingDefinition {
  /** 检查 intent_code 是否匹配此映射 */
  matches(intentCode: string): boolean;
  /** 返回对应的 skill id */
  skillId: string;
}

// ─── Cron Template ───────────────────────────────────────────────────────────

/**
 * Cron 模板定义。
 * 由 DomainPack 声明，DomainRegistry 收集到 allCronTemplates。
 */
export interface CronTemplateDefinition {
  id: string;
  name: string;
  description: string;
  cron_expr: string;
  task: string;
  domain: string;
  allowed_tools: string[];
  max_steps: number;
  tags: string[];
}
