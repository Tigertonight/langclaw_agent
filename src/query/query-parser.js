import { resolveEntities } from "./entity-resolver.js";
import { createQueryIR } from "./query-ir.js";

export async function parseBusinessQuery({ user, question, history = [], conversationContext }) {
  const entities = await resolveEntities(question, history);
  const operation = inferOperation(question);

  if (isContextContinuationForTarget(conversationContext, "leave_requests") || isLeaveRecordQuestion(question)) {
    return parseLeaveRecordQuery({ user, question, operation, entities });
  }

  if (isSalesReportQuestion(question) && !entities.customer) {
    return createQueryIR({
      domain: "sales",
      target: "sales_reports",
      operation: "search",
      filters: [
        { field: "department", op: "eq", value: extractSalesReportDepartment({ user, question }) },
        { field: "period", op: "eq", value: extractPeriod(question) ?? "2026Q2" }
      ],
      limit: 1,
      reason: "用户查询销售报表或 pipeline。"
    });
  }

  if (isOrderQuestion(question)) {
    if (!entities.customer) {
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
      entity: entities.customer,
      filters: [{ field: "customer_name", op: "eq", value: entities.customer.name }],
      limit: 1,
      reason: "用户查询客户订单状态。"
    });
  }

  if (entities.department || isOrgQuestion(question)) {
    return parseOrganizationQuery({ question, entities, operation });
  }

  if (isCustomerQuestion(question) || entities.customer || operation === "aggregate") {
    return parseCustomerQuery({ question, entities, operation });
  }

  return null;
}

export async function isBusinessDataQuestion(question) {
  const entities = await resolveEntities(question);
  return Boolean(entities.customer || entities.employee || entities.department)
    || isLeaveRecordQuestion(question)
    || isSalesReportQuestion(question)
    || isOrderQuestion(question)
    || isCustomerQuestion(question)
    || isOrgQuestion(question)
    || inferOperation(question) === "aggregate";
}

