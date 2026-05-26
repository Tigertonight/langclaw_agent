import { loadJson } from "../data/load-json.js";
import { getRuntimeRegistry, getResourceDataPath } from "../domains/runtime-registry.js";
import type {
  JsonObject,
  PermissionDecision,
  QueryFilter,
  ToolCall,
  UserContext
} from "../types/agent-contracts.js";

interface CustomerRecord extends JsonObject {
  id: string;
  name: string;
}

interface PermissionPolicyInput {
  user: UserContext;
  toolCall: ToolCall;
}

interface ToolPolicy {
  name: string;
  matches(input: PermissionPolicyInput): boolean;
  authorize(input: PermissionPolicyInput): Promise<PermissionDecision | null>;
}

interface KnowledgeChunk {
  metadata?: {
    audience?: string;
  };
}

let customersCache: CustomerRecord[] | undefined;

async function getCustomerByName(customerName: string | null | undefined): Promise<CustomerRecord | null> {
  if (!customerName) return null;
  if (!customersCache) {
    customersCache = await loadJson<CustomerRecord[]>(getResourceDataPath("customers") ?? "data/customers.json");
  }
  return customersCache.find((customer) => customer.name === customerName) ?? null;
}

function hasPermission(user: UserContext | undefined, permission: string): boolean {
  return Array.isArray(user?.permissions) && user.permissions.includes(permission);
}

const TOOL_POLICIES: ToolPolicy[] = [
  {
    name: "authenticated_user",
    matches: () => true,
    authorize: async ({ user }) => user.role === "anonymous"
      ? deny("unknown_user", "请先登录后再查询企业数据。")
      : null
  },
  {
    name: "knowledge_read",
    matches: ({ toolCall }) => ["search_knowledge_base", "retrieve_knowledge"].includes(toolCall.name),
    authorize: async ({ user }) => hasPermission(user, "policy:read")
      ? allow()
      : deny("missing_permission", "你没有权限检索企业知识资料。")
  },
  {
    name: "safe_compute",
    matches: ({ toolCall }) => toolCall.name === "safe_compute",
    authorize: async () => allow()
  },
  {
    name: "runtime_tools",
    matches: ({ toolCall }) => /^(runtime|task|memory|evolution|maintenance|plugin)\./.test(toolCall.name),
    authorize: async () => allow()
  },
  {
    name: "customer_list",
    matches: ({ toolCall }) => toolCall.name === "list_my_customers",
    authorize: async ({ user }) => hasPermission(user, "customer:read")
      ? allow()
      : deny("missing_permission", "你没有权限查询客户列表。")
  },
  {
    name: "business_data",
    matches: ({ toolCall }) => toolCall.name === "query_business_data",
    authorize: authorizeBusinessData
  },
  {
    name: "customer_or_order_detail",
    matches: ({ toolCall }) => toolCall.name === "query_customer" || toolCall.name === "query_order",
    authorize: authorizeCustomerOrOrderDetail
  },
  {
    name: "sales_report",
    matches: ({ toolCall }) => toolCall.name === "query_sales_report",
    authorize: async ({ user, toolCall }) => {
      if (!hasPermission(user, "sales_report:read")) {
        return deny("missing_permission", "你没有权限查看销售报表。");
      }
      const requestedDepartment = toolCall.args?.department ?? user.department;
      if (user.role === "manager" && requestedDepartment === user.department) return allow();
      return deny("department_scope_denied", "你只能查看自己部门的销售报表。");
    }
  },
  {
    name: "domain_tool_permission",
    matches: ({ toolCall }) => {
      // 匹配所有域注册的工具（通过 metadata.required_permissions 判断）
      const meta = toolCall.metadata ?? {};
      return Array.isArray(meta.required_permissions) && meta.required_permissions.length > 0
        && !["query_business_data", "list_my_customers", "query_customer", "query_order", "query_sales_report", "search_knowledge_base", "retrieve_knowledge", "safe_compute"].includes(toolCall.name);
    },
    authorize: async ({ user, toolCall }) => {
      const requiredPerms = (toolCall.metadata?.required_permissions ?? []) as string[];
      for (const perm of requiredPerms) {
        if (!hasPermission(user, perm)) {
          return deny("missing_permission", `你没有权限执行此操作（需要 ${perm}）。`);
        }
      }
      return allow();
    }
  }
];

export async function checkToolPermission(user: UserContext, toolCall: ToolCall): Promise<PermissionDecision> {
  for (const policy of TOOL_POLICIES) {
    if (!policy.matches({ user, toolCall })) continue;
    const decision = await policy.authorize({ user, toolCall });
    if (decision) return { ...decision, policy: policy.name };
  }
  return deny("unknown_tool", `工具 ${toolCall.name} 不在允许列表中。`);
}

