import { readFileSync } from "node:fs";
import { resolveProjectPath } from "../../data/load-json.js";
import type {
  AnswerPostProcessInput,
  DomainQueryAdapter,
  FiltersInput,
  SortInput
} from "../types.js";
import type { QueryFilter, QueryIR, QuerySort, UserContext } from "../../types/agent-contracts.js";
import { createQueryIR } from "../../query/query-ir.js";
import { CORE_QUERY_CONFIG, matchesAny } from "./query-config.js";

type DataRow = Record<string, unknown>;

interface DepartmentNode extends DataRow {
  id: number;
  name: string;
  parentid: number;
}

interface EmployeeRow extends DataRow {
  userid: string;
  name: string;
  department_name?: string;
  position?: string;
  direct_leader?: string[];
  main_department?: number;
}

const BUSINESS_RESOURCES = new Set<string>(CORE_QUERY_CONFIG.resources);

export const CORE_QUERY_ADAPTER: DomainQueryAdapter = {
  domain: "core",
  supports(input) {
    return BUSINESS_RESOURCES.has(input.resource) || String(input.intentCode ?? "").startsWith("business.") || String(input.intentCode ?? "").startsWith("org.");
  },

  isRelevantQuestion(question: string): boolean {
    // 销售报表
    if (isSalesReportQuestion(question)) return true;
    // 订单
    if (isOrderQuestion(question)) return true;
    // 客户
    if (isCustomerQuestion(question)) return true;
    // 组织/员工
    if (isOrgQuestion(question)) return true;
    return false;
  },

  parseQuery(input: { question: string; operation: string; forcedTarget?: string; user?: UserContext }): QueryIR | null {
    const { question, operation } = input;
    const user = input.user;

    // 销售报表查询
    if (isSalesReportQuestion(question)) {
      return createQueryIR({
        domain: "sales",
        target: "sales_reports",
        operation: "search",
        filters: [
          { field: "department", op: "eq", value: extractSalesReportDepartment(question, user) },
          { field: "period", op: "eq", value: extractPeriod(question) ?? "2026Q2" }
        ],
        limit: 1,
        reason: "用户查询销售报表或 pipeline。"
      });
    }

    // 订单查询
    if (isOrderQuestion(question)) {
      const customer = findMentionedCustomer(question);
      if (!customer) {
        return createQueryIR({
          domain: "sales",
          target: "orders",
          operation: "search",
          needsClarification: "你想查询哪个客户的订单状态？",
          reason: "订单状态查询缺少客户实体。"
        });
      }
      return createQueryIR({
        domain: "sales",
        target: "orders",
        operation: "search",
        entity: { type: "customer", id: "", name: customer.name },
        filters: [{ field: "customer_name", op: "eq", value: customer.name }],
        limit: 1,
        reason: "用户查询客户订单状态。"
      });
    }

    // 组织/员工查询
    if (isOrgQuestion(question)) {
      return parseOrganizationQuery(question, operation, user);
    }

    // 客户查询
    if (isCustomerQuestion(question)) {
      return parseCustomerQuery(question, operation);
    }

    return null;
  },

  buildFilters(input: FiltersInput): QueryFilter[] | null {
    const message = String(input.message ?? "");
    if (input.resource === "orders") return buildOrderFilters(message);
    if (input.resource === "sales_reports") return buildSalesReportFilters(message, input.user);
    if (input.resource === "employees") return buildEmployeeFilters(message, input.user);
    if (input.resource === "departments") return buildDepartmentFilters(message);
    return null;
  },

  buildSort(input: SortInput): QuerySort[] | null {
    if (input.resource === "orders") return [...CORE_QUERY_CONFIG.sort.orders];
    if (input.resource === "departments") return [...CORE_QUERY_CONFIG.sort.departments];
    if (input.resource === "employees") return [...CORE_QUERY_CONFIG.sort.employees];
    return null;
  },

  postProcessAnswer(input: AnswerPostProcessInput): string {
    const resource = input.manifest.tool_binding?.resource;
    if (resource === "employees") return renderEmployeeAnswer(input);
    if (resource === "departments") return renderDepartmentAnswer();
    if (resource === "sales_reports") return appendRawSalesReportMetrics(input);
    return input.answer;
  },
};

