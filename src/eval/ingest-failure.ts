import { BusinessQueryEngine } from "../runtime/business-query-engine.js";
import { RuntimeHooks } from "../runtime/hooks.js";
import type { JsonObject, UserContext } from "../types/agent-contracts.js";

/**
 * 验证 enterpriseContextProvider 抛错时：
 *   - BusinessQueryEngine 不挂掉，继续 assemble + run
 *   - context_ingest 事件携带 error 字段 + degraded=true
 *   - run 返回的 answer 仍然能拿到
 *
 * 这是企业生产路径的关键韧性：上游 CRM/IM 拉数据偶发抖动时，agent 不能跟着挂。
 */
async function main(): Promise<void> {
  const hooks = new RuntimeHooks();
  const ingestEvents: JsonObject[] = [];
  hooks.on("context_ingest", async (event) => { ingestEvents.push(event); });

  const fakeUser: UserContext = {
    id: "u_ingest_fail",
    role: "dealer_sales",
    permissions: ["business_query"],
    accessible_customer_ids: []
  };

  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => { warnings.push(args.map((a) => String(a)).join(" ")); };

  try {
    const engine = new BusinessQueryEngine({
      agent: {
        run: async () => ({ session_id: "s1", run_id: "r1", answer: "fallback answer" })
      },
      userContextResolver: {
        resolve: async () => fakeUser
      },
      enterpriseContextProvider: {
        load: async () => { throw new Error("CRM upstream timeout"); }
      },
      hooks
    });

    const result = await engine.submitMessage({ userId: "u_ingest_fail", message: "今日库存" });

    assert(result.answer === "fallback answer", `engine should still return answer, got "${result.answer}"`);
    assert(ingestEvents.length === 1, `expected 1 ingest event, got ${ingestEvents.length}`);
    const ingest = ingestEvents[0];
    assert(ingest.degraded === true, "ingest event should mark degraded=true");
    const err = ingest.error as JsonObject;
    assert(err && err.message === "CRM upstream timeout", `ingest event should carry error message, got ${JSON.stringify(err)}`);
    assert(warnings.some((w) => w.includes("CRM upstream timeout")), "engine should warn on ingest failure");

    // sanity: a successful provider should produce degraded=false
    const ingestEvents2: JsonObject[] = [];
    const hooks2 = new RuntimeHooks();
    hooks2.on("context_ingest", async (event) => { ingestEvents2.push(event); });
    const engine2 = new BusinessQueryEngine({
      agent: { run: async () => ({ answer: "ok" }) },
      userContextResolver: { resolve: async () => fakeUser },
      enterpriseContextProvider: { load: async () => ({ admin: [] }) },
      hooks: hooks2
    });
    await engine2.submitMessage({ userId: "u_ingest_fail", message: "x" });
    assert(ingestEvents2[0].degraded === false, "successful ingest should be degraded=false");
    assert(ingestEvents2[0].error === null, "successful ingest should have null error");

    console.log("PASS ingest failure fallback (engine survives, event marks degraded, success path unaffected)");
  } finally {
    console.warn = originalWarn;
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
