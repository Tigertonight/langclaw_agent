import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

/**
 * 极简 MCP server，仅作为 src/eval/mcp-client-smoke.ts 的本地 fixture：
 *   - 不需要联网（不像 npx -y @modelcontextprotocol/server-everything）
 *   - 暴露 echo / add / fail 三个工具，覆盖正常路径与 isError 路径
 *   - 用 stdio transport，跟我们的 McpRegistry 配合
 */

async function main(): Promise<void> {
  const server = new McpServer(
    { name: "mcp-fixture", version: "0.0.1" },
    { capabilities: { tools: {} } }
  );

  server.registerTool(
    "echo",
    {
      description: "Echo back the provided message",
      inputSchema: { message: z.string().describe("text to echo") }
    },
    async ({ message }) => ({
      content: [{ type: "text", text: message }]
    })
  );

  server.registerTool(
    "add",
    {
      description: "Add two integers and return their sum",
      inputSchema: {
        a: z.number().describe("first addend"),
        b: z.number().describe("second addend")
      }
    },
    async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
      structuredContent: { sum: a + b }
    })
  );

  server.registerTool(
    "fail",
    {
      description: "Always returns isError=true (for negative-path testing)",
      inputSchema: {}
    },
    async () => ({
      isError: true,
      content: [{ type: "text", text: "intentional failure" }]
    })
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[mcp-fixture] fatal:", err);
  process.exit(1);
});
