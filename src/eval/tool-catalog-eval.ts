/**
 * tool-catalog-eval
 *
 * 验证 Phase 4 Tool Catalog + Plan Mode + OpenUI Lang Workbench 的核心功能：
 * 1. ToolCatalog.build() 能按业务域分类所有工具
 * 2. ToolCatalog.build() 能按用户权限过滤
 * 3. ToolCatalog.filter() 能按域/权限级别/查询词过滤
 * 4. PlanModeGuard.evaluate() 正确返回 allow/ask/deny 决定
 * 5. PlanModeGuard plan_only 模式拦截 write 操作
 * 6. OpenUI Lang Workbench Surface builder 能生成有效的 legacy compatibility envelope
 *
 * 运行方式：npm run eval:tool-catalog
 */
import { ToolCatalog } from "../tools/tool-catalog.js";
import { PlanModeGuard } from "../tools/plan-mode.js";
import { AVAILABLE_PACKS, DomainRegistry } from "../domains/index.js";
import { setRuntimeRegistryAccessor } from "../domains/runtime-registry.js";
import {
  buildToolCatalogSurface,
  buildRiskListSurface,
  buildMetricCardsSurface,
  buildEvidenceSurface,
  buildPendingActionSurface,
  buildTaskTrackingSurface
} from "../openui-lang/workbench.js";
import type { ToolDescription } from "../tools/registry.js";
import type { UserContext } from "../types/agent-contracts.js";

const domainRegistry = new DomainRegistry();
domainRegistry.registerMany(AVAILABLE_PACKS);
await domainRegistry.initialize();
setRuntimeRegistryAccessor(domainRegistry);

// ── 测试数据 ──────────────────────────────────────────────────────────────

const sampleTools: ToolDescription[] = [
  // read 工具 → allow
  { name: "dealer.sales_query", description: "查询销售数据", metadata: { risk_level: "read", required_permissions: ["dealer.read"] } },
  { name: "memory.retrieve", description: "召回用户记忆", metadata: { risk_level: "read", required_permissions: [] } },
  { name: "memory.index", description: "查看记忆索引", metadata: { risk_level: "read", required_permissions: [], expose_to_agentic: true } },
  { name: "knowledge.search", description: "搜索知识库", metadata: { risk_level: "read", required_permissions: [] } },
  { name: "task.list", description: "列出任务", metadata: { risk_level: "read", required_permissions: [] } },

  // write 工具 → ask
  { name: "dealer.update_lead", description: "更新线索状态", metadata: { risk_level: "write", required_permissions: ["dealer.write"], requires_confirmation: true } },
  { name: "pending.confirm", description: "确认待执行动作", metadata: { risk_level: "write", required_permissions: [] } },

  // sensitive_read → ask
  { name: "dealer.risk.finance_summary", description: "财务风险摘要（含敏感数据）", metadata: { risk_level: "sensitive_read", required_permissions: ["dealer.finance"] } },

  // destructive → deny
  { name: "maintenance.reset_workspace", description: "重置用户工作区", metadata: { risk_level: "destructive", required_permissions: ["admin"] } },

  // sandboxed_compute → allow
  { name: "sandbox.execute", description: "沙箱代码执行", metadata: { risk_level: "sandboxed_compute", required_permissions: [] } }
];

const userWithReadPermission: UserContext = {
  id: "user_001",
  name: "测试用户",
  role: "sales",
  department: "华南区",
  permissions: ["dealer.read"]
};

const userWithFullPermission: UserContext = {
  id: "user_admin",
  name: "管理员",
  role: "admin",
  department: "总部",
  permissions: ["dealer.read", "dealer.write", "dealer.finance", "admin"]
};

// ── 测试 1：ToolCatalog.build() 业务域分类 ───────────────────────────────
console.log("[eval] 测试 1：ToolCatalog.build() 业务域分类...");
const catalog = new ToolCatalog();
const result = catalog.build(sampleTools);

assert(result.total === sampleTools.length, `total 应为 ${sampleTools.length}，实际 ${result.total}`);
assert(result.domains.length > 0, "domains 应非空");

