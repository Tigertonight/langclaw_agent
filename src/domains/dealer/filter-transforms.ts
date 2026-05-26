/**
 * Dealer 域 Filter Transform 注册表。
 *
 * 从 IntentQueryHandler.applyMappingTransform 中迁出的 dealer 特有 transform 逻辑。
 * 通过 DomainPack.filterTransforms 声明式注册，运行时由 IntentQueryHandler 动态查找。
 */

import type { FilterTransformFn } from "../types.js";

/**
 * clean_fault_category: 清理三包故障类别文本（去掉"故障类别"/"故障"后缀）。
 */
const cleanFaultCategory: FilterTransformFn = (value) => {
  return String(value ?? "").replace(/故障类别|故障$/u, "").trim();
};

/**
 * normalize_finance_direction: 将用户口语化的财务方向归一化为标准值。
 */
const normalizeFinanceDirection: FilterTransformFn = (value) => {
  const text = String(value ?? "").trim();
  if (/付款|支付|付了|扣款|抵扣|支出|支款/.test(text)) return "出账";
  if (/收款|到账|收到/.test(text)) return "收款";
  return text;
};

/**
 * overdue_repair_filters: 当 overdue=true 时生成逾期维修工单的复合过滤条件。
 */
const overdueRepairFilters: FilterTransformFn = (value) => {
  if (value !== true) return null;
  const today = new Date().toISOString().slice(0, 10);
  return [
    { field: "promised_finish_at", op: "lte", value: today },
    { field: "status", op: "neq", value: "已交付" },
  ];
};

/**
 * Dealer 域所有 filter transforms。
 */
export const DEALER_FILTER_TRANSFORMS: Record<string, FilterTransformFn> = {
  clean_fault_category: cleanFaultCategory,
  normalize_finance_direction: normalizeFinanceDirection,
  overdue_repair_filters: overdueRepairFilters,
};
