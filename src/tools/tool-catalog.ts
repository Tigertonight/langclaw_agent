/**
 * ToolCatalog
 *
 * 将 ToolRegistry 的所有工具按"业务域"分类展示，
 * 并支持按用户权限过滤，为 `/api/tools/catalog` 接口提供数据源。
 *
 * 业务域分类通过 DomainRegistry 的 catalogDomains 动态获取，
 * 各 DomainPack 在注册时声明自己的 catalogDomains（如 dealer.analytics、dealer.crm 等），
 * 引擎层不硬编码任何业务域名称。
 *
 * 权限分层：
 * - allow/read：低风险读取，自动执行
 * - ask/confirm：中风险，需要用户确认后执行
 * - deny：高风险或无权限，直接拒绝
 * - plan_only：Plan Mode 下只允许 read，不允许 write / side effect
 */

import type { ToolDescription } from "./registry.js";
import type { ToolMetadata, UserContext, JsonObject } from "../types/agent-contracts.js";
import { getCatalogDomains } from "../domains/runtime-registry.js";

export type BusinessDomain = string;

export type PermissionLevel = "allow" | "ask" | "deny";
export type RiskLevel = "read" | "write" | "sensitive_read" | "destructive" | "sandboxed_compute";

export interface CatalogEntry extends JsonObject {
  name: string;
  description: string;
  domain: BusinessDomain;
  risk_level: RiskLevel;
  permission_level: PermissionLevel;
  requires_confirmation: boolean;
  expose_to_agentic: boolean;
  required_permissions: string[];
  schema_summary: JsonObject;
}

export interface ToolCatalogResult extends JsonObject {
  total: number;
  domains: JsonObject[];
  entries: CatalogEntry[];
  plan_mode_allowed: string[];
  ask_tools: string[];
  deny_tools: string[];
}

/**
 * 按工具名称前缀推断业务域。
 * 优先使用 DomainRegistry 中注册的 catalogDomains 进行匹配，
 * 兜底使用通用前缀规则。
 */
function inferDomain(name: string): BusinessDomain {
  const prefix = name.split(".")[0] ?? "";

  // 尝试从 registry 的 catalogDomains 匹配
  const catalogDomains = getCatalogDomains();
  if (catalogDomains.length > 0) {
    // 按 id 长度降序排列，优先匹配更具体的 domain
    const sorted = [...catalogDomains].sort((a, b) => b.id.length - a.id.length);
    for (const domain of sorted) {
      // 匹配规则：工具名以 domain.id 的第一段为前缀
      const domainPrefix = domain.id.split(".")[0] ?? "";
      if (prefix === domainPrefix) {
        // 进一步匹配子域
        const second = name.split(".")[1] ?? "";
        const domainSuffix = domain.id.split(".").slice(1).join(".");
        if (domainSuffix && second.startsWith(domainSuffix.replace(/\./g, "_"))) {
          return domain.id;
        }
      }
    }
    // 如果有 catalogDomains 但没有精确匹配子域，按 DomainPack 声明顺序匹配顶级域。
    // 声明顺序表达该业务域的默认 catalog（例如 dealer 默认落到 dealer.analytics）。
    for (const domain of catalogDomains) {
      const domainPrefix = domain.id.split(".")[0] ?? "";
      if (prefix === domainPrefix) {
        return domain.id;
      }
    }
  }

  // 通用前缀规则（不含业务域硬编码）
  if (prefix === "knowledge" || prefix === "rag") return "knowledge";
  if (prefix === "sandbox") return "sandbox";
  if (prefix === "task") return "task";
  if (prefix === "memory" || prefix === "transcript" || prefix === "session") return "memory";
  if (prefix === "system" || prefix === "ops" || prefix === "maintenance" || prefix === "terminal" || prefix === "spawn" || prefix === "mcp") return "system";
  if (prefix === "cron" || prefix === "scheduler") return "task";
  if (prefix === "message" || prefix === "notify" || prefix === "wecom") return "system";
  if (prefix === "evolution" || prefix === "skill") return "system";
  if (prefix === "pending") return "system";
  return "other";
}

function inferRiskLevel(metadata?: ToolMetadata): RiskLevel {
  const raw = String(metadata?.risk_level ?? "").toLowerCase();
  if (raw === "destructive") return "destructive";
  if (raw === "write") return "write";
  if (raw === "sensitive_read") return "sensitive_read";
  if (raw === "sandboxed_compute") return "sandboxed_compute";
  return "read";
}

/** 根据 risk_level 推断默认 permission_level */
function inferPermissionLevel(riskLevel: RiskLevel, metadata?: ToolMetadata): PermissionLevel {
  if (metadata?.requires_confirmation === true) return "ask";
  if (riskLevel === "destructive") return "deny";
  if (riskLevel === "write" || riskLevel === "sensitive_read") return "ask";
  return "allow";
}

