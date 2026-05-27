/**
 * Attendance 域 skill contract enforcer。
 * 从 src/agent/nodes.ts 迁移而来。
 *
 * 在 LLM 规划工具调用后，对 leave-records skill 的调用进行后处理：
 * 强制添加范围过滤器（团队/全公司/部门）。
 */

import { loadJson } from "../../data/load-json.js";
import { getDepartmentTreeIds, resolveEntities } from "../../query/entity-resolver.js";
import type { SkillContractEnforcer } from "../types.js";
import type { JsonObject, JsonValue, QueryFilter } from "../../types/agent-contracts.js";

interface DepartmentScope extends JsonObject {
  id?: JsonValue;
  name?: string;
  aliases?: string[];
}

interface DepartmentRecord extends JsonObject {
  id: string | number;
  name: string;
}

interface LeaveRequestRecord extends JsonObject {
  department?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export const leaveRecordsSkillContractEnforcer: SkillContractEnforcer = {
  matchesSkill(skill) {
    if (!skill) return false;
    return ["leave-records", "leave_records"].includes(skill.id) || ["leave-records", "leave_records"].includes(skill.name);
  },

  async enforce(plan, context) {
    if (!plan?.calls?.length) return plan;
    const { message, enterpriseContext } = context;
    const department = await resolveDepartmentScope(message);
    if (!asksForTeamScope(message) && !asksForCompanyScope(message) && !department) return plan;

    return {
      ...plan,
      calls: plan.calls.map((call) => {
        if (call.name !== "query_business_data" || call.args?.resource !== "leave_requests") return call;
        let filters = asksForCompanyScope(message)
          ? enforceLeaveCompanyScope(call.args?.filters)
          : enforceLeaveTeamScope(call.args?.filters);
        if (department) filters = enforceLeaveDepartmentScope(filters, department);
        const boundedFilters = enforceRecentUpperBound(filters, { message, enterpriseContext });
        return {
          ...call,
          args: {
            ...call.args,
            filters: boundedFilters
          }
        };
      })
    };
  },
};

function asksForTeamScope(message: unknown): boolean {
  return /(下面|下属|下级|下辖|团队|组员|成员|同学)/.test(String(message ?? "")) && !/(我自己|我本人|我的请假|本人请假)/.test(String(message ?? ""));
}

function asksForCompanyScope(message: unknown): boolean {
  return /(全公司|整个公司|公司全员|所有员工|全部员工)/.test(String(message ?? ""));
}

async function resolveDepartmentScope(message: unknown): Promise<DepartmentScope | null> {
  const entities = await resolveEntities(String(message ?? ""));
  if (!entities.department) return null;
  const department: DepartmentScope = {
    id: entities.department.id,
    name: entities.department.name,
    aliases: await resolveDepartmentAliases({
      id: entities.department.id,
      name: entities.department.name
    })
  };
  return department;
}

function enforceLeaveTeamScope(filters: unknown = []): QueryFilter[] {
  return enforceLeaveApplicantScope(filters, "__CURRENT_USER_REPORTS__");
}

function enforceLeaveCompanyScope(filters: unknown = []): QueryFilter[] {
  return enforceLeaveApplicantScope(filters, "__ALL_ORG_USERS__");
}

function enforceLeaveApplicantScope(filters: unknown = [], value: string): QueryFilter[] {
  const normalized: QueryFilter[] = Array.isArray(filters)
    ? filters.filter(isObject).map((filter) => ({ ...filter, field: String(filter.field ?? ""), op: String(filter.op ?? filter.operator ?? "eq") }))
    : [];
  const existingIndex = normalized.findIndex((filter) => filter.field === "applicant_user_id");
  const scopeFilter: QueryFilter = { field: "applicant_user_id", op: "in", value };
  if (existingIndex === -1) return [scopeFilter, ...normalized];
  return normalized.map((filter, index) => (index === existingIndex ? scopeFilter : filter));
}

function enforceLeaveDepartmentScope(filters: unknown = [], department: DepartmentScope): QueryFilter[] {
  const normalized: QueryFilter[] = Array.isArray(filters)
    ? filters.filter(isObject).map((filter) => ({ ...filter, field: String(filter.field ?? ""), op: String(filter.op ?? filter.operator ?? "eq") }))
    : [];
  const withoutSelfScope = normalized.filter((filter) => (
    !(filter.field === "applicant_user_id" && isRuntimeApplicantScope(filter.value))
  ));
  if (withoutSelfScope.some((filter) => filter.field === "department")) return withoutSelfScope;
  return [
    ...withoutSelfScope,
    { field: "department", op: "in", value: department.aliases ?? departmentAliases(department.name) }
  ];
}

function isRuntimeApplicantScope(value: unknown): boolean {
  return [
    "__CURRENT_USER__",
    "__CURRENT_USER_REPORTS__",
    "__CURRENT_USER_SUBORDINATES__",
    "__ALL_ORG_USERS__"
  ].includes(String(value));
}

function departmentAliases(name: unknown): string[] {
  const text = String(name ?? "");
  const aliases = new Set([text]);
  if (text.endsWith("部")) aliases.add(text.replace(/部$/, ""));
  if (text === "行政人事部") {
    aliases.add("人事部");
    aliases.add("人事");
    aliases.add("人力资源部");
    aliases.add("人力资源");
    aliases.add("HR部");
    aliases.add("HR");
  }
  return [...aliases].filter(Boolean);
}

async function resolveDepartmentAliases(department: DepartmentScope): Promise<string[]> {
  const aliases = new Set(departmentAliases(department.name));
  const shortName = String(department.name ?? "").replace(/部$/, "");

  const [departmentIds, departments, leaveRequests] = await Promise.all([
    getDepartmentTreeIds(department.id),
    loadJson<DepartmentRecord[]>("data/wecom-departments.json"),
    loadJson<LeaveRequestRecord[]>("data/leave-requests.json")
  ]);

  for (const item of departments) {
    if (!departmentIds.includes(Number(item.id))) continue;
    for (const alias of departmentAliases(item.name)) aliases.add(alias);
  }

  for (const request of leaveRequests) {
    const value = String(request.department ?? "");
    if (!value) continue;
    if (value.includes(shortName) || shortName.includes(value.replace(/部$/, ""))) aliases.add(value);
  }

  return [...aliases].filter(Boolean);
}

function enforceRecentUpperBound(filters: QueryFilter[], { message, enterpriseContext }: { message: unknown; enterpriseContext?: unknown }): QueryFilter[] {
  if (!/最近|近三个月|三个月/.test(String(message ?? ""))) return filters;
  if (filters.some((filter) => filter.field === "start_time" && filter.op === "lte")) return filters;
  const context = isObject(enterpriseContext) ? enterpriseContext : {};
  const runtime = isObject(context.runtime) ? context.runtime : {};
  const currentDate = formatRuntimeDate(runtime.current_date);
  if (!currentDate) return filters;
  return [...filters, { field: "start_time", op: "lte", value: currentDate }];
}

function formatRuntimeDate(value: unknown): string | null {
  const text = String(value ?? "");
  if (!/^\d{8}$/.test(text)) return null;
  return `${text.slice(0, 4)}-${text.slice(4, 6)}-${text.slice(6, 8)}`;
}
