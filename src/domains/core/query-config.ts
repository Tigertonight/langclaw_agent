export const CORE_QUERY_CONFIG = {
  resources: ["orders", "sales_reports", "employees", "departments", "customers"],
  departments: {
    aliases: [
      { patterns: ["行政部", "人事部", "行政人事"], departmentName: "行政人事部" },
      { patterns: ["销售部"], departmentName: "销售部" }
    ]
  },
  relations: {
    leaderPatterns: ["上级", "汇报", "直属", "领导", "主管"],
    reportPatterns: ["下面", "下属", "下级", "下辖", "团队", "同学"],
    selfLeaderPatterns: ["我的.*(上级|领导|主管)", "我.*(上级|领导|主管)", "上级是谁"]
  },
  salesReports: {
    departmentField: "department"
  },
  sort: {
    orders: [{ field: "created_at", direction: "desc" }],
    departments: [{ field: "order", direction: "asc" }],
    employees: [{ field: "main_department", direction: "asc" }, { field: "order", direction: "asc" }]
  }
} as const;

export function matchesAny(text: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => new RegExp(pattern).test(text));
}
