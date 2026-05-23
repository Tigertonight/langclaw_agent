import { ToolRegistry } from "../tools/registry.js";
import { defineTool, z, ToolResultBaseSchema } from "../tools/zod-helpers.js";
import type { ToolResult } from "../types/agent-contracts.js";

const failures: string[] = [];

const slowTool = defineTool({
  name: "runtime.test.slow",
  description: "sleeps for the requested ms before returning",
  metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "read" },
  inputSchema: z.object({ ms: z.number().int().min(0).max(60_000) }).strict(),
  outputSchema: ToolResultBaseSchema,
  async execute(args, context) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, args.ms);
      context?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      }, { once: true });
    });
    return { ok: true, tool: "runtime.test.slow", data: { slept_ms: args.ms } };
  }
});

const slowToolWithMeta = defineTool({
  name: "runtime.test.slow_meta",
  description: "same as runtime.test.slow but with explicit metadata.timeout_ms = 200",
  metadata: { required_permissions: [], expose_to_agentic: true, risk_level: "read", timeout_ms: 200 },
  inputSchema: z.object({ ms: z.number().int().min(0).max(60_000) }).strict(),
  outputSchema: ToolResultBaseSchema,
  async execute(args, context) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, args.ms);
      context?.signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      }, { once: true });
    });
    return { ok: true, tool: "runtime.test.slow_meta", data: { slept_ms: args.ms } };
  }
});

const registry = new ToolRegistry([slowTool, slowToolWithMeta], { defaultTimeoutMs: 300 });

const ctx = { user: { id: "test", role: "employee", permissions: [], accessible_customer_ids: [] } };

// Case 1: tool sleeps 1000ms with 300ms default → must timeout
const start1 = Date.now();
const r1 = await registry.execute({ name: "runtime.test.slow", args: { ms: 1000 } }, ctx) as ToolResult;
const elapsed1 = Date.now() - start1;
if (r1.ok !== false || r1.error !== "execute_timeout") {
  failures.push(`case 1: expected execute_timeout, got ${JSON.stringify(r1)}`);
}
if (elapsed1 > 700) {
  failures.push(`case 1: timeout took ${elapsed1}ms, should fire near 300ms`);
}

// Case 2: tool sleeps 50ms < 300ms → must succeed
const r2 = await registry.execute({ name: "runtime.test.slow", args: { ms: 50 } }, ctx) as ToolResult;
if (r2.ok !== true) {
  failures.push(`case 2: expected ok=true, got ${JSON.stringify(r2)}`);
}

// Case 3: metadata.timeout_ms=200 should override default
const start3 = Date.now();
const r3 = await registry.execute({ name: "runtime.test.slow_meta", args: { ms: 1000 } }, ctx) as ToolResult;
const elapsed3 = Date.now() - start3;
if (r3.ok !== false || r3.error !== "execute_timeout") {
  failures.push(`case 3: expected execute_timeout, got ${JSON.stringify(r3)}`);
}
if (elapsed3 > 500) {
  failures.push(`case 3: per-tool timeout took ${elapsed3}ms, should fire near 200ms`);
}

// Case 4: parent signal aborts → tool aborts with execute_failed (or timeout if treated)
const parentAc = new AbortController();
setTimeout(() => parentAc.abort(new Error("parent_canceled")), 100);
const r4 = await registry.execute({ name: "runtime.test.slow", args: { ms: 1000 } }, { ...ctx, signal: parentAc.signal }) as ToolResult;
if (r4.ok !== false) {
  failures.push(`case 4: expected ok=false on parent abort, got ${JSON.stringify(r4)}`);
}

if (failures.length > 0) {
  console.error(`FAIL tool timeout: ${failures.length} failures`);
  for (const f of failures) console.error(` - ${f}`);
  process.exitCode = 1;
} else {
  console.log("PASS tool timeout (4 cases)");
}
