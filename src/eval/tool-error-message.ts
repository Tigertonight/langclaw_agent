import { rm } from "node:fs/promises";
import { resolveProjectPath } from "../data/load-json.js";
import { resolveUserWorkspace } from "../runtime/workspace-context.js";
import { ToolRegistry } from "../tools/registry.js";
import { createSandboxTools } from "../tools/sandbox-tools.js";
import { createPluginTools } from "../tools/plugin-tools.js";
import { createTaskTools } from "../tasks/tools.js";
import type { ToolDefinition, ToolResult } from "../types/agent-contracts.js";

const workspace = resolveUserWorkspace(`eval_msg_${Date.now()}`);
const failures: string[] = [];

try {
  const baseTools = [
    ...createSandboxTools(),
    ...createPluginTools(),
    ...createTaskTools()
  ];

  // Stub tool for confirmation_required + execute_failed
  const confirmTool: ToolDefinition = {
    name: "task.create",
    description: "stub overridden for confirmation test",
    schema: { type: "object", properties: {}, additionalProperties: true } as never,
    metadata: { requires_confirmation: true, risk_level: "write" },
    execute: async () => ({ ok: true })
  };
  const failingTool: ToolDefinition = {
    name: "runtime.intentionally_failing",
    description: "always throws",
    schema: { type: "object", properties: {}, additionalProperties: true } as never,
    metadata: {},
    execute: async () => { throw new Error("数据库连接超时"); }
  };

  const registry = new ToolRegistry(baseTools);
  const overrideRegistry = new ToolRegistry([...baseTools, confirmTool, failingTool]);
  const context = { user: { id: workspace.user_id, role: "employee", permissions: [], accessible_customer_ids: [] }, workspace };

  // 1. invalid_input - missing required: 必填项措辞
  await expectMessage(
    "missing required uses 必填项",
    await registry.execute({ name: "task.create", args: { goal: "hello" } }, context),
    /创建任务：请填写"标题"：必填项/
  );

  // 2. invalid_input - bad enum lists options
  await expectMessage(
    "bad enum lists options",
    await registry.execute({ name: "task.create", args: { title: "x", priority: "urgent" } }, context),
    /"优先级" 只能是：high \/ medium \/ low/
  );

  // 3. invalid_input - too_big shows max
  await expectMessage(
    "too_big shows max",
    await registry.execute({ name: "safe_compute", args: { code: "1+1", timeout_ms: 99999 } }, context),
    /"超时时间\(毫秒\)" 不能大于 3000/
  );

  // 4. invalid_input - unrecognized_keys names key
  await expectMessage(
    "unrecognized_keys names key",
    await registry.execute({ name: "safe_compute", args: { code: "1+1", evil: true } }, context),
    /不支持的字段："evil"/
  );

  // 5. invalid_input - invalid_format regex
  await expectMessage(
    "invalid_format says 格式不对",
    await registry.execute({ name: "runtime.plugin.config", args: { plugin: "has space!", config: {} } }, context),
    /"插件" 格式不对/
  );

  // 6. unknown_tool
  await expectMessage(
    "unknown_tool message",
    await registry.execute({ name: "no_such_tool", args: {} }, context),
    /工具"no_such_tool"不存在/
  );

  // 7. confirmation_required
  await expectMessage(
    "confirmation_required message",
    await overrideRegistry.execute({ name: "task.create", args: {} }, context),
    /操作"创建任务"需要您确认后才会执行/
  );

  // 8. execute_failed
  await expectMessage(
    "execute_failed message",
    await overrideRegistry.execute({ name: "runtime.intentionally_failing", args: {} }, context),
    /执行"runtime.intentionally_failing"时出错：数据库连接超时/
  );

  if (failures.length > 0) {
    console.error(`FAIL tool error message: ${failures.length} failures`);
    for (const message of failures) console.error(` - ${message}`);
    process.exitCode = 1;
  } else {
    console.log("PASS tool error message");
  }
} finally {
  await rm(resolveProjectPath("users", workspace.user_id), { recursive: true, force: true });
}

async function expectMessage(label: string, result: unknown, pattern: RegExp): Promise<void> {
  const r = result as ToolResult | undefined;
  if (!r || r.ok !== false) {
    failures.push(`${label}: expected error result, got ${JSON.stringify(r)}`);
    return;
  }
  if (!pattern.test(r.message ?? "")) {
    failures.push(`${label}: message did not match ${pattern} — got "${r.message}"`);
  }
}
