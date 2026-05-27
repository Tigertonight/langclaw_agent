import { BusinessQueryEngine } from "../runtime/business-query-engine.js";
import { RuntimeHooks } from "../runtime/hooks.js";
import type { JsonObject, UserContext } from "../types/agent-contracts.js";

/**
 * 验证 context_ingest hook：在 enterpriseContextProvider.load() 完成、
 * ContextAssembler.assemble() 之前触发，并携带 ingest 来源摘要。
 *
 * 同时验证 stage 字段为 "ingest"，以便监听方区分阶段。
 */
async function main(): Promise<void> {
  const hooks = new RuntimeHooks();
  const captured: JsonObject[] = [];
  const order: string[] = [];

  hooks.on("context_ingest", async (event) => {
    captured.push(event);
    order.push("ingest");
  });
  hooks.on("context_assembly", async () => {
    order.push("assembly");
  });

  const fakeUser: UserContext = {
    id: "smoke_user",
    role: "dealer_sales",
    permissions: ["business_query"],
    accessible_customer_ids: []
  };

  const engine = new BusinessQueryEngine({
    agent: {
      run: async () => ({ session_id: "s1", run_id: "r1", answer: "ok" })
    },
    userContextResolver: {
      resolve: async () => fakeUser
    },
    enterpriseContextProvider: {
      load: async () => ({
        admin: [{ name: "policy_a" }, { name: "policy_b" }],
        user_memory: { recall: "previous chat" },
        tasks: { active: [{ id: "t1" }] },
        memory: { relevant: [] },
        workspace: { user_id: "smoke_user" }
      })
    },
    hooks
  });

  await engine.submitMessage({ userId: "smoke_user", message: "hi" });

  assert(captured.length === 1, `expected 1 ingest event, got ${captured.length}`);
  const ingest = captured[0];
  assert(ingest.stage === "ingest", `stage should be "ingest", got ${ingest.stage}`);
  assert(ingest.user_id === "smoke_user", "user_id should be carried through");
  assert(typeof ingest.run_id === "string" && ingest.run_id.length > 0, "run_id should be set");

  const sources = ingest.sources as JsonObject;
  assert(typeof sources === "object" && sources !== null, "sources should be an object");
  const admin = sources.admin as JsonObject;
  assert(admin && admin.kind === "array" && admin.count === 2, `admin should be array of 2, got ${JSON.stringify(admin)}`);
  const userMemory = sources.user_memory as JsonObject;
  assert(userMemory && userMemory.kind === "object", `user_memory should be described as object, got ${JSON.stringify(userMemory)}`);

  // 顺序：ingest 必须在 assembly 之前
  assert(order.length === 2, `expected 2 hook events in order, got ${order.length}`);
  assert(order[0] === "ingest", `first hook should be ingest, got ${order[0]}`);
  assert(order[1] === "assembly", `second hook should be assembly, got ${order[1]}`);

  console.log("PASS context ingest hook (fires once before assembly with source summary)");
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
