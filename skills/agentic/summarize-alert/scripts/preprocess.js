/**
 * summarize-alert 的参数预处理：把传入的 rows 数组浓缩成可贴进 prompt 的精简文本，
 * 避免一次塞 50 行 JSON 进上下文。
 *
 * 输入：{ rows, alert_kind, extra_metrics }
 * 输出：{ rows_summary, extra_metrics_summary, alert_kind_label }
 *
 * 设计上是纯函数：不读文件、不发请求、不抛异常（拿不到字段就用占位）。
 */

const ALERT_LABELS = {
  inventory_pressure: "库存压力",
  finance_overdue: "财务应付/应收逾期",
  repair_overdue: "维修工单逾期",
  warranty_diff: "保修索赔差额"
};

const PER_GROUP_LIMIT = 6;
const MAX_GROUPS = 5;

export default function preprocess({ rows = [], alert_kind, extra_metrics } = {}) {
  const rows_summary = summarizeRows(rows);
  const extra_metrics_summary = summarizeMetrics(extra_metrics);
  const alert_kind_label = ALERT_LABELS[alert_kind] ?? alert_kind ?? "未指定";
  return { rows_summary, extra_metrics_summary, alert_kind_label };
}

function summarizeRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) {
    return "（未提供行级数据）";
  }
  const grouped = new Map();
  for (const row of rows) {
    const key = row.store ?? row.dealer ?? "（未注明门店）";
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(row);
  }
  const groupKeys = Array.from(grouped.keys()).slice(0, MAX_GROUPS);
  const blocks = groupKeys.map((key) => {
    const list = grouped.get(key) ?? [];
    const lines = list.slice(0, PER_GROUP_LIMIT).map((row, idx) => `  ${idx + 1}. ${formatRow(row)}`);
    const tail = list.length > PER_GROUP_LIMIT ? `  ...（共 ${list.length} 行，已截断 ${list.length - PER_GROUP_LIMIT} 行）` : "";
    return `- ${key}（${list.length} 行）\n${lines.join("\n")}${tail ? `\n${tail}` : ""}`;
  });
  if (grouped.size > MAX_GROUPS) {
    blocks.push(`- ...（还有 ${grouped.size - MAX_GROUPS} 组未列出）`);
  }
  return blocks.join("\n");
}

function formatRow(row) {
  const parts = [];
  if (row.series || row.model) parts.push(`${row.series ?? ""}${row.model ? ` ${row.model}` : ""}`.trim());
  if (row.vin) parts.push(`车架 ${row.vin}`);
  if (row.days_in_stock != null) parts.push(`库龄 ${row.days_in_stock} 天`);
  if (row.status) parts.push(`状态 ${row.status}`);
  if (row.amount != null) parts.push(`金额 ${row.amount}`);
  if (row.cost != null) parts.push(`成本 ${row.cost}`);
  if (row.claim_status) parts.push(`索赔 ${row.claim_status}`);
  if (row.fault_category) parts.push(`故障 ${row.fault_category}`);
  if (parts.length === 0) return JSON.stringify(row).slice(0, 120);
  return parts.join("，");
}

function summarizeMetrics(metrics) {
  if (!metrics || typeof metrics !== "object") return "（未提供派生指标）";
  const entries = Object.entries(metrics);
  if (entries.length === 0) return "（未提供派生指标）";
  return entries.map(([k, v]) => `- ${k}: ${formatMetricValue(v)}`).join("\n");
}

function formatMetricValue(v) {
  if (v == null) return "null";
  if (typeof v === "number") return Number.isInteger(v) ? String(v) : v.toFixed(2);
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