function buildSchemaSummary(schema?: JsonObject): JsonObject {
  if (!schema || typeof schema !== "object") return {};
  const properties = schema["properties"] as Record<string, JsonObject> | undefined;
  const required = schema["required"] as string[] | undefined;
  if (!properties) return {};
  const params: JsonObject[] = [];
  for (const [key, prop] of Object.entries(properties)) {
    params.push({
      name: key,
      type: String(prop?.["type"] ?? "unknown"),
      required: Array.isArray(required) && required.includes(key),
      description: String(prop?.["description"] ?? "")
    });
  }
  return { params };
}

function hasRequiredPermissions(tool: ToolDescription, user?: UserContext): boolean {
  const required = tool.metadata?.required_permissions ?? [];
  if (!required.length) return true;
  const userPerms = new Set(user?.permissions ?? []);
  return required.every((perm) => userPerms.has(perm) || userPerms.has("admin") || userPerms.has("*"));
}

export class ToolCatalog {
  /**
   * build() — 从工具列表构建能力目录。
   *
   * @param tools - ToolRegistry.list() 返回的工具列表
   * @param user - 当前用户（用于权限过滤）
   * @param planMode - 是否 Plan Mode（限制为 read-only）
   */
  build(tools: ToolDescription[], user?: UserContext, { planMode = false }: { planMode?: boolean } = {}): ToolCatalogResult {
    const entries: CatalogEntry[] = [];
    const planModeAllowed: string[] = [];
    const askTools: string[] = [];
    const denyTools: string[] = [];

    for (const tool of tools) {
      const riskLevel = inferRiskLevel(tool.metadata);
      let permissionLevel = inferPermissionLevel(riskLevel, tool.metadata);

      // Plan Mode：只允许 read / sandboxed_compute
      if (planMode && riskLevel !== "read" && riskLevel !== "sandboxed_compute") {
        permissionLevel = "deny";
      }

      // 权限检查：没有所需权限 → deny
      if (!hasRequiredPermissions(tool, user)) {
        permissionLevel = "deny";
      }

      const domain = inferDomain(tool.name);
      const requiresConfirmation = tool.metadata?.requires_confirmation === true || permissionLevel === "ask";
      const exposeToAgentic = tool.metadata?.["expose_to_agentic"] !== false;

      const entry: CatalogEntry = {
        name: tool.name,
        description: tool.description,
        domain,
        risk_level: riskLevel,
        permission_level: permissionLevel,
        requires_confirmation: requiresConfirmation,
        expose_to_agentic: exposeToAgentic,
        required_permissions: Array.isArray(tool.metadata?.required_permissions) ? tool.metadata!.required_permissions as string[] : [],
        schema_summary: buildSchemaSummary(tool.schema)
      };

      entries.push(entry);

      if (permissionLevel === "allow" || (planMode && riskLevel === "read")) {
        planModeAllowed.push(tool.name);
      }
      if (permissionLevel === "ask") askTools.push(tool.name);
      if (permissionLevel === "deny") denyTools.push(tool.name);
    }

    // 按业务域聚合统计
    const domainCounts = new Map<BusinessDomain, { total: number; allow: number; ask: number; deny: number }>();
    for (const entry of entries) {
      const existing = domainCounts.get(entry.domain);
      if (existing) {
        existing.total += 1;
        existing[entry.permission_level] += 1;
      } else {
        domainCounts.set(entry.domain, {
          total: 1,
          allow: entry.permission_level === "allow" ? 1 : 0,
          ask: entry.permission_level === "ask" ? 1 : 0,
          deny: entry.permission_level === "deny" ? 1 : 0
        });
      }
    }

    const domains: JsonObject[] = Array.from(domainCounts.entries()).map(([domain, counts]) => ({
      domain,
      ...counts
    }));

    return {
      total: entries.length,
      domains,
      entries,
      plan_mode_allowed: planModeAllowed,
      ask_tools: askTools,
      deny_tools: denyTools
    };
  }

  /**
   * filter() — 按业务域/权限级别/风险等级过滤目录条目。
   */
  filter(result: ToolCatalogResult, criteria: {
    domain?: BusinessDomain;
    permission_level?: PermissionLevel;
    risk_level?: RiskLevel;
    expose_to_agentic?: boolean;
    query?: string;
  }): CatalogEntry[] {
    return (result.entries as unknown as CatalogEntry[]).filter((entry) => {
      if (criteria.domain && entry.domain !== criteria.domain) return false;
      if (criteria.permission_level && entry.permission_level !== criteria.permission_level) return false;
      if (criteria.risk_level && entry.risk_level !== criteria.risk_level) return false;
      if (criteria.expose_to_agentic !== undefined && entry.expose_to_agentic !== criteria.expose_to_agentic) return false;
      if (criteria.query) {
        const q = criteria.query.toLowerCase();
        return entry.name.toLowerCase().includes(q) || entry.description.toLowerCase().includes(q);
      }
      return true;
    });
  }
}