async function authorizeBusinessData({ user, toolCall }: PermissionPolicyInput): Promise<PermissionDecision> {
  const resource = toolCall.args?.resource;
  if (resource === "customers") return authorizeScopedCustomerData({ user, toolCall, permission: "customer:read", filterField: "name", message: "你没有权限查询客户数据。" });
  if (resource === "orders") return authorizeScopedCustomerData({ user, toolCall, permission: "order:read", filterField: "customer_name", message: "你没有权限查询订单数据。" });
  if (resource === "sales_reports") {
    if (!hasPermission(user, "sales_report:read")) return deny("missing_permission", "你没有权限查看销售报表。");
    const requestedDepartment = getFilterValue(toolCall.args?.filters, "department") ?? user.department;
    if (user.role === "manager" && requestedDepartment === user.department) return allow();
    return deny("department_scope_denied", "你只能查看自己部门的销售报表。");
  }
  if (resource === "employees" || resource === "departments") {
    if (hasPermission(user, "org:read") || user.role !== "anonymous") return allow();
    return deny("missing_permission", "你没有权限查询组织架构或人员汇报关系。");
  }
  // 通过 registry 动态查找 domain 权限规则（包括 leave_requests 等域特定资源）
  if (canReadDomainResource(user, String(resource))) return allow();
  // 如果没有匹配的权限规则，拒绝访问
  const registry = getRuntimeRegistry();
  const isRegistered = registry?.allResources[String(resource)];
  if (isRegistered) {
    return deny("missing_permission", "你没有权限查看该业务数据。");
  }
  return deny("invalid_resource", "不支持该业务资源。");
}

async function authorizeScopedCustomerData({
  user,
  toolCall,
  permission,
  filterField,
  message
}: PermissionPolicyInput & { permission: string; filterField: string; message: string }): Promise<PermissionDecision> {
  if (!hasPermission(user, permission)) return deny("missing_permission", message);
  const customerName = getFilterValue(toolCall.args?.filters, filterField);
  if (!customerName) return allow();
  const customer = await getCustomerByName(String(customerName));
  if (!customer) return allow();
  if (canAccessCustomer(user, customer.id)) return allow();
  return deny("customer_scope_denied", `你没有权限查看客户「${customer.name}」的数据。`);
}

async function authorizeCustomerOrOrderDetail({ user, toolCall }: PermissionPolicyInput): Promise<PermissionDecision> {
  if (!hasPermission(user, "customer:read") && !hasPermission(user, "order:read")) {
    return deny("missing_permission", "你没有权限查询客户或订单数据。");
  }
  const customer = await getCustomerByName(String(toolCall.args?.customer_name ?? ""));
  if (!customer) return allow();
  if (canAccessCustomer(user, customer.id)) return allow();
  return deny("customer_scope_denied", `你没有权限查看客户「${customer.name}」的数据。`);
}

export function filterKnowledgeByPermission(user: UserContext, chunk: KnowledgeChunk): boolean {
  const audience = chunk.metadata?.audience ?? "all";
  if (audience === "all") return true;
  if (audience === "sales") return ["sales", "manager"].includes(user.role);
  if (audience === "hr") return ["hr"].includes(user.role);
  if (audience === "manager") return user.role === "manager";
  return false;
}

function allow(): PermissionDecision {
  return { allow: true };
}

function deny(code: string, message: string): PermissionDecision {
  return { allow: false, code, message };
}

function getFilterValue(filters: unknown = [], field: string): QueryFilter["value"] | null {
  const filter = normalizeFilters(filters).find((item) => item.field === field && ["eq", "contains"].includes(item.op ?? ""));
  return filter?.value ?? null;
}

/**
 * 通过 registry 动态查找 domain 权限规则，判断用户是否有权访问指定资源。
 */
function canReadDomainResource(user: UserContext, resource: string): boolean {
  const registry = getRuntimeRegistry();
  if (!registry) return false;
  const permissionRules = registry.allPermissionRules ?? [];
  const userPermissions = new Set(user.permissions ?? []);
  // 构造一个最小化的 manifest 用于权限检查
  const manifest = { tool_binding: { resource } } as import("../types/agent-contracts.js").IntentManifest;
  for (const rule of permissionRules) {
    const result = rule({ resource, user, userPermissions, manifest });
    if (result?.ok) return true;
  }
  return false;
}

function canAccessCustomer(user: UserContext, customerId: string): boolean {
  return Array.isArray(user.accessible_customer_ids) && user.accessible_customer_ids.includes(customerId);
}

function normalizeFilters(filters: unknown = []): QueryFilter[] {
  if (!Array.isArray(filters)) return [];
  return filters
    .filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    .map((filter) => ({
      ...filter,
      field: String(filter.field ?? ""),
      op: String(filter.op ?? filter.operator ?? "")
    }));
}
