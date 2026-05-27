import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { resolveProjectPath } from "../data/load-json.js";
import type { JsonObject, ToolDefinition, ToolMetadata } from "../types/agent-contracts.js";

/**
 * MCP Client Registry —— 把外部 MCP server 的工具透明接进 ToolRegistry。
 *
 * 设计取舍：
 *   - 只做 MCP client，不做 server 暴露面（后续再补）
 *   - 只做 stdio transport（绝大多数社区 server 都是 stdio）
 *   - 工具名空间用 mcp.<serverId>.<toolName>，避免和本地工具冲突
 *   - 启动失败的 server 不阻塞主进程：记录失败原因，继续跑其他 server
 *   - 进程退出时统一 close 所有 client
 *
 * 配置：data/mcp-servers.json（参考 data/mcp-servers.json.example）。
 *   配置文件不存在 → 安静返回空数组，不当错误处理（默认不启用）。
 */

export interface McpServerConfig {
  id: string;
  transport: "stdio";
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  enabled?: boolean;
  timeout_ms?: number;
}

interface McpServerFile {
  servers?: McpServerConfig[];
}

export interface McpServerStatus {
  id: string;
  enabled: boolean;
  connected: boolean;
  tool_count: number;
  error?: string;
}

interface AttachedServer {
  config: McpServerConfig;
  client: Client;
  toolNames: string[];
}

const TOOL_NAME_PREFIX = "mcp.";

export class McpRegistry {
  private readonly servers: AttachedServer[] = [];
  private readonly statuses: Map<string, McpServerStatus> = new Map();

  /**
   * 启动所有 enabled server，把它们暴露的 tool 注册到 register() 回调里。
   * 注：register 是回调而非直接传 ToolRegistry，便于测试 + 让上层决定是否真注册。
   */
  async start({
    configs,
    register,
    onStartupError
  }: {
    configs: McpServerConfig[];
    register: (tool: ToolDefinition) => void;
    onStartupError?: (serverId: string, err: unknown) => void;
  }): Promise<McpServerStatus[]> {
    for (const config of configs) {
      if (config.enabled === false) {
        this.statuses.set(config.id, { id: config.id, enabled: false, connected: false, tool_count: 0 });
        continue;
      }
      try {
        const attached = await this.attachServer(config, register);
        this.servers.push(attached);
        this.statuses.set(config.id, {
          id: config.id,
          enabled: true,
          connected: true,
          tool_count: attached.toolNames.length
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.statuses.set(config.id, {
          id: config.id,
          enabled: true,
          connected: false,
          tool_count: 0,
          error: message
        });
        onStartupError?.(config.id, err);
      }
    }
    return Array.from(this.statuses.values());
  }

  status(): McpServerStatus[] {
    return Array.from(this.statuses.values());
  }

  /** 进程退出时调用，关闭所有 stdio 子进程 */
  async stop(): Promise<void> {
    const closures = this.servers.map(async ({ client }) => {
      try {
        await client.close();
      } catch {
        // 关闭失败也不抛——子进程会随父进程结束被 OS 回收
      }
    });
    await Promise.all(closures);
    this.servers.length = 0;
  }

  private async attachServer(config: McpServerConfig, register: (tool: ToolDefinition) => void): Promise<AttachedServer> {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env,
      cwd: config.cwd,
      stderr: "pipe"
    });
    const client = new Client(
      { name: `enterprise-agent-mvp/mcp-client/${config.id}`, version: "0.1.0" },
      { capabilities: {} }
    );
    await client.connect(transport);

    // 拉一次 tools 列表注册成本地 ToolDefinition
    const listed = await client.listTools();
    const toolNames: string[] = [];
    for (const tool of listed.tools) {
      const localName = `${TOOL_NAME_PREFIX}${config.id}.${tool.name}`;
      register(buildToolDefinition({
        localName,
        upstreamName: tool.name,
        upstreamDescription: tool.description,
        upstreamSchema: tool.inputSchema as JsonObject | undefined,
        client,
        timeoutMs: config.timeout_ms
      }));
      toolNames.push(localName);
    }
    return { config, client, toolNames };
  }
}

function buildToolDefinition({
  localName,
  upstreamName,
  upstreamDescription,
  upstreamSchema,
  client,
  timeoutMs
}: {
  localName: string;
  upstreamName: string;
  upstreamDescription: string | undefined;
  upstreamSchema: JsonObject | undefined;
  client: Client;
  timeoutMs?: number;
}): ToolDefinition {
  const metadata: ToolMetadata = {
    required_permissions: [],
    risk_level: "read",
    expose_to_agentic: true,
    source: "mcp"
  };
  return {
    name: localName,
    description: upstreamDescription ?? `MCP tool ${upstreamName}`,
    schema: upstreamSchema,
    metadata,
    async execute(args) {
      try {
        const result = await client.callTool(
          { name: upstreamName, arguments: (args ?? {}) as Record<string, unknown> },
          undefined,
          timeoutMs ? { timeout: timeoutMs } : undefined
        );
        if ((result as { isError?: boolean }).isError === true) {
          return {
            ok: false,
            isError: true,
            tool: localName,
            error: "mcp_tool_error",
            message: extractErrorMessage(result),
            data: { value: extractContentValue(result) }
          };
        }
        return {
          ok: true,
          tool: localName,
          data: { value: extractContentValue(result) }
        };
      } catch (err) {
        return {
          ok: false,
          isError: true,
          tool: localName,
          error: "mcp_call_failed",
          message: err instanceof Error ? err.message : String(err)
        };
      }
    }
  };
}

function extractContentValue(result: unknown): JsonObject | string {
  // MCP tool 返回内容形如 { content: [{ type: "text", text: "..." }, { type: "image", ... }], structuredContent?: {...} }
  // 优先 structuredContent，退而求其次拼 text
  if (!result || typeof result !== "object") return String(result ?? "");
  const record = result as { structuredContent?: unknown; content?: Array<{ type: string; text?: string }> };
  if (record.structuredContent && typeof record.structuredContent === "object") {
    return record.structuredContent as JsonObject;
  }
  if (Array.isArray(record.content)) {
    const texts = record.content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text as string);
    if (texts.length) return texts.join("\n");
  }
  return JSON.stringify(record);
}

function extractErrorMessage(result: unknown): string {
  if (!result || typeof result !== "object") return "mcp tool returned isError";
  const value = extractContentValue(result);
  return typeof value === "string" ? value : JSON.stringify(value);
}

/**
 * 读 data/mcp-servers.json。文件不存在返回空数组，解析失败抛异常（让调用方自己决定是否致命）。
 * 测试可以直接传 configs 进 start()，不走文件。
 */
export async function loadMcpServerConfigs(relativePath = "data/mcp-servers.json"): Promise<McpServerConfig[]> {
  const file = resolveProjectPath(relativePath);
  if (!existsSync(file)) return [];
  const raw = await readFile(file, "utf8");
  const parsed = JSON.parse(raw) as McpServerFile;
  if (!parsed || !Array.isArray(parsed.servers)) return [];
  return parsed.servers.filter(isValidConfig);
}

function isValidConfig(value: unknown): value is McpServerConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<McpServerConfig>;
  return typeof record.id === "string"
    && record.id.length > 0
    && record.transport === "stdio"
    && typeof record.command === "string"
    && record.command.length > 0;
}
