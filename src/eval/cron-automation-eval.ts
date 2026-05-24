/**
 * Phase 5.3 eval: cron-automation-eval
 *
 * 测试场景：
 *   1. CRON_TEMPLATES 有 5 个预置模板
 *   2. filterTemplates by domain 过滤正确
 *   3. filterTemplates by tag 过滤正确
 *   4. filterTemplates by q 关键字过滤正确
 *   5. applyTemplate 生成合法的 create 入参
 *   6. cron.templates 工具返回全量模板
 *   7. cron.templates 工具支持 domain 过滤
 *   8. cron.apply_template 工具基于模板创建 spec
 *   9. cron.apply_template 传未知 template_id 返回 error
 *  10. cron.status 返回 spec + state + history
 *
 * 全部本地，不联网。
 */

import { rm } from "node:fs/promises";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { UserCronStore } from "../cron/user-cron-store.js";
import {
  CRON_TEMPLATES,
  findTemplate,
  filterTemplates,
  applyTemplate
} from "../cron/cron-templates.js";
import { createCronTools } from "../tools/cron-tools.js";
import { resolveProjectPath } from "../data/load-json.js";

const TEST_USER = `eval_cron_auto_${Date.now()}`;
const workspace = resolveUserWorkspace(TEST_USER);
const ctx = { user: { id: TEST_USER, name: TEST_USER, role: "eval", department: "" }, workspace };

let passed = 0;
let failed = 0;

function assert(cond: boolean, label: string): void {
  if (cond) {
    console.log(`  PASS [${passed + failed + 1}] ${label}`);
    passed++;
  } else {
    console.error(`  FAIL [${passed + failed + 1}] ${label}`);
    failed++;
  }
}