// ── 资源检测（从 query-parser.ts 迁移） ──────────────────────────────────────

function isSalesReportQuestion(question: string): boolean {
  const keywords = ["成交额", "销售额", "报表", "pipeline", "业绩"];
  return keywords.some((word) => question.includes(word));
}

function isOrderQuestion(question: string): boolean {
  const keywords = ["订单", "发货", "交付", "状态"];
  return keywords.some((word) => question.includes(word));
}

function isCustomerQuestion(question: string): boolean {
  const keywords = ["客户", "等级", "行业", "签单", "续签", "跟进", "名下"];
  return keywords.some((word) => question.includes(word))
    || /(我|自己).{0,4}负责/.test(question);
}

function isOrgQuestion(question: string): boolean {
  const keywords = ["组织", "组织架构", "部门", "部有", "上级", "下级", "下属", "下辖", "下面", "团队", "同学", "汇报", "直属", "领导", "主管", "岗位", "员工", "人员", "多少人", "负责人", "我们店", "门店"];
  return keywords.some((word) => question.includes(word));
}

// ── 组织查询解析（从 query-parser.ts 迁移） ──────────────────────────────────

function parseOrganizationQuery(question: string, operation: string, user?: UserContext): QueryIR {
  if (isStoreLeaderQuestion(question)) {
    return createQueryIR({
      domain: "organization",
      target: "departments",
      operation: "search",
      entity: { type: "department", id: "1", name: "门店管理层" },
      filters: [{ field: "id", op: "eq", value: 1 }],
      limit: 1,
      reason: "用户查询当前门店负责人。"
    });
  }

  const department = findDepartmentByAlias(question);
  if (department && isDepartmentLeaderQuestion(question)) {
    return createQueryIR({
      domain: "organization",
      target: "departments",
      operation: "search",
      entity: { type: "department", id: String(department.id), name: department.name },
      filters: [{ field: "id", op: "eq", value: department.id }],
      limit: 1,
      reason: "用户查询部门负责人。"
    });
  }

  const wecom = user?.wecom && typeof user.wecom === "object" && !Array.isArray(user.wecom) ? user.wecom as Record<string, unknown> : {};
  const wecomDepartment = Array.isArray(wecom.department) ? wecom.department : [];
  const currentDepartmentId = user?.main_department ?? user?.department_id ?? wecom.main_department ?? wecomDepartment[0];
  if (isCurrentDepartmentLeaderQuestion(question) && currentDepartmentId) {
    return createQueryIR({
      domain: "organization",
      target: "departments",
      operation: "search",
      entity: { type: "department", id: String(currentDepartmentId), name: user?.department },
      filters: [{ field: "id", op: "eq", value: currentDepartmentId }],
      limit: 1,
      reason: "用户查询当前所在部门负责人。"
    });
  }

  if (isFirstLevelDepartmentQuestion(question)) {
    return createQueryIR({
      domain: "organization",
      target: "departments",
      operation: "search",
      filters: [{ field: "parentid", op: "eq", value: 1 }],
      limit: 100,
      reason: "用户查询门店一级部门。"
    });
  }

  if (department && (isPeopleCountQuestion(question) || isDepartmentPeopleQuestion(question))) {
    return createQueryIR({
      domain: "organization",
      target: "employees",
      operation,
      entity: {
        type: "department",
        id: String(department.id),
        name: department.name,
        include_children: true
      },
      filters: [{ field: "department", op: "in_department_tree", value: department.id }],
      metrics: operation === "aggregate" ? [{ type: "count", field: "userid", as: "employee_count" }] : [],
      limit: 100,
      reason: "用户按部门查询员工或人数。"
    });
  }

  if (isDepartmentListQuestion(question)) {
    return createQueryIR({
      domain: "organization",
      target: "departments",
      operation,
      metrics: operation === "aggregate" ? [{ type: "count", field: "id", as: "department_count" }] : [],
      limit: 100,
      reason: "用户查询组织架构或部门列表。"
    });
  }

  if (isLeaderQuestion(question) || (question.includes("我") && !isSubordinateQuestion(question))) {
    const filters: QueryFilter[] = [];
    if (!question.includes("我")) {
      // 查询特定人
      const employees = loadEmployees();
      const named = employees.find((e) => question.includes(e.name));
      if (named) filters.push({ field: "name", op: "eq", value: named.name });
    }
    if (filters.length === 0) filters.push({ field: "userid", op: "eq", value: "__CURRENT_USER__" });
    return createQueryIR({
      domain: "organization",
      target: "employees",
      operation,
      filters,
      metrics: operation === "aggregate" ? [{ type: "count", field: "userid", as: "employee_count" }] : [],
      limit: 1,
      reason: "用户查询员工个人组织、岗位或上级信息。"
    });
  }

  if (isSubordinateQuestion(question)) {
    return createQueryIR({
      domain: "organization",
      target: "employees",
      operation,
      filters: [{ field: "direct_leader", op: "contains", value: "__CURRENT_USER__" }],
      metrics: operation === "aggregate" ? [{ type: "count", field: "userid", as: "employee_count" }] : [],
      limit: 50,
      reason: "用户查询当前员工下属。"
    });
  }

  return createQueryIR({
    domain: "organization",
    target: "employees",
    operation,
    metrics: operation === "aggregate" ? [{ type: "count", field: "userid", as: "employee_count" }] : [],
    limit: 50,
    reason: "用户查询组织人员数据。"
  });
}

