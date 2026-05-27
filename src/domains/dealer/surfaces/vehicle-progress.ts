/**
 * Dealer 域 vehicle-progress Surface 插件。
 * 从 src/a2ui/plugins/vehicle-progress.ts 迁移而来。
 */

import { businessSurface } from "../../../a2ui/openui-bridge.js";
import { card, formatCurrency, list, readArray, readPath, row, text, toRecord } from "../../../a2ui/builders/components.js";
import { VehicleOrderSchema, type VehicleOrder } from "../schemas.js";
import type { SurfacePlugin } from "../../../a2ui/plugins/types.js";
import type { A2UIComponentInstance } from "../../../a2ui/types.js";
import type { JsonObject } from "../../../types/agent-contracts.js";

interface VehicleProgressData extends JsonObject {
  title: string;
  summary: JsonObject;
  orders: JsonObject[];
}

export const vehicleProgressPlugin: SurfacePlugin<VehicleProgressData> = {
  kind: "vehicle_progress",
  extract: (ctx) => {
    const data = extractVehicleProgress(ctx.record);
    return data && data.orders.length ? data : null;
  },
  build: (data, ctx) => ({
    surfaceId: `${ctx.surfacePrefix}_${ctx.runId}_vehicle_progress`,
    root: "vehicle_progress_root",
    data: {
      ...data,
      ...businessSurface("vehicle_progress", data.title, data)
    },
    components: vehicleProgressComponents(data)
  })
};

function vehicleProgressComponents(data: VehicleProgressData): A2UIComponentInstance[] {
  return [
    card("vehicle_progress_root", ["vehicle_progress_title", "vehicle_progress_summary", "vehicle_progress_list"]),
    text("vehicle_progress_title", `### ${data.title}`),
    row("vehicle_progress_summary", ["vehicle_progress_total", "vehicle_progress_pending", "vehicle_progress_unpaid"]),
    text("vehicle_progress_total", `**${String(data.summary.total ?? 0)}**\n\n相关订单`),
    text("vehicle_progress_pending", `**${String(data.summary.pending_delivery ?? 0)}**\n\n待交付/整备`),
    text("vehicle_progress_unpaid", `**${String(data.summary.unpaid ?? 0)}**\n\n未结清`),
    list("vehicle_progress_list", data.orders.map((_, index) => `vehicle_order_${index}`)),
    ...data.orders.flatMap((order, index) => {
      const customer = String(order.customer_name ?? "客户");
      const model = [order.series, order.model].filter(Boolean).join(" ");
      const delivery = String(order.delivery_status ?? order.order_status ?? "-");
      const payment = String(order.payment_status ?? "-");
      const expected = String(order.expected_delivery_date ?? "-");
      const paid = formatCurrency(order.paid_amount);
      const finalPrice = formatCurrency(order.final_price);
      const nextAction = nextVehicleAction(order);
      return [
        card(`vehicle_order_${index}`, [`vehicle_order_${index}_body`, `vehicle_order_${index}_action`]),
        text(`vehicle_order_${index}_body`, [
          `**${customer}${model ? ` · ${model}` : ""}**`,
          `订单：${String(order.id ?? "-")} · 交付：${delivery} · 收款：${payment}`,
          `预计交付：${expected} · 已收：${paid} / ${finalPrice}`
        ].join("\n\n")),
        text(`vehicle_order_${index}_action`, `下一步：${nextAction}`)
      ];
    })
  ];
}

function extractVehicleProgress(record: Record<string, unknown>): VehicleProgressData | null {
  const tableRows = readArray(readPath(record, ["table", "rows"]))
    .concat(readArray(readPath(record, ["output", "table", "rows"])));
  const debug = (toRecord(readPath(record, ["debug"])) ?? toRecord(readPath(record, ["output", "debug"]))) ?? {};
  const args = toRecord(readPath(debug, ["tool_call", "args"]));
  const toolData = extractDealerSalesOrderToolData(debug);

  const rawRows = tableRows.length ? tableRows : toolData.rows;
  const validOrders = parseOrders(rawRows);
  const resource = String(args?.resource ?? toolData.resource ?? inferResourceFromRows(validOrders));

  if (resource !== "dealer_sales_orders" || !validOrders.length) {
    return null;
  }

  const orders = validOrders.slice(0, 6).map((order) => ({
    ...(order as JsonObject),
    timeline: vehicleTimeline(order)
  }));

  return {
    title: "车辆交付进度",
    summary: {
      total: toolData.total ?? validOrders.length,
      pending_delivery: validOrders.filter(isPendingVehicleDelivery).length,
      unpaid: validOrders.filter((order) => order.payment_status !== "已结清").length
    },
    orders
  };
}

function parseOrders(rows: JsonObject[]): VehicleOrder[] {
  return rows
    .map((row) => VehicleOrderSchema.safeParse(row))
    .filter((parsed): parsed is { success: true; data: VehicleOrder } => parsed.success)
    .map((parsed) => parsed.data);
}

function vehicleTimeline(order: VehicleOrder): JsonObject[] {
  const paid = order.payment_status === "已结清";
  const invoiced = order.invoice_status === "已开票";
  const delivered = order.delivery_status === "已交付";
  return [
    { key: "order", label: "订单创建", status: "done" },
    { key: "payment", label: "收款确认", status: paid ? "done" : "current" },
    { key: "invoice", label: "开票", status: paid ? (invoiced ? "done" : "current") : "pending" },
    { key: "delivery", label: "交付", status: delivered ? "done" : invoiced ? "current" : "pending" }
  ];
}

function extractDealerSalesOrderToolData(debug: JsonObject): { resource?: string; total?: number; rows: JsonObject[] } {
  const toolResults = readArray(debug.tool_results);
  for (const result of toolResults) {
    const resource = String(result.resource ?? readPath(result, ["data", "resource"]) ?? "");
    if (resource !== "dealer_sales_orders") continue;
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

function inferResourceFromRows(rows: VehicleOrder[]): string {
  if (rows.some((row) => row.delivery_status != null && row.payment_status != null && row.expected_delivery_date != null)) {
    return "dealer_sales_orders";
  }
  return "";
}

function isPendingVehicleDelivery(order: VehicleOrder): boolean {
  return (order.order_status ?? "") !== "已交付" || (order.delivery_status ?? "") !== "已交付";
}

function nextVehicleAction(order: JsonObject): string {
  const payment = String(order.payment_status ?? "");
  const invoice = String(order.invoice_status ?? "");
  const delivery = String(order.delivery_status ?? "");
  if (payment !== "已结清") return "优先跟进尾款/金融放款到账";
  if (invoice !== "已开票") return "确认开票节点";
  if (delivery !== "已交付") return "确认整备、上牌和交付排期";
  return "已完成交付，保持客户回访";
}