function assertEqual<T>(a: T, b: T, label: string): void {
  if (a === b) {
    console.log(`  PASS [${passed + failed + 1}] ${label}`);
    passed++;
  } else {
    console.error(`  FAIL [${passed + failed + 1}] ${label} — expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
    failed++;
  }
}

async function main(): Promise<void> {
  const cronStore = new UserCronStore();
  const tools = createCronTools({ cronStore });

  /* ─── Test 1: CRON_TEMPLATES 数量 ─── */
  assertEqual(CRON_TEMPLATES.length, 5, "CRON_TEMPLATES 有 5 个预置模板");

  /* ─── Test 2: filterTemplates by domain ─── */
  {
    const salesTemplates = filterTemplates({ domain: "dealer_sales" });
    assert(salesTemplates.length >= 1, "dealer_sales 域至少 1 个模板");
    assert(salesTemplates.every((t) => t.domain === "dealer_sales"), "dealer_sales 过滤结果全部是 dealer_sales 域");
  }

  /* ─── Test 3: filterTemplates by tag ─── */
  {
    const dailyTemplates = filterTemplates({ tag: "daily" });
    assert(dailyTemplates.length >= 3, "daily 标签至少 3 个模板");
    assert(dailyTemplates.every((t) => t.tags.includes("daily")), "daily 过滤结果全部包含 daily 标签");
  }

  /* ─── Test 4: filterTemplates by q 关键字 ─── */
  {
    const financeTemplates = filterTemplates({ q: "财务" });
    assert(financeTemplates.length >= 1, "关键字'财务'至少匹配 1 个模板");
    assert(financeTemplates.some((t) => t.id === "finance_anomaly_daily"), "关键字'财务'匹配到 finance_anomaly_daily");
  }

  /* ─── Test 5: applyTemplate 生成合法 create 入参 ─── */
  {
    const template = findTemplate("daily_sales_report")!;
    assert(Boolean(template), "findTemplate('daily_sales_report') 不为 null");
    const input = applyTemplate(template, TEST_USER);
    assertEqual(input.user_id, TEST_USER, "applyTemplate user_id 正确");
    assertEqual(input.cron_expr, "0 9 * * *", "applyTemplate cron_expr 正确");
    assert(typeof input.task === "string" && input.task.length > 0, "applyTemplate task 非空");
    assert(input.max_steps !== undefined && input.max_steps > 0, "applyTemplate max_steps 正确");
  }

  /* ─── Test 6: cron.templates 工具返回全量模板 ─── */
  {
    const templatesTool = tools.find((t) => t.name === "cron.templates")!;
    assert(Boolean(templatesTool), "cron.templates 工具存在");
    const result = await templatesTool.execute({}, ctx) as Record<string, unknown>;
    assert(result.ok === true, "cron.templates 返回 ok=true");
    const data = result.data as Record<string, unknown>;
    assertEqual(data.count as number, 5, "cron.templates 返回 5 个模板");
    const templates = data.templates as Array<Record<string, unknown>>;
    assert(Array.isArray(templates), "cron.templates.data.templates 是数组");
    assert(templates.every((t) => typeof t.id === "string" && typeof t.cron_expr === "string"), "每个模板有 id 和 cron_expr");
  }

  /* ─── Test 7: cron.templates 支持 domain 过滤 ─── */
  {
    const templatesTool = tools.find((t) => t.name === "cron.templates")!;
    const result = await templatesTool.execute({ domain: "dealer_finance" }, ctx) as Record<string, unknown>;
    assert(result.ok === true, "cron.templates?domain=dealer_finance ok=true");
    const data = result.data as Record<string, unknown>;
    const templates = data.templates as Array<Record<string, unknown>>;
    assert(Array.isArray(templates) && templates.length >= 1, "dealer_finance 域至少 1 个模板");
    assert(templates.every((t) => t.domain === "dealer_finance"), "过滤结果全部 dealer_finance 域");
  }

  /* ─── Test 8: cron.apply_template 基于模板创建 spec ─── */
  {
    const applyTool = tools.find((t) => t.name === "cron.apply_template")!;
    assert(Boolean(applyTool), "cron.apply_template 工具存在");
    const result = await applyTool.execute({ template_id: "inventory_risk_check" }, ctx) as Record<string, unknown>;
    assert(result.ok === true, `cron.apply_template ok=true（实际: ${JSON.stringify(result)}）`);
    const data = result.data as Record<string, unknown>;
    assert(typeof data.spec_id === "string" && (data.spec_id as string).startsWith("cron_"), "cron.apply_template 返回 spec_id");
    assertEqual(data.cron_expr as string, "0 10 * * *", "cron.apply_template 继承模板 cron_expr");
    const template = data.template as Record<string, unknown>;
    assertEqual(template?.id as string, "inventory_risk_check", "cron.apply_template 返回模板摘要");

    // 验证 cron.list 能看到新建的 spec
    const listTool = tools.find((t) => t.name === "cron.list")!;
    const listResult = await listTool.execute({}, ctx) as Record<string, unknown>;
    assert(listResult.ok === true, "cron.list ok=true");
    const listData = listResult.data as Record<string, unknown>;
    assert((listData.count as number) >= 1, "cron.list 至少 1 条 spec");
  }

  /* ─── Test 9: cron.apply_template 传未知 template_id 返回 error ─── */
  {
    const applyTool = tools.find((t) => t.name === "cron.apply_template")!;
    const result = await applyTool.execute({ template_id: "nonexistent_template_xyz" }, ctx) as Record<string, unknown>;
    assert(result.ok === false, "未知 template_id 时 ok=false");
    assertEqual(result.error as string, "template_not_found", "未知 template_id 时 error=template_not_found");
    assert(typeof result.message === "string" && (result.message as string).includes("可用"), "错误消息包含可用模板列表");
  }

  /* ─── Test 10: cron.status 返回 spec + state + history ─── */
  {
    // 先获取刚创建的 spec_id
    const listTool = tools.find((t) => t.name === "cron.list")!;
    const listResult = await listTool.execute({}, ctx) as Record<string, unknown>;
    const specs = (listResult.data as Record<string, unknown>).specs as Array<Record<string, unknown>>;
    const specId = specs[0]?.id as string;
    assert(typeof specId === "string", "有可用的 spec_id 供 status 测试");

    const statusTool = tools.find((t) => t.name === "cron.status")!;
    assert(Boolean(statusTool), "cron.status 工具存在");
    const result = await statusTool.execute({ spec_id: specId }, ctx) as Record<string, unknown>;
    assert(result.ok === true, `cron.status ok=true（实际: ${JSON.stringify(result)}）`);
    const data = result.data as Record<string, unknown>;
    assert(typeof (data.spec as Record<string, unknown>)?.id === "string", "cron.status 返回 spec.id");
    assert(typeof (data.state as Record<string, unknown>)?.paused === "boolean", "cron.status 返回 state.paused");
    assert(Array.isArray(data.history), "cron.status 返回 history 数组");
  }

  console.log(`\ncron-automation-eval: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => rm(resolveProjectPath("users", TEST_USER), { recursive: true, force: true }));
