/**
 * Phase 7 eval: gateway-eval
 *
 * 测试场景：
 *   1. ChannelAdapterRegistry 注册和查找 adapter
 *   2. WebChannelAdapter normalize 成功
 *   3. WebChannelAdapter normalize 失败（缺 user_id）
 *   4. WebhookChannelAdapter normalize 成功
 *   5. WeComChannelAdapter isAvailable=false（无凭证时）
 *   6. FeishuChannelAdapter isAvailable=false（无凭证时）
 *   7. CronChannelAdapter normalize cron 触发事件
 *   8. CronChannelAdapter deliverCronResult 通过 sink
 *   9. EnterpriseGateway handleRaw（mock QueryEngine）
 *  10. EnterpriseGateway 写审计 JSONL
 *
 * 全部本地，不联网，QueryEngine 全 mock。
 */

import { rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { resolveProjectPath } from "../data/load-json.js";
import { ChannelAdapterRegistry } from "../gateway/channel-adapter.js";
import { EnterpriseGateway } from "../gateway/gateway.js";
import { WebChannelAdapter } from "../gateway/channels/web.js";
import { WebhookChannelAdapter } from "../gateway/channels/webhook.js";
import { WeComChannelAdapter } from "../gateway/channels/wecom.js";
import { FeishuChannelAdapter } from "../gateway/channels/feishu.js";
import { CronChannelAdapter } from "../gateway/channels/cron.js";
import type { BusinessQueryEngine } from "../runtime/business-query-engine.js";
import type { GatewayOutbound } from "../gateway/types.js";

const TEST_USER = `eval_gateway_${Date.now()}`;
const workspace = resolveUserWorkspace(TEST_USER);

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

/** Mock QueryEngine */
function createMockQueryEngine(answer = "这是测试回复"): BusinessQueryEngine {
  return {
    submitMessage: async () => ({
      session_id: "mock_session",
      run_id: "mock_run",
      answer,
      output: answer,
      trace: {},
      context_budget: {}
    })
  } as unknown as BusinessQueryEngine;
}

async function main(): Promise<void> {
  /* ─── Test 1: ChannelAdapterRegistry 注册和查找 ─── */
  {
    const registry = new ChannelAdapterRegistry();
    const webAdapter = new WebChannelAdapter();
    const registered = registry.register(webAdapter);
    assert(registered, "WebChannelAdapter 注册成功（isAvailable=true）");
    const found = registry.get("web");
    assert(found !== null && found.channelName === "web", "注册后可按 channelName 查找");
    const missing = registry.get("nonexistent");
    assert(missing === null, "不存在的 channelName 返回 null");
    assertEqual(registry.listChannels().length, 1, "listChannels 返回 1 个 channel");
  }

  /* ─── Test 2: WebChannelAdapter normalize 成功 ─── */
  {
    const adapter = new WebChannelAdapter();
    const inbound = adapter.normalize({ user_id: "user_001", message: "查询今日库存", session_id: "sess_abc" });
    assert(inbound !== null, "WebChannelAdapter normalize 成功");
    assertEqual(inbound!.channel, "web", "channel=web");
    assertEqual(inbound!.user_id, "user_001", "user_id 正确");
    assertEqual(inbound!.text, "查询今日库存", "text 正确");
    assertEqual(inbound!.session_id, "sess_abc", "session_id 正确");
  }

  /* ─── Test 3: WebChannelAdapter normalize 失败（缺 user_id） ─── */
  {
    const adapter = new WebChannelAdapter();
    const inbound = adapter.normalize({ message: "查询今日库存" }); // 缺 user_id
    assert(inbound === null, "normalize 缺 user_id 时返回 null");
    const inbound2 = adapter.normalize({ user_id: "u1", message: "" }); // 空 message
    assert(inbound2 === null, "normalize 空 message 时返回 null");
  }

  /* ─── Test 4: WebhookChannelAdapter normalize 成功 ─── */
  {
    const adapter = new WebhookChannelAdapter({ channelName: "pingcode" });
    assertEqual(adapter.channelName, "pingcode", "自定义 channelName 生效");
    const inbound = adapter.normalize({
      user_id: "agent_007",
      text: "PingCode 触发告警",
      message_id: "msg_xxx",
      metadata: { source: "ci_pipeline" }
    });
    assert(inbound !== null, "WebhookChannelAdapter normalize 成功");
    assertEqual(inbound!.user_id, "agent_007", "webhook user_id 正确");
    assertEqual(inbound!.message_id, "msg_xxx", "webhook message_id 正确");
  }

  /* ─── Test 5: WeComChannelAdapter isAvailable=false（无凭证） ─── */
  {
    const adapter = new WeComChannelAdapter({ corpId: "", agentSecret: "", agentId: "" });
    assert(!adapter.isAvailable(), "WeComChannelAdapter 无凭证时 isAvailable=false");
    // 不注册到 registry（isAvailable=false）
    const registry = new ChannelAdapterRegistry();
    const result = registry.register(adapter);
    assert(!result, "无凭证 adapter 注册返回 false");
    assert(registry.get("wecom") === null, "无凭证 adapter 不出现在 registry");
  }

  /* ─── Test 6: FeishuChannelAdapter isAvailable=false（无凭证） ─── */
  {
    const adapter = new FeishuChannelAdapter({ appId: "", appSecret: "" });
    assert(!adapter.isAvailable(), "FeishuChannelAdapter 无凭证时 isAvailable=false");
  }

  /* ─── Test 7: CronChannelAdapter normalize cron 触发事件 ─── */
  {
    const adapter = new CronChannelAdapter();
    assert(adapter.isAvailable(), "CronChannelAdapter isAvailable=true");
    const cronPayload = {
      spec: {
        id: "cron_test_001",
        user_id: "dealer_user",
        cron_expr: "0 9 * * *",
        task: "生成每日销售日报",
        enabled: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      entry: {
        spec_id: "cron_test_001",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status: "ok" as const,
        duration_ms: 3200,
        summary: "日报生成成功：昨日成交 18 台"
      }
    };
    const inbound = adapter.normalize(cronPayload);
    assert(inbound !== null, "CronChannelAdapter normalize 成功");
    assertEqual(inbound!.channel, "cron", "channel=cron");
    assertEqual(inbound!.user_id, "dealer_user", "user_id 来自 spec.user_id");
  }

  /* ─── Test 8: CronChannelAdapter deliverCronResult 通过 sink ─── */
  {
    const deliveredMessages: GatewayOutbound[] = [];
    const adapter = new CronChannelAdapter({
      deliverSink: async (outbound) => {
        deliveredMessages.push(outbound);
        return { ok: true };
      }
    });
    const result = await adapter.deliverCronResult(
      {
        id: "cron_002",
        user_id: "sales_mgr",
        cron_expr: "0 10 * * *",
        task: "库存风险巡检",
        enabled: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      },
      {
        spec_id: "cron_002",
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        status: "ok",
        duration_ms: 2100,
        summary: "发现 3 辆滞销车型，库龄均超 90 天"
      }
    );
    assert(result.ok === true, "CronChannelAdapter deliverCronResult ok=true");
    assert(deliveredMessages.length === 1, "sink 被调用 1 次");
    assert(deliveredMessages[0].user_id === "sales_mgr", "outbound user_id 正确");
    assert(deliveredMessages[0].text.includes("✅"), "outbound text 包含状态 emoji");
  }

  /* ─── Test 9: EnterpriseGateway handleRaw（mock QueryEngine） ─── */
  {
    const queryEngine = createMockQueryEngine("库存查询结果：当前在库 200 辆");
    const gateway = new EnterpriseGateway({
      queryEngine,
      now: () => new Date("2025-05-01T09:00:00Z")
    });
    // 注册 WebChannelAdapter
    const webAdapter = new WebChannelAdapter();
    gateway.register(webAdapter);
    const result = await gateway.handleRaw("web", {
      user_id: TEST_USER,
      message: "查询今日库存",
      session_id: "test_sess"
    });
    assert(result.ok === true, "EnterpriseGateway handleRaw ok=true");
    assertEqual(result.channel, "web", "handleRaw channel=web");
    assertEqual(result.user_id, TEST_USER, "handleRaw user_id 正确");
    assert(typeof result.answer === "string" && result.answer.includes("库存"), "answer 来自 mock QueryEngine");
    assert(result.delivered === true, "WebChannelAdapter deliver ok → delivered=true");
  }

  /* ─── Test 10: EnterpriseGateway 写审计 JSONL ─── */
  {
    const auditPath = path.join(workspace.root, "logs", "gateway", "audit.jsonl");
    // handleRaw 已在 Test 9 写了一条审计
    // 等待写入完成（process 周期）
    await new Promise((r) => setTimeout(r, 50));
    assert(existsSync(auditPath), "审计文件 audit.jsonl 已创建");
    const content = await readFile(auditPath, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    assert(lines.length >= 1, `audit.jsonl 至少 1 条记录（实际 ${lines.length}）`);
    const firstEntry = JSON.parse(lines[0]) as Record<string, unknown>;
    assertEqual(firstEntry.channel as string, "web", "审计记录 channel=web");
    assertEqual(firstEntry.direction as string, "inbound", "审计记录 direction=inbound");
    assert(typeof firstEntry.user_id === "string", "审计记录有 user_id");
  }

  console.log(`\ngateway-eval: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main()
  .catch((err) => { console.error(err); process.exit(1); })
  .finally(() => rm(resolveProjectPath("users", TEST_USER), { recursive: true, force: true }));
