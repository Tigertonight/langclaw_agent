import { card, list, openUIView, readArray, readPath, text, toRecord, type OpenUILangCompatComponentInstance, type SurfacePlugin } from "../../../openui-lang/compat.js";
import type { JsonObject } from "../../../types/agent-contracts.js";

interface InventoryRiskData extends JsonObject {
  title: string;
  summary: JsonObject;
  risks: JsonObject[];
}

export const inventoryRiskPlugin: SurfacePlugin<InventoryRiskData> = {
  kind: "dealer_inventory_risk",
  extract: (ctx) => {
    const data = extractInventoryRisk(ctx.record);
    return data && data.risks.length ? data : null;
  },
  build: (data, ctx) => ({
    surfaceId: `${ctx.surfacePrefix}_${ctx.runId}_dealer_inventory_risk`,
    root: "dealer_inventory_risk_root",
    data: {
      ...data,
      business_surface: {
        kind: "dealer_inventory_risk",
        version: "1.0",
        title: data.title
      },
      openui: openUIView("RiskListSurface", {
        title: data.title,
        risks: data.risks
      })
    },
    components: inventoryRiskComponents(data)
  })
};

function inventoryRiskComponents(data: InventoryRiskData): OpenUILangCompatComponentInstance[] {
  const itemIds = data.risks.map((_, index) => `dealer_inventory_risk_${index}`);
  return [
    card("dealer_inventory_risk_root", ["dealer_inventory_risk_title", "dealer_inventory_risk_summary", "dealer_inventory_risk_list"]),
    text("dealer_inventory_risk_title", `### ${data.title}`),
    text("dealer_inventory_risk_summary", `共 ${String(data.summary.total ?? data.risks.length)} 辆库存车，紧急 ${String(data.summary.high ?? 0)} 辆，关注 ${String(data.summary.medium ?? 0)} 辆。`),
    list("dealer_inventory_risk_list", itemIds),
    ...data.risks.map((risk, index) => text(`dealer_inventory_risk_${index}`, `${risk.level === "high" ? "🔴" : risk.level === "medium" ? "🟡" : "🟢"} ${String(risk.message ?? risk.id ?? "")}`))
  ];
}

function extractInventoryRisk(record: Record<string, unknown>): InventoryRiskData | null {
  const debug = (toRecord(readPath(record, ["debug"])) ?? toRecord(readPath(record, ["output", "debug"]))) ?? {};
  const toolData = extractDealerVehicleToolData(debug);
  if (toolData.resource !== "dealer_vehicles" || !toolData.rows.length) return null;

  const risks = toolData.rows
    .filter((row) => String(row.stock_warning_level ?? "") !== "正常")
    .slice(0, 12)
    .map((row, index) => {
      const level = normalizeRiskLevel(row.stock_warning_level);
      const stockAge = String(row.stock_age_days ?? "-");
      const store = String(row.store_name ?? "未知门店");
      const model = [row.series, row.model].filter(Boolean).join(" ");
      const status = String(row.status ?? "-");
      return {
        id: String(row.vin ?? `vehicle_${index}`),
        level,
        tool: "库存",
        message: `${store} · ${model || "车辆"} · ${status} · 库龄 ${stockAge} 天 · ${String(row.stock_warning_level ?? "预警")}`,
        mitigated: false
      };
    });

  if (!risks.length) return null;

  const rows = toolData.rows;
  return {
    title: "库存风险看板",
    summary: {
      total: toolData.total ?? rows.length,
      high: rows.filter((row) => normalizeRiskLevel(row.stock_warning_level) === "high").length,
      medium: rows.filter((row) => normalizeRiskLevel(row.stock_warning_level) === "medium").length,
      low: rows.filter((row) => normalizeRiskLevel(row.stock_warning_level) === "low").length
    },
    risks
  };
}

function extractDealerVehicleToolData(debug: JsonObject): { resource?: string; total?: number; rows: JsonObject[] } {
  const toolResults = readArray(debug.tool_results);
  for (const result of toolResults) {
    const resource = String(result.resource ?? readPath(result, ["data", "resource"]) ?? "");
    if (resource !== "dealer_vehicles") continue;
    const rows = readArray(result.rows).length
      ? readArray(result.rows)
      : readArray(result.sample_rows).length
        ? readArray(result.sample_rows)
        : readArray(readPath(result, ["data", "rows"])).length
          ? readArray(readPath(result, ["data", "rows"]))
          : readArray(readPath(result, ["data", "sample_rows"]));
    const total = typeof result.total === "number"
      ? result.total
      : typeof readPath(result, ["data", "total"]) === "number"
        ? readPath(result, ["data", "total"]) as number
        : undefined;
    return { resource, total, rows };
  }
  return { rows: [] };
}

function normalizeRiskLevel(value: unknown): "high" | "medium" | "low" {
  const textValue = String(value ?? "");
  if (textValue === "紧急" || textValue === "预警" || textValue === "high" || textValue === "critical") return "high";
  if (textValue === "关注" || textValue === "medium") return "medium";
  return "low";
}