// ── 客户查询解析（从 query-parser.ts 迁移） ──────────────────────────────────

function parseCustomerQuery(question: string, operation: string): QueryIR {
  const filters: QueryFilter[] = [];
  const customer = findMentionedCustomer(question);
  if (customer) filters.push({ field: "name", op: "eq", value: customer.name });
  if (question.includes("科技")) filters.push({ field: "industry_category", op: "eq", value: "科技" });
  if (question.includes("制造")) filters.push({ field: "industry_category", op: "eq", value: "制造" });
  if (question.includes("零售")) filters.push({ field: "industry_category", op: "eq", value: "零售" });
  if (question.includes("物流")) filters.push({ field: "industry_category", op: "eq", value: "物流" });
  if (question.includes("未签单")) filters.push({ field: "deal_status", op: "eq", value: "未签单" });
  if (question.includes("已签单")) filters.push({ field: "deal_status", op: "eq", value: "已签单" });
  if (question.includes("跟进")) filters.push({ field: "follow_status", op: "contains", value: "跟进" });
  if (question.includes("待续签")) filters.push({ field: "renewal_status", op: "eq", value: "待续签" });

  return createQueryIR({
    domain: "sales",
    target: "customers",
    operation,
    entity: customer ? { type: "customer", id: "", name: customer.name } : undefined,
    filters,
    metrics: operation === "aggregate" ? [{ type: "count", field: "id", as: "customer_count" }] : [],
    limit: 20,
    reason: "用户查询客户数据。"
  });
}

// ── 辅助函数（从 query-parser.ts 迁移） ──────────────────────────────────────

function extractSalesReportDepartment(question: string, user?: UserContext): string | undefined {
  // 从数据文件动态获取部门列表，替代硬编码
  const reports = loadJsonRows("data/sales_reports.json");
  const departments = [...new Set(reports.map((r) => String(r.department ?? "")).filter(Boolean))];
  return departments.find((dept) => question.includes(dept)) ?? user?.department;
}

function extractPeriod(question: string): string | null {
  if (question.includes("今年") || question.includes("本年")) return "2026Q2";
  if (question.includes("Q2") || question.includes("二季度")) return "2026Q2";
  return null;
}

function isStoreLeaderQuestion(question: string): boolean {
  return /(我们店|门店|店里|店).{0,8}(负责人|主管|经理|总经理|谁负责|谁管)|(?:负责人|主管|经理|总经理).{0,8}(我们店|门店|店里|店)/i.test(question);
}

function isDepartmentLeaderQuestion(question: string): boolean {
  return /(负责人|主管|经理|leader|谁负责)/i.test(question);
}

function isCurrentDepartmentLeaderQuestion(question: string): boolean {
  return /(我们|咱们|本|当前|我所在|我的).{0,4}部门.{0,8}(负责人|主管|经理|谁负责|谁管)|(?:负责人|主管|经理).{0,8}(我们|咱们|本|当前|我所在|我的).{0,4}部门/i.test(question);
}