// 验证分类正确
const entries = result.entries as unknown as import("../tools/tool-catalog.js").CatalogEntry[];
const salesEntry = entries.find((e) => e.name === "dealer.sales_query");
assert(salesEntry !== undefined, "应找到 dealer.sales_query");
assert(salesEntry!.domain === "dealer.analytics", `dealer.sales_query 域应为 dealer.analytics，实际 ${salesEntry!.domain}`);

const memoryEntry = entries.find((e) => e.name === "memory.retrieve");
assert(memoryEntry !== undefined, "应找到 memory.retrieve");
assert(memoryEntry!.domain === "memory", `memory.retrieve 域应为 memory，实际 ${memoryEntry!.domain}`);

const sandboxEntry = entries.find((e) => e.name === "sandbox.execute");
assert(sandboxEntry !== undefined, "应找到 sandbox.execute");
assert(sandboxEntry!.domain === "sandbox", `sandbox.execute 域应为 sandbox，实际 ${sandboxEntry!.domain}`);

console.log(`[eval] 测试 1 PASS — ${result.total} 个工具，${result.domains.length} 个业务域`);

// ── 测试 2：permission_level 推断 ─────────────────────────────────────────
console.log("[eval] 测试 2：permission_level 推断...");
// 无权限用户构建目录
const resultNoPerms = catalog.build(sampleTools, userWithReadPermission);
const entriesNoPerms = resultNoPerms.entries as unknown as import("../tools/tool-catalog.js").CatalogEntry[];

// dealer.read 权限 → dealer.sales_query 应为 allow
const salesPerm = entriesNoPerms.find((e) => e.name === "dealer.sales_query");
assert(salesPerm?.permission_level === "allow", `dealer.sales_query 对有权限用户应为 allow，实际 ${salesPerm?.permission_level}`);

// 没有 dealer.write → dealer.update_lead 应为 deny（权限不足）
const leadPerm = entriesNoPerms.find((e) => e.name === "dealer.update_lead");
assert(leadPerm?.permission_level === "deny", `dealer.update_lead 对无 dealer.write 用户应为 deny，实际 ${leadPerm?.permission_level}`);

// 全权限用户 → dealer.update_lead 应为 ask（write 操作）
const resultFullPerms = catalog.build(sampleTools, userWithFullPermission);
const entriesFullPerms = resultFullPerms.entries as unknown as import("../tools/tool-catalog.js").CatalogEntry[];
const leadFullPerm = entriesFullPerms.find((e) => e.name === "dealer.update_lead");
assert(leadFullPerm?.permission_level === "ask", `dealer.update_lead 对全权限用户应为 ask，实际 ${leadFullPerm?.permission_level}`);

// destructive → deny（不论权限）
const resetPerm = entriesFullPerms.find((e) => e.name === "maintenance.reset_workspace");
assert(resetPerm?.permission_level === "deny", `maintenance.reset_workspace 应为 deny，实际 ${resetPerm?.permission_level}`);

console.log("[eval] 测试 2 PASS");

// ── 测试 3：Plan Mode ─────────────────────────────────────────────────────
console.log("[eval] 测试 3：Plan Mode 拦截 write 操作...");
const resultPlanMode = catalog.build(sampleTools, userWithFullPermission, { planMode: true });
const entriesPlanMode = resultPlanMode.entries as unknown as import("../tools/tool-catalog.js").CatalogEntry[];

// write 操作在 plan mode → deny
const leadPlanMode = entriesPlanMode.find((e) => e.name === "dealer.update_lead");
assert(leadPlanMode?.permission_level === "deny", `Plan Mode 下 dealer.update_lead 应为 deny，实际 ${leadPlanMode?.permission_level}`);

// read 操作在 plan mode → allow
const salesPlanMode = entriesPlanMode.find((e) => e.name === "dealer.sales_query");
assert(salesPlanMode?.permission_level === "allow", `Plan Mode 下 dealer.sales_query 应为 allow，实际 ${salesPlanMode?.permission_level}`);

// sandboxed_compute 在 plan mode → allow（允许）
const sandboxPlanMode = entriesPlanMode.find((e) => e.name === "sandbox.execute");
assert(sandboxPlanMode?.permission_level === "allow", `Plan Mode 下 sandbox.execute 应为 allow，实际 ${sandboxPlanMode?.permission_level}`);

