/**
 * gross-margin-attribution 的参数预处理：
 *   - 按主维度 dim 分组，算每组的笔数 / 成交额 / 毛利 / 毛利率，从高到低排好
 *   - 算整体的笔数 / 成交额 / 加权毛利率
 *   - 如果给了 compare 副维度，再生成一份按 compare 的分组（不嵌套，仅另一份切片）
 *
 * 设计上是纯函数：拿不到 final_price / gross_profit 就跳过该行。
 */
const DIM_LABELS = {
  series: "车系",
  model: "车型",
  channel: "渠道",
  store: "门店"
};

const TOP_GROUPS = 6;

export default function preprocess({ rows = [], dim, compare, period_label } = {}) {
  const dimKey = normalizeDim(dim);
  const compareKey = normalizeDim(compare);
  const dim_label = DIM_LABELS[dimKey] ?? dimKey ?? "未指定";
  const compare_clause = compareKey ? `；副维度：${DIM_LABELS[compareKey] ?? compareKey}` : "";
  const period_label_safe = period_label ?? "未注明口径";

  const overall = aggregateAll(rows);
  const overall_summary = overall.count
    ? `订单数 ${overall.count}；总成交额 ${formatNum(overall.amount)}；整体毛利率 ${formatPct(overall.margin)}`
    : "（未提供有效订单行）";

  const dim_breakdown = buildBreakdown(rows, dimKey);
  const compare_breakdown_section = compareKey
    ? `# 副维度分组（${DIM_LABELS[compareKey] ?? compareKey}）\n${buildBreakdown(rows, compareKey)}`
    : "";

  return {
    period_label_safe,
    dim_label,
    compare_clause,
    overall_summary,
    dim_breakdown,
    compare_breakdown_section
  };
}

function normalizeDim(d) {
  if (!d) return null;
  const s = String(d).trim().toLowerCase();
  if (DIM_LABELS[s]) return s;
  return s || null;
}

function aggregateAll(rows) {
  let count = 0;
  let amount = 0;
  let profit = 0;
  for (const row of rows ?? []) {
    const fp = toNumber(row.final_price);
    const gp = toNumber(row.gross_profit);
    if (fp == null || gp == null) continue;
    count += 1;
    amount += fp;
    profit += gp;
  }
  return { count, amount, profit, margin: amount > 0 ? profit / amount : null };
}

function buildBreakdown(rows, key) {
  if (!key) return "（未指定维度）";
  const groups = new Map();
  for (const row of rows ?? []) {
    const fp = toNumber(row.final_price);
    const gp = toNumber(row.gross_profit);
    if (fp == null || gp == null) continue;
    const bucket = String(row[key] ?? "（未注明）");
    if (!groups.has(bucket)) groups.set(bucket, { count: 0, amount: 0, profit: 0 });
    const g = groups.get(bucket);
    g.count += 1;
    g.amount += fp;
    g.profit += gp;
  }
  if (groups.size === 0) return "（按该维度无可分组数据）";
  const list = Array.from(groups.entries())
    .map(([k, v]) => ({ key: k, ...v, margin: v.amount > 0 ? v.profit / v.amount : null }))
    .sort((a, b) => (b.margin ?? -1) - (a.margin ?? -1));
  const lines = list.slice(0, TOP_GROUPS).map((g, i) =>
    `${i + 1}. ${g.key}：毛利率 ${formatPct(g.margin)}，笔数 ${g.count}，成交额 ${formatNum(g.amount)}`
  );
  if (list.length > TOP_GROUPS) {
    lines.push(`...（还有 ${list.length - TOP_GROUPS} 组未列出）`);
  }
  return lines.join("\n");
}

function toNumber(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function formatNum(n) {
  if (n == null || !Number.isFinite(n)) return "-";
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function formatPct(r) {
  if (r == null || !Number.isFinite(r)) return "-";
  return `${(r * 100).toFixed(2)}%`;
}
