import { getRuntimeRegistry, getToolPermissionPolicies } from "../domains/runtime-registry.js";
import type {
  PermissionDecision,
  ToolCall,
  UserContext,
} from "../types/agent-contracts.js";

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

function hasPermission(user: UserContext | undefined, permission: string): boolean {
  return Array.isArray(user?.permissions) && user.permissions.includes(permission);
}

/**
 * 引擎内置策略（业务无关）。
 * 业务相关的工具策略由各域通过 DomainPack.toolPermissionPolicies 声明。
 */
const TOOL_POLICIES: ToolPolicy[] = [
  {
    name: "authenticated_user",
    matches: () => true,
    authorize: async ({ user }) => user.role === "anonymous"
      ? deny("unknown_user", "请先登录后再查询企业数据。")
      : null,
  },
  {
    name: "knowledge_read",
    matches: ({ toolCall }) => ["search_knowledge_base", "retrieve_knowledge"].includes(toolCall.name),
    authorize: async ({ user }) => hasPermission(user, "policy:read")
      ? allow()
      : deny("missing_permission", "你没有权限检索企业知识资料。"),
  },
  {
    name: "safe_compute",
    matches: ({ toolCall }) => toolCall.name === "safe_compute",
    authorize: async () => allow(),
  },
  {
    name: "runtime_tools",
    matches: ({ toolCall }) => /^(runtime|task|memory|evolution|maintenance|plugin|a2ui|openui)\./.test(toolCall.name),
    authorize: async () => allow(),
  },
  {
    name: "domain_tool_permission",
    matches: ({ toolCall }) => {
      // 匹配所有声明 metadata.required_permissions 的域工具
      const meta = toolCall.metadata ?? {};
      return Array.isArray(meta.required_permissions) && meta.required_permissions.length > 0
        && !["query_business_data", "search_knowledge_base", "retrieve_knowledge", "safe_compute"].includes(toolCall.name);
    },
    authorize: async ({ user, toolCall }) => {
      const requiredPerms = (toolCall.metadata?.required_permissions ?? []) as string[];
      for (const perm of requiredPerms) {
        if (!hasPermission(user, perm)) {
          return deny("missing_permission", `你没有权限执行此操作（需要 ${perm}）。`);
        }
      }
      return allow();
    },
  },
];

export async function checkToolPermission(user: UserContext, toolCall: ToolCall): Promise<PermissionDecision> {
  // 1. 引擎内置策略
  for (const policy of TOOL_POLICIES) {
    if (!policy.matches({ user, toolCall })) continue;
    const decision = await policy.authorize({ user, toolCall });
    if (decision) return { ...decision, policy: policy.name };
  }

  // 2. 域级工具权限策略
  for (const policy of getToolPermissionPolicies()) {
    if (!policy.matches({ user, toolCall })) continue;
    const decision = await policy.authorize({ user, toolCall });
    if (decision) return { ...decision, policy: policy.name };
  }

  // 3. query_business_data 资源级兜底（org 资源 + 域权限规则）
  if (toolCall.name === "query_business_data") {
    return authorizeBusinessDataFallback(user, toolCall);
  }

  return deny("unknown_tool", `工具 ${toolCall.name} 不在允许列表中。`);
}

/**
 * query_business_data 兜底授权：
 * - 引擎层只处理 employees / departments（组织架构通用资源）
 * - 其他资源走 domain.permissionRules（资源级规则）
 * - 全部失败时给出明确拒绝
 */
async function authorizeBusinessDataFallback(user: UserContext, toolCall: ToolCall): Promise<PermissionDecision> {
  const resource = String(toolCall.args?.resource ?? "");
  if (resource === "employees" || resource === "departments") {
    if (hasPermission(user, "org:read") || user.role !== "anonymous") return { ...allow(), policy: "org_read" };
    return { ...deny("missing_permission", "你没有权限查询组织架构或人员汇报关系。"), policy: "org_read" };
  }
  if (canReadDomainResource(user, resource)) return { ...allow(), policy: "domain_resource" };

  const registry = getRuntimeRegistry();
  const isRegistered = registry?.allResources[resource];
  if (isRegistered) {
    return { ...deny("missing_permission", "你没有权限查看该业务数据。"), policy: "domain_resource" };
  }
  return { ...deny("invalid_resource", "不支持该业务资源。"), policy: "domain_resource" };
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

/**
 * 通过 registry 动态查找 domain 权限规则，判断用户是否有权访问指定资源。
 */
function canReadDomainResource(user: UserContext, resource: string): boolean {
  const registry = getRuntimeRegistry();
  if (!registry) return false;
  const permissionRules = registry.allPermissionRules ?? [];
  const userPermissions = new Set(user.permissions ?? []);
  const manifest = { tool_binding: { resource } } as import("../types/agent-contracts.js").IntentManifest;
  for (const rule of permissionRules) {
    const result = rule({ resource, user, userPermissions, manifest });
    if (result?.ok) return true;
  }
  return false;
}