console.log("[eval] 测试 3 PASS");

// ── 测试 4：ToolCatalog.filter() ─────────────────────────────────────────
console.log("[eval] 测试 4：ToolCatalog.filter()...");
const memoryEntries = catalog.filter(result, { domain: "memory" });
assert(memoryEntries.length > 0, "memory 域应有条目");
assert(memoryEntries.every((e) => e.domain === "memory"), "filter domain=memory 结果应全为 memory 域");

const queryResult = catalog.filter(result, { query: "线索" });
assert(queryResult.length > 0, "query=线索 应有结果");
assert(queryResult.some((e) => e.name.includes("lead") || e.description.includes("线索")), "query=线索 结果应包含线索相关工具");

console.log(`[eval] 测试 4 PASS — memory 域: ${memoryEntries.length} 条，query=线索: ${queryResult.length} 条`);

// ── 测试 5：PlanModeGuard.evaluate() ─────────────────────────────────────
console.log("[eval] 测试 5：PlanModeGuard.evaluate()...");
const guard = new PlanModeGuard();

// read → allow
const readTool = sampleTools.find((t) => t.name === "dealer.sales_query")!;
const readDecision = guard.evaluate(readTool, userWithReadPermission);
assert(readDecision.action === "allow", `read 工具应为 allow，实际 ${readDecision.action}`);

// write + 权限 → ask
const guardFull = new PlanModeGuard();
const writeTool = sampleTools.find((t) => t.name === "dealer.update_lead")!;
const writeDecision = guardFull.evaluate(writeTool, userWithFullPermission);
assert(writeDecision.action === "ask", `write 工具对全权限用户应为 ask，实际 ${writeDecision.action}`);

// write + 无权限 → deny
const writeNoPermDecision = guard.evaluate(writeTool, userWithReadPermission);
assert(writeNoPermDecision.action === "deny", `write 工具对无权限用户应为 deny，实际 ${writeNoPermDecision.action}`);
if (writeNoPermDecision.action === "deny") {
  assert(writeNoPermDecision.code === "permission_denied", `deny code 应为 permission_denied，实际 ${writeNoPermDecision.code}`);
}

// destructive → deny
const destructiveTool = sampleTools.find((t) => t.name === "maintenance.reset_workspace")!;
const destructiveDecision = guardFull.evaluate(destructiveTool, userWithFullPermission);
assert(destructiveDecision.action === "deny", `destructive 工具应为 deny，实际 ${destructiveDecision.action}`);

// plan_only → write 工具 deny
const guardPlanOnly = new PlanModeGuard({ plan_only: true });
const planOnlyDecision = guardPlanOnly.evaluate(writeTool, userWithFullPermission);
assert(planOnlyDecision.action === "deny", `Plan Only 模式下 write 工具应为 deny，实际 ${planOnlyDecision.action}`);
if (planOnlyDecision.action === "deny") {
  assert(planOnlyDecision.code === "plan_mode_write_blocked", `deny code 应为 plan_mode_write_blocked，实际 ${planOnlyDecision.code}`);
}

console.log("[eval] 测试 5 PASS");

// ── 测试 6：PlanModeGuard.toResult() ─────────────────────────────────────
console.log("[eval] 测试 6：PlanModeGuard.toResult()...");
const denyResult = guard.toResult(writeNoPermDecision, "dealer.update_lead");
assert(denyResult !== null, "deny decision 应返回非 null result");
assert(denyResult!["ok"] === false, "deny result ok 应为 false");
assert(denyResult!["code"] === "permission_denied", `deny result code 应为 permission_denied，实际 ${denyResult!["code"]}`);

const allowResult = guard.toResult({ action: "allow" }, "dealer.sales_query");
assert(allowResult === null, "allow decision 应返回 null");

console.log("[eval] 测试 6 PASS");

// ── 测试 7：OpenUI Lang Workbench Surface builders ─────────────────────
console.log("[eval] 测试 7：OpenUI Lang Workbench Surface builders...");

