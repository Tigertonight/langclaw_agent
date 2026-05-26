/**
 * Core 通用资源定义。
 *
 * Core 域资源配置（customers / orders / sales_reports / employees / departments）。
 * 包含 resultFormatter 用于 formatBusinessDataResult 的 resource-specific 格式化。
 */

import type { ResourceConfig } from "../../resources/types.js";
import type { FieldLabels } from "../../resources/types.js";

type DataRecord = Record<string, unknown>;

// ── 辅助函数（从 local-llm.ts 迁移） ──────────────────────────────────────

function formatEmployeeProfile(profile: unknown): string | null {
  if (!profile) return null;
  const record = profile as DataRecord;
  const title = [record.department_name, record.position].filter(Boolean).join(" / ");
  return title ? `${record.name}（${title}）` : String(record.name ?? "");
}

function formatEmployeeProfiles(profiles: unknown[] = []): string {
  const text = profiles
    .filter(Boolean)
    .map((profile) => formatEmployeeProfile(profile))
    .filter(Boolean);
  return text.length ? text.join("、") : "暂未配置";
}

function formatReporting(reporting: unknown): string {
  const record = reporting && typeof reporting === "object" ? reporting as DataRecord : null;
  if (!record) return "";
  if (record.line === "store") return (record.manager_profile as DataRecord | undefined)?.name ? `门店线汇报给 ${formatEmployeeProfile(record.manager_profile)}。` : "门店线最高负责人。";
  if (record.line === "strong_vertical") return `强垂直汇报：${record.vertical_department ?? "未配置"} / ${record.vertical_manager_title ?? "未配置"}；门店负责人：${formatEmployeeProfile(record.store_manager_profile) ?? "未配置"}。`;
  if (record.line === "weak_vertical") return `弱垂直协同：${record.vertical_department ?? "未配置"}；门店负责人：${formatEmployeeProfile(record.store_manager_profile) ?? "未配置"}。`;
  return `汇报线：${record.line}。`;
}

function isCurrentUserLeaderLookup(data: DataRecord): boolean {
  const query = data.query as DataRecord | undefined;
  const filters = ((query?.filters ?? []) as DataRecord[]);
  return data.resource === "employees"
    && (data.rows as DataRecord[] | undefined)?.length === 1
    && filters.some((filter: DataRecord) => filter.field === "userid" && filter.value === "__CURRENT_USER__");
}

// ── resultFormatter 实现 ──────────────────────────────────────────────────

function formatEmployeesResult(data: DataRecord): string | null {
  if (data.operation === "aggregate") {
    const metrics = (data.metrics ?? []) as DataRecord[];
    const count = metrics.find((item: DataRecord) => item.type === "count")?.value ?? data.total;
    return `查询结果：符合条件的员工共 ${count} 人。`;
  }

  const rows = (data.rows ?? []) as DataRecord[];
  if (rows.length === 0) return `没有找到符合条件的员工。`;

  if (isCurrentUserLeaderLookup(data)) {
    const row = rows[0];
    const leader = Array.isArray(row.direct_leader_profiles) ? (row.direct_leader_profiles as DataRecord[])[0] : null;
    const reportingText = formatReporting(row.reporting);
    return leader?.name
      ? `你的直属上级是 ${formatEmployeeProfile(leader)}。${reportingText}`
      : `${row.name} 当前没有配置直属上级。${reportingText}`;
  }

  const lines = [`查询到 ${rows.length} 名员工：`];
  for (const row of rows) {
    const leaderText = Array.isArray(row.direct_leader) && (row.direct_leader as unknown[]).length
      ? formatEmployeeProfiles(row.direct_leader_profiles as unknown[])
      : "无";
    const reportingText = formatReporting(row.reporting);
    lines.push(`- ${row.name}：${row.department_name} / ${row.position}。直属上级：${leaderText}。${reportingText}`);
  }
  return lines.join("\n");
}

function formatDepartmentsResult(data: DataRecord): string | null {
  if (data.operation === "aggregate") {
    const metrics = (data.metrics ?? []) as DataRecord[];
    const count = metrics.find((item: DataRecord) => item.type === "count")?.value ?? data.total;
    return `查询结果：符合条件的组织节点共 ${count} 个。`;
  }

  const rows = (data.rows ?? []) as DataRecord[];
  if (rows.length === 0) return `没有找到符合条件的组织。`;

  const display = ((data.query as DataRecord)?.display as DataRecord | undefined);
  if (rows.length === 1 && (display?.reason as string | undefined)?.includes("负责人")) {
    const row = rows[0];
    const leader = (row.leader_profile as DataRecord)?.name ? formatEmployeeProfile(row.leader_profile) : "暂未配置";
    return `${row.name}的负责人是 ${leader}。`;
  }

  const lines = [`查询到 ${rows.length} 个组织节点：`];
  for (const row of rows) {
    const extras = [
      row.vertical_department ? `垂直归属：${row.vertical_department}` : null,
      row.relation ? `关系：${row.relation}` : null
    ].filter(Boolean).join("；");
    const leader = (row.leader_profile as DataRecord)?.name ? `${(row.leader_profile as DataRecord).name}（${(row.leader_profile as DataRecord).position ?? "负责人"}）` : "暂未配置";
    lines.push(`- ${row.name}：负责人 ${leader}${extras ? `，${extras}` : ""}。`);
  }
  return lines.join("\n");
}