function isFirstLevelDepartmentQuestion(question: string): boolean {
  return /(1级|一级|一层|第一层).{0,6}(部门|组织)|(?:部门|组织).{0,6}(1级|一级|一层|第一层)/i.test(question);
}

function isDepartmentListQuestion(question: string): boolean {
  return ["组织架构", "部门结构", "部门列表", "有哪些部门"].some((word) => question.includes(word));
}

function isDepartmentPeopleQuestion(question: string): boolean {
  return /(有哪些|哪些人|都有谁|都谁|谁在|人员|员工|同学|名单|列表)/.test(question);
}

function isPeopleCountQuestion(question: string): boolean {
  return /(多少人|几个人|几名|人数|员工数|人员数|多少个员工|有多少.*(人|员工|同学))/.test(question);
}

function isLeaderQuestion(question: string): boolean {
  return ["上级", "汇报", "直属", "领导", "主管"].some((word) => question.includes(word));
}

function isSubordinateQuestion(question: string): boolean {
  return ["下属", "下级", "下辖", "下面", "团队", "同学"].some((word) => question.includes(word));
}

// ── 原有的 buildFilters / postProcessAnswer 辅助函数 ─────────────────────────

function buildOrderFilters(message: string): QueryFilter[] {
  const customer = findMentionedCustomer(message);
  return customer ? [{ field: "customer_name", op: "contains", value: customer.name as string }] : [];
}

function buildSalesReportFilters(message: string, user?: UserContext): QueryFilter[] {
  const department = findMentionedSalesDepartment(message) ?? user?.department;
  return department ? [{ field: "department", op: "eq", value: department }] : [];
}

function buildDepartmentFilters(message: string): QueryFilter[] {
  const department = findDepartmentByAlias(message);
  return department ? [{ field: "id", op: "eq", value: department.id }] : [];
}

function buildEmployeeFilters(message: string, user?: UserContext): QueryFilter[] {
  const employees = loadEmployees();
  const named = employees.find((employee) => message.includes(employee.name));
  if (named) return [{ field: "name", op: "contains", value: named.name }];

  const department = findDepartmentByAlias(message);
  if (department) {
    return [{ field: "main_department", op: "in", value: departmentAndChildren(department.id).map((item) => item.id) }];
  }

  if (matchesAny(message, CORE_QUERY_CONFIG.relations.reportPatterns) && user?.id) {
    return [{ field: "direct_leader", op: "eq", value: user.id }];
  }

  if (matchesAny(message, CORE_QUERY_CONFIG.relations.selfLeaderPatterns) && user?.id) {
    return [{ field: "userid", op: "eq", value: user.id }];
  }

  return [];
}

function renderEmployeeAnswer(input: AnswerPostProcessInput): string {
  const message = String(input.message ?? "");
  const user = input.user;
  const employees = loadEmployees();

  const department = findDepartmentByAlias(message);
  if (department) {
    const ids = new Set(departmentAndChildren(department.id).map((item) => item.id));
    const members = employees.filter((employee) => ids.has(Number(employee.main_department)));
    return `${department.name}有 ${members.length} 名员工（${members.length} 人）：${members.map((employee) => employee.name).join("、")}。`;
  }

  const named = employees.find((employee) => message.includes(employee.name));
  if (named) return renderEmployeeProfile(named, employees);

  if (matchesAny(message, CORE_QUERY_CONFIG.relations.leaderPatterns) && matchesAny(message, CORE_QUERY_CONFIG.relations.reportPatterns) && user?.id) {
    const current = employees.find((employee) => employee.userid === user.id);
    if (!current) return input.answer;
    const leaders = resolveLeaders(current, employees);
    const reports = directReports(current.userid, employees);
    return `${current.name}的直属上级是${formatEmployees(leaders)}；直属下级包括${formatEmployees(reports)}。`;
  }

  if (matchesAny(message, CORE_QUERY_CONFIG.relations.reportPatterns) && user?.id) {
    const reports = directReports(user.id, employees);
    return `你的直属下属包括${formatEmployees(reports)}。`;
  }

  if (matchesAny(message, CORE_QUERY_CONFIG.relations.selfLeaderPatterns) && user?.id) {
    const current = employees.find((employee) => employee.userid === user.id);
    if (!current) return input.answer;
    const leaders = resolveLeaders(current, employees);
    return `${current.name}的直属上级是${formatEmployees(leaders)}。`;
  }

  return input.answer;
}

