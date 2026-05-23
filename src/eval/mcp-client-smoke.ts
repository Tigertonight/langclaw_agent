import { existsSync } from "node:fs";
import { McpRegistry } from "../mcp/registry.js";
import type { ToolDefinition } from "../types/agent-contracts.js";

/**
 * §7 MCP integration smoke：
 *   - 用 src/eval/fixtures/mcp-fixture-server.ts（编译产物）作为本地 stdio server
 *   - 验证 McpRegistry 能拉到 tool 列表 + 名字加上 mcp.<id>. 前缀
 *   - 验证 callTool 正常路径 / structuredContent / isError 路径
 *   - 验证 stop() 干净退出
 *
 * 不依赖联网。fixture 路径走 dist 编译产物，跟 batch-2 regression 走同一条 build。
 */

const FIXTURE_PATH = "dist/eval/fixtures/mcp-fixture-server.js";

async function main(): Promise<void> {
  if (!existsSync(FIXTURE_PATH)) {
    throw new Error(`fixture build missing: ${FIXTURE_PATH}. 先跑 npm run build:ts。`);
  }

  await section1Registration();
  await section2Calls();
  await section3MissingServer();
  console.log("mcp:smoke OK");
}

/** §1 启动 fixture server，校验工具被以 mcp.fixture.<name> 注册 */
async function section1Registration(): Promise<void> {
  const registry = new McpRegistry();
  const registered: ToolDefinition[] = [];
  const statuses = await registry.start({
    configs: [
      {
        id: "fixture",
        transport: "stdio",
        command: "node",
        args: [FIXTURE_PATH],
        timeout_ms: 5000
      }
    ],
    register: (tool) => registered.push(tool)
  });

  try {
    expect(statuses.length === 1, `expected 1 status, got ${statuses.length}`);
    expect(statuses[0].connected === true, `fixture should be connected, got error=${statuses[0].error}`);
    expect(statuses[0].tool_count === 3, `expected 3 tools, got ${statuses[0].tool_count}`);

    const names = registered.map((t) => t.name).sort();
    expect(
      names.join(",") === "mcp.fixture.add,mcp.fixture.echo,mcp.fixture.fail",
      `tool names mismatch: ${names.join(",")}`
    );
    for (const tool of registered) {
      expect(tool.metadata?.source === "mcp", `${tool.name} metadata.source should be 'mcp'`);
    }
    console.log(`§1 registration: 3 tools attached`);
  } finally {
    await registry.stop();
  }
}

/** §2 调用 echo / add / fail，分别校验 text / structuredContent / isError */
async function section2Calls(): Promise<void> {
  const registry = new McpRegistry();
  const tools = new Map<string, ToolDefinition>();
  await registry.start({
    configs: [
      {
        id: "fixture",
        transport: "stdio",
        command: "node",
        args: [FIXTURE_PATH],
        timeout_ms: 5000
      }
    ],
    register: (tool) => tools.set(tool.name, tool)
  });

  try {
    const echo = tools.get("mcp.fixture.echo");
    if (!echo) throw new Error("echo tool not registered");
    const echoResult = (await echo.execute({ message: "hello-mcp" })) as {
      ok: boolean;
      data?: { value: unknown };
    };
    expect(echoResult.ok === true, `echo ok=${echoResult.ok}`);
    expect(echoResult.data?.value === "hello-mcp", `echo value mismatch: ${JSON.stringify(echoResult.data)}`);

    const add = tools.get("mcp.fixture.add");
    if (!add) throw new Error("add tool not registered");
    const addResult = (await add.execute({ a: 7, b: 35 })) as {
      ok: boolean;
      data?: { value: unknown };
    };
    expect(addResult.ok === true, `add ok=${addResult.ok}`);
    const value = addResult.data?.value;
    const sum = typeof value === "object" && value !== null ? (value as { sum?: number }).sum : undefined;
    expect(sum === 42, `add structuredContent.sum mismatch: ${JSON.stringify(value)}`);

    const fail = tools.get("mcp.fixture.fail");
    if (!fail) throw new Error("fail tool not registered");
    const failResult = (await fail.execute({})) as {
      ok: boolean;
      isError?: boolean;
      error?: string;
      message?: string;
    };
    expect(failResult.ok === false, `fail ok should be false, got ${failResult.ok}`);
    expect(failResult.isError === true, `fail isError should be true`);
    expect(failResult.error === "mcp_tool_error", `fail error code mismatch: ${failResult.error}`);
    expect(
      typeof failResult.message === "string" && failResult.message.includes("intentional failure"),
      `fail message should include 'intentional failure', got: ${failResult.message}`
    );

    console.log(`§2 calls: echo + add + fail all behaved as expected`);
  } finally {
    await registry.stop();
  }
}

/** §3 启动失败的 server 不影响主进程 + 走 onStartupError 回调 */
async function section3MissingServer(): Promise<void> {
  const registry = new McpRegistry();
  const errors: Array<{ id: string; err: unknown }> = [];
  const statuses = await registry.start({
    configs: [
      {
        id: "broken",
        transport: "stdio",
        command: "node",
        args: ["/this/path/does/not/exist.js"],
        timeout_ms: 2000
      }
    ],
    register: () => {
      throw new Error("broken server should not register any tools");
    },
    onStartupError: (id, err) => errors.push({ id, err })
  });

  try {
    expect(statuses.length === 1, `expected 1 status, got ${statuses.length}`);
    expect(statuses[0].connected === false, `broken server should not be connected`);
    expect(typeof statuses[0].error === "string" && statuses[0].error.length > 0, `should have error message`);
    expect(errors.length === 1, `onStartupError should fire once, fired ${errors.length}`);
    expect(errors[0].id === "broken", `onStartupError id mismatch: ${errors[0].id}`);
    console.log(`§3 missing server: error captured, main loop survived`);
  } finally {
    await registry.stop();
  }
}

function expect(condition: boolean, message: string): void {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
