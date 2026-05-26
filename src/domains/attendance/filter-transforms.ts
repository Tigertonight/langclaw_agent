/**
 * Attendance 域 Filter Transform 注册表。
 *
 * 从 IntentQueryHandler.applyMappingTransform 中迁出的 attendance 特有 transform 逻辑。
 * 通过 DomainPack.filterTransforms 声明式注册，运行时由 IntentQueryHandler 动态查找。
 */

import type { FilterTransformFn } from "../types.js";
import type { QueryFilter } from "../../types/agent-contracts.js";

/**
 * leave_department_aliases: 将部门名称映射为实际组织架构中的部门列表。
 */
const leaveDepartmentAliases: FilterTransformFn = (value) => {
  const text = String(value ?? "").trim();
  if (/销售部/.test(text)) return ["展厅销售组", "华东销售部", "华南销售部"];
  if (/人事部|人力资源|行政人事/.test(text)) return ["人力资源部"];
  return text ? [text] : null;
};

/**
 * infer_leave_type: 从用户消息中推断请假类型。
 */
const inferLeaveType: FilterTransformFn = (value, ctx) => {
  const input = String(value ?? ctx?.message ?? "");
  if (/年假/.test(input)) return "年假";
  if (/病假/.test(input)) return "病假";
  if (/事假/.test(input)) return "事假";
  if (/调休/.test(input)) return "调休";
  return null;
};

/**
 * leave_scope: 根据用户消息和权限推断请假查询范围，生成对应的过滤条件。
 */
const leaveScope: FilterTransformFn = (value, ctx) => {
  const text = String(ctx?.message ?? "");
  const scope = String(value ?? "");
  const user = ctx?.user;

  const selfScope = scope === "self" || /(我|我的|本人)/.test(text);
  const companyScope = scope === "company" || /(全公司|整个公司|公司全员|所有员工|全部员工|公司最近)/.test(text);
  const teamScope = scope === "team" || /(同学|下属|下级|下辖|团队|组员|成员)/.test(text);
  const peopleScope = /(谁|哪些人|哪几个人|哪位|哪些员工)/.test(text);

  if ((companyScope || peopleScope) && user?.permissions?.includes("org:read")) {
    const filters: QueryFilter[] = [{ field: "applicant_user_id", op: "in", value: "__ALL_ORG_USERS__" }];
    if (companyScope) {
      filters.push({ field: "department", op: "in", value: ["华东销售部", "华南销售部", "人力资源部"] });
    }
    return filters;
  }
  if (teamScope && user?.permissions?.includes("org:read")) {
    return { field: "applicant_user_id", op: "in", value: "__CURRENT_USER_REPORTS__" };
  }
  if (selfScope) return { field: "applicant_user_id", op: "eq", value: "__CURRENT_USER__" };
  if (user?.permissions?.includes("org:read")) {
    return { field: "applicant_user_id", op: "in", value: "__ALL_ORG_USERS__" };
  }
  return { field: "applicant_user_id", op: "eq", value: "__CURRENT_USER__" };
};

/**
 * Attendance 域所有 filter transforms。
 */
export const ATTENDANCE_FILTER_TRANSFORMS: Record<string, FilterTransformFn> = {
  leave_department_aliases: leaveDepartmentAliases,
  infer_leave_type: inferLeaveType,
  leave_scope: leaveScope,
};