function renderDepartmentAnswer(): string {
  const departments = loadDepartments();
  return `组织节点包括：${departments.map((department) => department.name).join("、")}。`;
}

function appendRawSalesReportMetrics(input: AnswerPostProcessInput): string {
  const row = input.rows[0];
  if (!row) return input.answer;
  const revenue = row.revenue;
  const pipeline = row.pipeline;
  if (revenue === undefined && pipeline === undefined) return input.answer;
  const raw = [
    revenue !== undefined ? `销售额 ${revenue}` : null,
    pipeline !== undefined ? `Pipeline ${pipeline}` : null,
  ].filter(Boolean).join("，");
  return input.answer.includes(String(revenue)) && input.answer.includes(String(pipeline))
    ? input.answer
    : `${input.answer}\n\n原始数值：${raw}。`;
}

function renderEmployeeProfile(employee: EmployeeRow, employees: EmployeeRow[]): string {
  const leaders = resolveLeaders(employee, employees);
  const leaderText = leaders.length ? formatEmployees(leaders) : "暂无明确记录";
  return `${employee.name}所属组织是${employee.department_name ?? "未记录"}，岗位是${employee.position ?? "未记录"}，直属上级是${leaderText}。`;
}

function resolveLeaders(employee: EmployeeRow, employees: EmployeeRow[]): EmployeeRow[] {
  const ids = Array.isArray(employee.direct_leader) ? employee.direct_leader : [];
  return ids
    .map((id) => employees.find((item) => item.userid === id))
    .filter((item): item is EmployeeRow => Boolean(item));
}

function directReports(userId: string, employees: EmployeeRow[]): EmployeeRow[] {
  return employees.filter((employee) => Array.isArray(employee.direct_leader) && employee.direct_leader.includes(userId));
}

function formatEmployees(employees: EmployeeRow[]): string {
  if (!employees.length) return "暂无明确记录";
  return employees.map((employee) => `${employee.name}${employee.position ? `（${employee.position}）` : ""}`).join("、");
}

function findMentionedCustomer(message: string): { name: string } | null {
  const matched = loadJsonRows("data/customers.json").find((customer) => message.includes(String(customer.name ?? "")));
  return matched ? { name: String(matched.name ?? "") } : null;
}

function findMentionedSalesDepartment(message: string): string | null {
  const reports = loadJsonRows("data/sales_reports.json");
  const matched = reports.find((row) => message.includes(String(row.department ?? "")));
  return matched ? String(matched.department) : null;
}

function findDepartmentByAlias(message: string): DepartmentNode | null {
  const departments = loadDepartments();
  const explicit = departments.find((department) => message.includes(department.name));
  if (explicit) return explicit;
  const alias = CORE_QUERY_CONFIG.departments.aliases.find((item) => matchesAny(message, item.patterns));
  if (alias) return departments.find((department) => department.name === alias.departmentName) ?? null;
  return null;
}

function departmentAndChildren(rootId: number): DepartmentNode[] {
  const departments = loadDepartments();
  const result: DepartmentNode[] = [];
  const queue = [rootId];
  while (queue.length) {
    const id = queue.shift()!;
    const node = departments.find((department) => department.id === id);
    if (node) result.push(node);
    queue.push(...departments.filter((department) => department.parentid === id).map((department) => department.id));
  }
  return result;
}

function loadEmployees(): EmployeeRow[] {
  return loadJsonRows("data/wecom-users.json") as EmployeeRow[];
}

function loadDepartments(): DepartmentNode[] {
  return loadJsonRows("data/wecom-departments.json") as DepartmentNode[];
}

function loadJsonRows(file: string): DataRow[] {
  return JSON.parse(readFileSync(resolveProjectPath(file), "utf8")) as DataRow[];
}
