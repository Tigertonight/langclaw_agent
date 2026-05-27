/**
 * retail-demo DomainPack：零售门店 toy domain。
 *
 * 设计约束（Milestone 2.5 验证目标）：
 * 1. 纯声明式 —— 禁止使用 register() 逃生口
 * 2. 不修改任何核心代码 —— 新增文件即可接入
 * 3. 验证 DomainPack 接口的表达力是否足够覆盖一个完整业务域
 *
 * 支持的业务场景：
 * - "查询门店销量" → retail.query.sales → query_business_data(retail_sales)
 * - "查询库存告警" → retail.query.inventory_alerts → query_business_data(retail_inventory_alerts)
 */

import type { DomainPack } from "../types.js";
import { RETAIL_DETERMINISTIC_RULES } from "./deterministic-rules.js";
import { RETAIL_COMMANDS } from "./commands.js";
import { RETAIL_RESOURCES, RETAIL_FIELD_LABELS } from "./resources.js";

/**
 * retail-demo DomainPack 实例。
 *
 * 注意：没有 init()、register()、dispose() —— 纯声明式。
 */
export const retailDemoPack: DomainPack = {
  id: "retail-demo",
  name: "零售门店（演示）",
  version: "0.1.0",
  conflictPolicy: "error",
  description: "零售门店 toy domain，用于验证 DomainPack 声明式架构的解耦能力。支持门店销量查询和库存告警查询。",

  // 无依赖
  dependencies: [],
  optionalDependencies: [],

  // ── 声明式配置 ──────────────────────────────────────────────────────────

  // 资源定义
  resources: RETAIL_RESOURCES,

  // 确定性路由规则
  deterministicRules: RETAIL_DETERMINISTIC_RULES,

  // 斜杠命令
  commands: RETAIL_COMMANDS,

  // 字段标签
  fieldLabels: RETAIL_FIELD_LABELS,

  // 意图清单从域专属目录加载
  intentDir: "data/domains/retail-demo/intent-codes",

  // 无自定义工具（复用 query_business_data）
  tools: [],

  // 无 Surface builder（M5）
  surfaces: [],

  // 无 Catalog domain（M5）
  catalogDomains: [],

  // 无 Query Adapter（M4）
  queryAdapters: [],

  // 无 Skill
  skills: [],

  // ── 生命周期钩子 ────────────────────────────────────────────────────────
  // 全部留空 —— 纯声明式验证
};
