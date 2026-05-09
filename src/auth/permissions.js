import { loadJson } from "../data/load-json.js";

let customersCache;

async function getCustomerByName(customerName) {
  if (!customerName) return null;
  if (!customersCache) {
    customersCache = await loadJson("data/customers.json");
  }
  return customersCache.find((customer) => customer.name === customerName) ?? null;
}

function hasPermission(user, permission) {
  return user.permissions.includes(permission);
}

export async function checkToolPermission(user, toolCall) {
  if (user.role === "anonymous") {
    return deny("unknown_user", "请先登录后再查询企业数据。");
  }

  if (toolCall.name === "search_knowledge_base") {
    return allow();
  }

  if (toolCall.name === "list_my_customers") {
    if (hasPermission(user, "customer:read")) {
      return allow();
    }
    return deny("missing_permission", "你没有权限查询客户列表。");
  }

  if (toolCall.name === "query_business_data") {
    const resource = toolCall.args.resource;
    if (resource === "customers") {
      if (!hasPermission(user, "customer:read")) {
        return deny("missing_permission", "你没有权限查询客户数据。");
      }
      const customerName = getFilterValue(toolCall.args.filters, "name");
      if (!customerName) return allow();
      const customer = await getCustomerByName(customerName);
      if (!customer) return allow();
      if (user.accessible_customer_ids.includes(customer.id)) return allow();
      return deny("customer_scope_denied", `你没有权限查看客户「${customer.name}」的数据。`);
    }

    if (resource === "orders") {
      if (!hasPermission(user, "order:read")) {
        return deny("missing_permission", "你没有权限查询订单数据。");
      }
      const customerName = getFilterValue(toolCall.args.filters, "customer_name");
      if (!customerName) return allow();
      const customer = await getCustomerByName(customerName);
      if (!customer) return allow();
      if (user.accessible_customer_ids.includes(customer.id)) return allow();
      return deny("customer_scope_denied", `你没有权限查看客户「${customer.name}」的数据。`);
    }

    if (resource === "sales_reports") {
      if (!hasPermission(user, "sales_report:read")) {
        return deny("missing_permission", "你没有权限查看销售报表。");
      }
      const requestedDepartment = getFilterValue(toolCall.args.filters, "department") ?? user.department;
      if (user.role === "manager" && requestedDepartment === user.department) {
        return allow();
      }
      return deny("department_scope_denied", "你只能查看自己部门的销售报表。");
    }

    if (resource === "employees" || resource === "departments") {
      if (hasPermission(user, "org:read") || user.role !== "anonymous") {
        return allow();
      }
      return deny("missing_permission", "你没有权限查询组织架构或人员汇报关系。");
    }

    if (resource === "leave_requests") {
      const leaveScope = getLeaveRequestScope(toolCall.args.filters);
      if ((leaveScope === "team" || leaveScope === "company" || leaveScope === "other") && !hasPermission(user, "org:read")) {
        return deny("missing_permission", "你没有权限查看团队成员的请假记录。");
      }
      if (hasPermission(user, "leave:submit") || hasPermission(user, "leave:read")) {
        return allow();
      }
      return deny("missing_permission", "你没有权限查看请假记录。");
    }

    return deny("invalid_resource", "不支持该业务资源。");
  }

  if (toolCall.name === "query_customer" || toolCall.name === "query_order") {
    if (!hasPermission(user, "customer:read") && !hasPermission(user, "order:read")) {
      return deny("missing_permission", "你没有权限查询客户或订单数据。");
    }

    const customer = await getCustomerByName(toolCall.args.customer_name);
    if (!customer) {
      return allow();
    }

    if (user.accessible_customer_ids.includes(customer.id)) {
      return allow();
    }

    return deny("customer_scope_denied", `你没有权限查看客户「${customer.name}」的数据。`);
  }

  if (toolCall.name === "query_sales_report") {
    if (!hasPermission(user, "sales_report:read")) {
      return deny("missing_permission", "你没有权限查看销售报表。");
    }
    const requestedDepartment = toolCall.args.department ?? user.department;
    if (user.role === "manager" && requestedDepartment === user.department) {
      return allow();
    }
    return deny("department_scope_denied", "你只能查看自己部门的销售报表。");
  }

  if (toolCall.name === "submit_leave_request") {
    if (hasPermission(user, "leave:submit")) {
      return allow();
    }
    return deny("missing_permission", "你没有权限提交请假申请。");
  }

  return deny("unknown_tool", `工具 ${toolCall.name} 不在允许列表中。`);
}

export function filterKnowledgeByPermission(user, chunk) {
  const audience = chunk.metadata.audience ?? "all";
  if (audience === "all") return true;
  if (audience === "sales") return ["sales", "manager"].includes(user.role);
  if (audience === "hr") return ["hr"].includes(user.role);
  if (audience === "manager") return user.role === "manager";
  return false;
}

function allow() {
  return { allow: true };
}

function deny(code, message) {
  return { allow: false, code, message };
}

function getFilterValue(filters = [], field) {
  const filter = normalizeFilters(filters).find((item) => item.field === field && ["eq", "contains"].includes(item.op));
  return filter?.value ?? null;
}

function getLeaveRequestScope(filters = []) {
  filters = normalizeFilters(filters);
  const applicantFilter = filters.find((item) => item.field === "applicant_user_id");
  if (filters.some((item) => item.field === "applicant_name")) return "other";
  if (filters.some((item) => item.field === "department")) return "other";
  if (!applicantFilter) return "self";
  if (applicantFilter.value === "__CURRENT_USER__") return "self";
  if (applicantFilter.value === "__CURRENT_USER_SUBORDINATES__" || applicantFilter.value === "__CURRENT_USER_REPORTS__") return "team";
  if (applicantFilter.value === "__ALL_ORG_USERS__") return "company";
  return "other";
}

function normalizeFilters(filters = []) {
  if (!Array.isArray(filters)) return [];
  return filters.map((item) => ({
    ...item,
    op: item.op ?? item.operator
  }));
}