function formatOrdersResult(data: DataRecord): string | null {
  const rows = (data.rows ?? []) as DataRecord[];
  if (rows.length === 0) return `没有找到符合条件的订单。`;

  const order = rows[0];
  return `客户「${order.customer_name}」最近订单 ${order.id} 当前状态为「${order.status}」，金额 ${order.amount} 元。${order.expected_delivery ? `预计交付时间是 ${order.expected_delivery}。` : ""}`;
}

function formatSalesReportsResult(data: DataRecord): string | null {
  const rows = (data.rows ?? []) as DataRecord[];
  if (rows.length === 0) return `没有找到符合条件的销售报表。`;

  const report = rows[0];
  return `${report.department} 在 ${report.period} 的销售收入为 ${report.revenue} 元，pipeline 为 ${report.pipeline} 元。`;
}

function formatCustomersResult(data: DataRecord): string | null {
  const rows = (data.rows ?? []) as DataRecord[];
  if (rows.length === 0) return `没有找到符合条件的客户。`;

  const lines = [`查询到 ${rows.length} 条客户：`];
  for (const row of rows) {
    lines.push(`- ${row.name}（${row.id}）：${row.tier} 类，${row.industry}，签单状态「${row.deal_status}」，跟进状态「${row.follow_status}」，续签状态「${row.renewal_status}」，年度成交额 ${row.annual_revenue} 元。`);
  }
  return lines.join("\n");
}

// ── 资源配置 ──────────────────────────────────────────────────────────────

/**
 * Core 通用资源配置。
 */
export const CORE_RESOURCES: Record<string, ResourceConfig> = {
  customers: {
    file: "data/customers.json",
    scopeField: "id",
    fields: [
      "id",
      "name",
      "owner_user_id",
      "department",
      "tier",
      "industry",
      "industry_category",
      "annual_revenue",
      "deal_status",
      "follow_status",
      "renewal_status",
      "last_contacted_at",
      "next_follow_up_at",
      "contract_expire_at",
    ],
    domain: "core",
    label: "客户",
    resultFormatter: formatCustomersResult,
  },
  orders: {
    file: "data/orders.json",
    scopeField: "customer_id",
    fields: [
      "id",
      "customer_id",
      "customer_name",
      "status",
      "amount",
      "created_at",
      "expected_delivery",
    ],
    domain: "core",
    label: "订单",
    resultFormatter: formatOrdersResult,
  },
  sales_reports: {
    file: "data/sales_reports.json",
    fields: [
      "department",
      "period",
      "revenue",
      "pipeline",
      "top_customers",
    ],
    domain: "core",
    label: "销售报表",
    resultFormatter: formatSalesReportsResult,
  },
  employees: {
    file: "data/wecom-users.json",
    fields: [
      "userid",
      "name",
      "alias",
      "department_name",
      "position",
      "role",
      "direct_leader",
      "reporting",
      "main_department",
      "department",
    ],
    domain: "core",
    label: "员工",
    defaultLimit: 100,
    resultFormatter: formatEmployeesResult,
  },
  departments: {
    file: "data/wecom-departments.json",
    fields: [
      "id",
      "name",
      "parentid",
      "order",
      "leader_userid",
      "vertical_relation",
      "vertical_department",
      "relation",
    ],
    domain: "core",
    label: "组织",
    defaultLimit: 100,
    resultFormatter: formatDepartmentsResult,
  },
};

/**
 * Core 通用字段标签。
 */
export const CORE_FIELD_LABELS: FieldLabels = {
  id: "ID",
  name: "客户名",
  customer_name: "客户名",
  customer_id: "客户ID",
  owner_user_id: "负责人ID",
  department: "部门",
  tier: "等级",
  industry: "行业",
  industry_category: "行业类别",
  annual_revenue: "年度成交额",
  deal_status: "签单状态",
  follow_status: "跟进状态",
  renewal_status: "续签状态",
  last_contacted_at: "最近联系时间",
  next_follow_up_at: "下次跟进时间",
  contract_expire_at: "合同到期时间",
  status: "状态",
  amount: "金额",
  created_at: "创建时间",
  expected_delivery: "预计交付时间",
  period: "周期",
  revenue: "销售收入",
  pipeline: "Pipeline",
  userid: "员工ID",
  alias: "别名",
  department_name: "所属组织",
  position: "岗位",
  role: "角色",
  direct_leader: "直属上级",
  reporting: "汇报关系",
  main_department: "主部门ID",
  parentid: "上级部门ID",
  leader_userid: "部门负责人",
  vertical_relation: "垂直关系",
  vertical_department: "垂直归属",
  relation: "协作关系",
};