// ToolCatalogSurface
const catalogSurface = buildToolCatalogSurface("catalog_001", {
  catalog: result,
  plan_mode: false,
  user_name: "测试用户"
});
assert(catalogSurface.version === "v0.9", "envelope version 应为 v0.9");
assert(catalogSurface.createSurface?.surfaceId === "catalog_001", "surfaceId 应匹配");
assert(Array.isArray(catalogSurface.updateComponents?.components), "updateComponents.components 应为数组");
assert((catalogSurface.updateComponents?.components ?? []).length > 0, "components 不应为空");
console.log(`  ToolCatalogSurface: ${catalogSurface.updateComponents?.components?.length} 个组件`);

// RiskListSurface
const riskSurface = buildRiskListSurface("risk_001", [
  { id: "r1", type: "inventory", level: "high", title: "库存超龄", description: "A01 店有 15 台超龄车辆需处理", action: "查看详情" },
  { id: "r2", type: "lead", level: "medium", title: "线索清零风险", description: "华南区本月线索低于目标 20%" }
]);
assert(riskSurface.version === "v0.9", "RiskListSurface version 应为 v0.9");
console.log(`  RiskListSurface: ${riskSurface.updateComponents?.components?.length} 个组件`);

// MetricCardsSurface
const metricsSurface = buildMetricCardsSurface("metrics_001", [
  { key: "lead_count", label: "本月线索数", value: 1234, unit: "条", change: 12.5, change_type: "mom", trend: "up" },
  { key: "gross_profit", label: "毛利额", value: 890000, unit: "元", change: -3.2, change_type: "yoy", trend: "down" }
], "华南区经营指标");
assert(metricsSurface.version === "v0.9", "MetricCardsSurface version 应为 v0.9");
console.log(`  MetricCardsSurface: ${metricsSurface.updateComponents?.components?.length} 个组件`);

// EvidenceSurface
const evidenceSurface = buildEvidenceSurface("evidence_001", {
  tool_name: "dealer.sales_query",
  query_filters: [{ field: "store_id", op: "=", value: "store_001" }, { field: "date", op: ">=", value: "2024-01-01" }],
  source_refs: ["dealer_crm", "dealer_finance"],
  result_preview: "华南区 2024 年 1 月销量 1234 台，同比增长 12%",
  rows_count: 45
});
assert(evidenceSurface.version === "v0.9", "EvidenceSurface version 应为 v0.9");
console.log(`  EvidenceSurface: ${evidenceSurface.updateComponents?.components?.length} 个组件`);

// PendingActionSurface
const pendingSurface = buildPendingActionSurface("pending_001", [
  { action_id: "act_001", tool_name: "dealer.update_lead", description: "将线索 L001 标记为已跟进", args_preview: '{"lead_id": "L001", "status": "followed_up"}', risk_level: "write" }
]);
assert(pendingSurface.version === "v0.9", "PendingActionSurface version 应为 v0.9");
console.log(`  PendingActionSurface: ${pendingSurface.updateComponents?.components?.length} 个组件`);

// TaskTrackingSurface
const taskSurface = buildTaskTrackingSurface("tasks_001", [
  { id: "t1", subject: "Q2 线索提升专项", status: "active", next_action: "与销售团队对齐本周 action", type: "task" },
  { id: "t2", subject: "每日经营日报", status: "active", type: "cron" }
]);
assert(taskSurface.version === "v0.9", "TaskTrackingSurface version 应为 v0.9");
console.log(`  TaskTrackingSurface: ${taskSurface.updateComponents?.components?.length} 个组件`);

console.log("[eval] 测试 7 PASS");

// ── 汇总 ──────────────────────────────────────────────────────────────────
console.log("\n✓ PASS tool-catalog eval");
console.log(`  ToolCatalog: ${result.total} 个工具，${result.domains.length} 个业务域`);
console.log(`  权限过滤: allow=${resultFullPerms.plan_mode_allowed.length}, ask=${resultFullPerms.ask_tools.length}, deny=${resultFullPerms.deny_tools.length}`);
console.log(`  Plan Mode: allow=${resultPlanMode.plan_mode_allowed.length}, deny=${resultPlanMode.deny_tools.length}`);
console.log(`  OpenUI Lang Workbench: 6 个 Surface builder 全部通过`);

// ── 工具函数 ─────────────────────────────────────────────────────────────

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`[FAIL] ${message}`);
}
