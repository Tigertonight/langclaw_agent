import type { IntentManifest, Route, ToolDefinition } from "../types/agent-contracts.js";
import type { ResourceConfig } from "../resources/types.js";

export type DomainId = "dealer" | "cloud_commodity" | "attendance" | "retail-demo" | "core";

const DOMAIN_ALIASES: Record<string, DomainId> = {
  dealer: "dealer",
  "dealer_sales": "dealer",
  cloud: "cloud_commodity",
  cloud_commodity: "cloud_commodity",
  cloudcommodity: "cloud_commodity",
  "cloud-commodity": "cloud_commodity",
  attendance: "attendance",
  leave: "attendance",
  "retail-demo": "retail-demo",
  retail: "retail-demo",
  core: "core",
};

const INTENT_PREFIX_DOMAIN: Record<string, DomainId> = {
  dealer: "dealer",
  cloud: "cloud_commodity",
  attendance: "attendance",
  retail: "retail-demo",
  knowledge: "core",
  system: "core",
  chat: "core",
};

const TOOL_PREFIX_DOMAIN: Record<string, DomainId> = {
  dealer: "dealer",
  cloud: "cloud_commodity",
  estimate: "cloud_commodity",
  create: "cloud_commodity",
  simulate: "cloud_commodity",
  leave: "attendance",
  retail: "retail-demo",
};

export function normalizeSelectedDomain(value: unknown): DomainId | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "_");
  return DOMAIN_ALIASES[normalized] ?? null;
}

export function intentDomainId(intentCode: string | undefined | null): DomainId | null {
  if (!intentCode) return null;
  const code = String(intentCode);
  if (code === "general") return "core";
  if (code === "leave_request") return "attendance";
  const prefix = code.split(".")[0] ?? "";
  return INTENT_PREFIX_DOMAIN[prefix] ?? null;
}

export function routeMatchesSelectedDomain(route: Pick<Route, "intent_code"> | Pick<IntentManifest, "intent_code">, selectedDomain: unknown): boolean {
  const selected = normalizeSelectedDomain(selectedDomain);
  if (!selected) return true;
  const actual = intentDomainId(route.intent_code);
  if (!actual || actual === "core") return true;
  return actual === selected;
}

export function resourceMatchesSelectedDomain(config: ResourceConfig | undefined, selectedDomain: unknown): boolean {
  const selected = normalizeSelectedDomain(selectedDomain);
  if (!selected || !config?.domain) return true;
  return normalizeSelectedDomain(config.domain) === selected;
}

export function toolDomainId(tool: ToolDefinition | { name: string; metadata?: Record<string, unknown> } | undefined): DomainId | null {
  if (!tool) return null;
  const metadataDomain = normalizeSelectedDomain(tool.metadata?.domain_id ?? tool.metadata?.domain);
  if (metadataDomain) return metadataDomain;
  const name = tool.name;
  if (name === "query_business_data" || name === "search_knowledge_base" || name === "retrieve_knowledge" || name === "safe_compute") return "core";
  if (name.startsWith("dealer.")) return "dealer";
  if (name.startsWith("cloud_")) return "cloud_commodity";
  if (name.startsWith("estimate_seedance") || name.startsWith("estimate_agent_plan")) return "cloud_commodity";
  if (name.startsWith("create_cloud_") || name.startsWith("simulate_cloud_")) return "cloud_commodity";
  const prefix = name.split(/[._]/)[0] ?? "";
  return TOOL_PREFIX_DOMAIN[prefix] ?? null;
}

export function toolMatchesSelectedDomain(tool: ToolDefinition | { name: string; metadata?: Record<string, unknown> } | undefined, selectedDomain: unknown): boolean {
  const selected = normalizeSelectedDomain(selectedDomain);
  if (!selected) return true;
  const actual = toolDomainId(tool);
  if (!actual || actual === "core") return true;
  return actual === selected;
}

export function domainMismatchMessage(input: { selectedDomain: unknown; actualDomain?: unknown; subject?: string }): string {
  const selected = domainLabel(normalizeSelectedDomain(input.selectedDomain));
  const actual = domainLabel(normalizeSelectedDomain(input.actualDomain));
  const subject = input.subject ? `“${input.subject}”` : "这个请求";
  if (actual) return `${subject}属于${actual}场景，当前处于${selected ?? "当前"}场景。请切换场景后再操作，或明确说明要做跨场景分析。`;
  return `${subject}不属于当前${selected ?? "业务"}场景。请切换场景后再操作，或明确说明要做跨场景分析。`;
}

export function domainLabel(domain: DomainId | null): string | null {
  if (domain === "cloud_commodity") return "云商品";
  if (domain === "dealer") return "经销商";
  if (domain === "attendance") return "考勤";
  if (domain === "retail-demo") return "零售演示";
  if (domain === "core") return "通用";
  return null;
}
