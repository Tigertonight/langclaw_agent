import { IntentRegistry } from "../router/intent-registry.js";
import { IntentRouter } from "../router/intent-router.js";
import { DEFAULT_COMMANDS } from "../router/default-commands.js";

async function main(): Promise<void> {
  const registry = new IntentRegistry({ dir: "data/intent-codes" });
  const router = new IntentRouter({ registry });
  router.commands.registerAll(DEFAULT_COMMANDS);

  // 命中预期：每条命令都能落到对应 intent_code
  const cases: Array<{ message: string; expectIntent: string; expectCommandId: string }> = [
    { message: "/help", expectIntent: "system.smalltalk", expectCommandId: "help" },
    { message: "帮助", expectIntent: "system.smalltalk", expectCommandId: "help" },
    { message: "/今日订单", expectIntent: "dealer.query.sales_orders", expectCommandId: "today_orders" },
    { message: "/库存预警", expectIntent: "dealer.query.inventory", expectCommandId: "inventory_alert" },
    { message: "/我的线索", expectIntent: "dealer.query.leads", expectCommandId: "my_leads" },
    { message: "/三包", expectIntent: "dealer.query.warranty_claims", expectCommandId: "warranty_claims" }
  ];

  for (const c of cases) {
    const result = router.tryRegisteredCommand({ message: c.message });
    assert(result !== null, `command "${c.message}" should match`);
    assert(result?.commandId === c.expectCommandId, `command "${c.message}" should match commandId ${c.expectCommandId}, got ${result?.commandId}`);
    assert(result?.route.intent_code === c.expectIntent, `command "${c.message}" should produce intent ${c.expectIntent}, got ${result?.route.intent_code}`);
    assert(result?.route.confidence === "high", `command "${c.message}" route should have confidence=high`);
  }

  // 不命中：常规问题不应被命令拦截
  for (const text of ["你好", "查一下汉EV库存", "今天天气怎么样", "/unknown_command"]) {
    const result = router.tryRegisteredCommand({ message: text });
    assert(result === null, `non-command "${text}" should not match registered commands`);
  }

  // 空字符串/null 防御
  assert(router.tryRegisteredCommand({ message: "" }) === null, "empty message should not match");
  assert(router.tryRegisteredCommand({ message: "   " }) === null, "whitespace-only should not match");

  console.log(`PASS router commands (${cases.length} positive + 5 negative cases)`);
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
