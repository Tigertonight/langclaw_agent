process.env.WECOM_MODE ??= "mock";

import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { createApp } from "../app.js";
import { loadJson } from "../data/load-json.js";
import type { JsonObject, ToolResult, UserContext } from "../types/agent-contracts.js";

const app = createApp();
await app.init();

const dataDir = "data/cloud-commodity";
const failures: Array<{ name: string; message: string }> = [];

const cloudUser: UserContext = {
  id: "cloud_pm_001",
  name: "程一川",
  role: "cloud_pm",
  department: "云商品平台",
  accessible_customer_ids: ["cust_ai_studio", "cust_media_stream", "cust_finance_core"],
  permissions: ["cloud:read", "cloud:draft", "cloud:risk", "cloud:estimate", "policy:read", "org:read"],
};

const allowedEmptyResources = new Set(["cloud_sample_agent_answers"]);
const forbiddenVisiblePatterns = [
  /\bowner_user_id\b/,
  /\bseverity\s*=\s*high\b/i,
  /\barr_at_risk_cny\b/,
  /\bcloud_[a-z0-9_]+\b/,
];

const files = (await readdir(dataDir)).filter((file) => file.endsWith(".json")).sort();
const resources = files.map((file) => basename(file, ".json"));

await test("all cloud data files are registered as resources", async () => {
  for (const resource of resources) {
    if (!app.resourceRegistry.has(resource)) throw new Error(`missing resource registration: ${resource}`);
  }
});

await test("all cloud resources have Chinese table labels and descriptions", async () => {
  for (const resource of resources) {
    const config = app.resourceRegistry.get(resource);
    if (!config?.label || /cloud_/.test(config.label)) throw new Error(`${resource} missing business label`);
    if (!config.description || config.description.length < 8 || /cloud_/.test(config.description)) {
      throw new Error(`${resource} missing business description`);
    }
  }
});

await test("all actual data fields are allowed and documented", async () => {
  for (const resource of resources) {
    const config = app.resourceRegistry.get(resource);
    if (!config) throw new Error(`${resource} not registered`);
    const raw = await loadJson<unknown>(join(dataDir, `${resource}.json`));
    const rows = normalizeRows(raw);
    if ((!Array.isArray(rows) || rows.length === 0) && !allowedEmptyResources.has(resource)) {
      throw new Error(`${resource} is unexpectedly empty`);
    }
    const actualFields = new Set(rows.flatMap((row) => Object.keys(row)));
    for (const field of actualFields) {
      if (!config.fields.includes(field)) throw new Error(`${resource}.${field} missing from allowed fields`);
      const schema = config.schema?.[field];
      const description = typeof schema === "string" ? schema : schema?.description;
      if (!description || description.length < 6) throw new Error(`${resource}.${field} missing Chinese description`);
      if (/^[a-z0-9_]+$/.test(description)) throw new Error(`${resource}.${field} description looks like raw key`);
    }
  }
});

await test("query_business_data returns Chinese metadata", async () => {
  const result = await execute("query_business_data", { resource: "cloud_operating_metrics", operation: "search", limit: 3 });
  assertOk(result, "query cloud_operating_metrics");
  const data = asObject(result.data);
  if (data.resource_label !== "云商品经营指标") throw new Error(`unexpected resource_label: ${data.resource_label}`);
  if (!String(data.resource_description ?? "").includes("GMV")) throw new Error("resource_description should explain operating metrics");
  const metadata = asArray(data.field_metadata).map(asObject);
  if (!metadata.some((item) => item.key === "owner_team" && item.label === "负责团队" && String(item.description ?? "").includes("团队"))) {
    throw new Error("field_metadata should include Chinese owner_team description");
  }
  const labels = asObject(data.display_field_labels);
  if (labels.metric_name !== "指标名称") throw new Error("display_field_labels missing metric_name label");
});

await test("metadata-backed visible payload avoids raw engineering keys", async () => {
  const result = await execute("query_business_data", { resource: "cloud_risk_signals", operation: "search", limit: 3 });
  assertOk(result, "query cloud_risk_signals");
  const data = asObject(result.data);
  const readableMetadata = asArray(data.field_metadata).map((item) => {
    const field = asObject(item);
    return { label: field.label, description: field.description };
  });
  const visible = JSON.stringify({
    resource_label: data.resource_label,
    resource_description: data.resource_description,
    display_field_labels: data.display_field_labels,
    field_labels: readableMetadata,
  });
  for (const pattern of forbiddenVisiblePatterns) {
    if (pattern.test(visible)) throw new Error(`visible metadata leaked raw key pattern: ${pattern}`);
  }
});

if (failures.length) {
  console.error("cloud-data-dictionary failures:");
  for (const failure of failures) console.error(`- ${failure.name}: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("cloud-data-dictionary: OK");
}

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    failures.push({ name, message: error instanceof Error ? error.message : String(error) });
  }
}

async function execute(name: string, args: JsonObject): Promise<ToolResult> {
  return app.toolRegistry.execute({ name, args }, { user: cloudUser, confirmed: true }) as Promise<ToolResult>;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function normalizeRows(value: unknown): JsonObject[] {
  if (Array.isArray(value)) return value.map(asObject).filter((row) => Object.keys(row).length > 0);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([group, item]) => {
    const items = Array.isArray(item) ? item : [item];
    return items
      .map((entry, index) => {
        const row = asObject(entry);
        if (!Object.keys(row).length) return null;
        return {
          sample_id: items.length > 1 ? `${group}_${index + 1}` : group,
          sample_group: group,
          ...row,
        } as JsonObject;
      })
      .filter((row): row is JsonObject => Boolean(row));
  });
}

function assertOk(result: ToolResult, label: string) {
  if (result.ok === false) {
    throw new Error(`${label} failed: ${result.message ?? result.error ?? "unknown error"}`);
  }
}