function parseOrganizationQuery({ question, entities, operation }) {
  if (entities.department && isDepartmentLeaderQuestion(question)) {
    return createQueryIR({
      domain: "organization",
      target: "departments",
      operation: "search",
      entity: entities.department,
      filters: [{ field: "id", op: "eq", value: entities.department.id }],
      limit: 1,
      reason: "用户查询部门负责人。"
    });
  }

  if (entities.department && (isPeopleCountQuestion(question) || isDepartmentPeopleQuestion(question))) {
    return createQueryIR({
      domain: "organization",
      target: "employees",
      operation,
      entity: {
        ...entities.department,
        include_children: true
      },
      filters: [{ field: "department", op: "in_department_tree", value: entities.department.id }],
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

  if (entities.employee || isLeaderQuestion(question) || (question.includes("我") && !isSubordinateQuestion(question))) {
    const filters = [];
    if (entities.employee) filters.push({ field: "name", op: "eq", value: entities.employee.name });
    if (!entities.employee) filters.push({ field: "userid", op: "eq", value: "__CURRENT_USER__" });
    return createQueryIR({
      domain: "organization",
      target: "employees",
      operation,
      entity: entities.employee,
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

function parseCustomerQuery({ question, entities, operation }) {
  const filters = [];
  if (entities.customer) filters.push({ field: "name", op: "eq", value: entities.customer.name });
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
    entity: entities.customer,
    filters,
    metrics: operation === "aggregate" ? [{ type: "count", field: "id", as: "customer_count" }] : [],
    limit: 20,
    reason: "用户查询客户数据。"
  });
}

function parseLeaveRecordQuery({ user, question, operation, entities }) {
  const filters = [];
  const selfScope = /(我|我的|本人)/.test(String(question ?? ""));
  const teamScope = /(同学|下属|下级|下辖|团队|组员|成员|谁)/.test(String(question ?? "")) && !selfScope;
  const companyScope = /(全公司|整个公司|公司全员|所有员工|全部员工)/.test(String(question ?? "")) && !selfScope;

  if (entities?.employee && user?.permissions?.includes("org:read")) {
    filters.push({ field: "applicant_name", op: "contains", value: entities.employee.name });
  } else if (companyScope && user?.permissions?.includes("org:read")) {
    filters.push({ field: "applicant_user_id", op: "in", value: "__ALL_ORG_USERS__" });
  } else if (teamScope && user?.permissions?.includes("org:read")) {
    filters.push({ field: "applicant_user_id", op: "in", value: "__CURRENT_USER_REPORTS__" });
  } else {
    filters.push({ field: "applicant_user_id", op: "eq", value: "__CURRENT_USER__" });
  }
  if (question.includes("年假")) filters.push({ field: "leave_type", op: "eq", value: "年假" });
  if (question.includes("病假")) filters.push({ field: "leave_type", op: "eq", value: "病假" });
  if (question.includes("事假")) filters.push({ field: "leave_type", op: "eq", value: "事假" });
  if (question.includes("调休")) filters.push({ field: "leave_type", op: "eq", value: "调休" });
  const monthToken = extractMonthToken(question);
  if (monthToken) filters.push({ field: "start_time", op: "contains", value: monthToken });
  const recentStart = extractRecentStartDate(question);
  if (recentStart) {
    filters.push({ field: "start_time", op: "gte", value: recentStart });
    filters.push({ field: "start_time", op: "lte", value: formatDate(new Date()) });
  }

  return createQueryIR({
    domain: "attendance",
    target: "leave_requests",
    operation,
    filters,
    metrics: operation === "aggregate" ? [{ type: "count", field: "id", as: "leave_request_count" }] : [],
    sort: [{ field: "start_time", direction: "desc" }],
    limit: 20,
    reason: entities?.employee
      ? "用户查询指定员工的请假记录。"
      : companyScope ? "用户查询组织范围内的请假记录。"
        : teamScope ? "用户查询汇报链员工的请假记录。" : "用户查询本人请假记录。"
  });
}

function isContextContinuationForTarget(context, target) {
  return context?.continuation?.is_likely_continuation === true
    && context?.last_task?.target === target;
}

function extractRecentStartDate(question) {
  const text = String(question ?? "");
  const monthsMatch = text.match(/最近\s*([一二两三四五六七八九十\d]+)\s*个?月/);
  if (!monthsMatch) return null;
  const months = parseChineseNumber(monthsMatch[1]);
  if (!months) return null;
  const date = new Date();
  date.setMonth(date.getMonth() - months);
  return formatDate(date);
}

function parseChineseNumber(token) {
  const text = String(token ?? "");
  const map = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (/^\d+$/.test(text)) return Number(text);
  if (text === "十") return 10;
  if (text.includes("十")) {
    const [left, right] = text.split("十");
    return (left ? map[left] ?? 0 : 1) * 10 + (right ? map[right] ?? 0 : 0);
  }
  return map[text] ?? null;
}

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function inferOperation(question) {
  return /(多少|几个|几次|多少次|数量|总数|统计|有多少|多少人|几个人|几名|人数)/.test(question) ? "aggregate" : "search";
}

export function isSalesReportQuestion(question) {
  return ["成交额", "销售额", "报表", "pipeline", "业绩"].some((word) => question.includes(word));
}

export function isOrderQuestion(question) {
  return ["订单", "发货", "交付", "状态"].some((word) => question.includes(word));
}

export function isCustomerQuestion(question) {
  return ["客户", "等级", "行业", "签单", "续签", "跟进", "负责", "名下"].some((word) => question.includes(word));
}

export function isOrgQuestion(question) {
  return ["组织", "组织架构", "部门", "部有", "上级", "下级", "下属", "下辖", "下面", "团队", "同学", "汇报", "直属", "领导", "主管", "岗位", "员工", "人员", "多少人"].some((word) => question.includes(word));
}

export function isLeaveRecordQuestion(question) {
  const text = String(question ?? "");
  const hasLeave = /(请.*假|休假|年假|病假|事假|调休)/.test(text);
  const asksRecord = /(记录|历史|明细|列表|查询|查看|查一下|统计|几次|多少次|有哪些|都有谁)/.test(text);
  const asksPeople = /(同学|下属|下级|下辖|团队|组员|成员|谁)/.test(text);
  return hasLeave && (asksRecord || asksPeople);
}

function isDepartmentListQuestion(question) {
  return ["组织架构", "部门结构", "部门列表", "有哪些部门"].some((word) => question.includes(word));
}

function isDepartmentLeaderQuestion(question) {
  return /(负责人|主管|经理|leader|谁负责)/i.test(question);
}

function isDepartmentPeopleQuestion(question) {
  return /(有哪些|哪些人|都有谁|都谁|谁在|人员|员工|同学|名单|列表)/.test(question);
}

function isPeopleCountQuestion(question) {
  return /(多少人|几个人|几名|人数|员工数|人员数|多少个员工|有多少.*(人|员工|同学))/.test(question);
}

function isLeaderQuestion(question) {
  return ["上级", "汇报", "直属", "领导", "主管"].some((word) => question.includes(word));
}

function isSubordinateQuestion(question) {
  return ["下属", "下级", "下辖", "下面", "团队", "同学"].some((word) => question.includes(word));
}

function extractSalesReportDepartment({ user, question }) {
  const departments = ["华东销售部", "华南销售部", "人力资源部", "销售部"];
  return departments.find((department) => question.includes(department)) ?? user.department;
}

function extractPeriod(question) {
  if (question.includes("今年") || question.includes("本年")) return "2026Q2";
  if (question.includes("Q2") || question.includes("二季度")) return "2026Q2";
  return null;
}

function extractMonthToken(question) {
  const explicit = String(question ?? "").match(/(\d{4}-\d{2})/);
  if (explicit) return explicit[1];
  const month = String(question ?? "").match(/(\d{1,2})月/);
  if (!month) return null;
  return `2026-${String(month[1]).padStart(2, "0")}`;
}
