/**
 * 应用入口 — 瘦启动器。
 *
 * 职责仅限于 IO 层：
 * 1. 加载环境变量
 * 2. 读取集成配置
 * 3. 组装 EngineConfig
 * 4. 委托 EngineHost 完成所有 runtime 组件的创建和初始化
 *
 * 所有 runtime 装配逻辑已迁移到 src/engine/host/engine-host.ts。
 * 本文件保持 createApp() / attachMcpServers() 的公共 API 不变，
 * 确保 cli.ts / http.ts / eval 等消费者零修改。
 */

import { loadEnvFile } from "./config/load-env.js";
import { getIntegrationConfig } from "./config/integrations.js";
import { EngineHost } from "./engine/host/engine-host.js";
import type { EngineConfig } from "./engine/host/engine-host.js";
import type { ToolRegistry } from "./tools/registry.js";
import type { McpRegistry, McpServerStatus } from "./mcp/registry.js";

loadEnvFile();

/**
 * 创建应用实例。
 *
 * 返回 app 对象和 init() 异步初始化函数。
 * 调用方必须在使用前 await init()，以激活 DomainRegistry 的拓扑排序和声明式配置收集。
 *
 * 用法：
 *   const app = createApp();
 *   await app.init();
 *   // 现在可以使用 app.queryEngine 等
 */
export function createApp() {
  const integrations = getIntegrationConfig();

  // ── 组装 EngineConfig（IO 层决策） ──
  const wecomAppCorpId = process.env.WECOM_APP_CORP_ID ?? integrations.wecom.corpId;
  const wecomAppSecret = process.env.WECOM_APP_SECRET;
  const wecomAppId = process.env.WECOM_APP_AGENT_ID;

  const engineConfig: EngineConfig = {
    integrations,
    wecomApp:
      wecomAppCorpId && wecomAppSecret && wecomAppId
        ? { corpId: wecomAppCorpId, agentSecret: wecomAppSecret, agentId: wecomAppId }
        : undefined,
  };

  const engine = new EngineHost(engineConfig);

  // ── 向后兼容：暴露与旧 createApp() 相同的属性 ──
  return {
    init: () => engine.init(),
    agent: engine.agent,
    queryEngine: engine.queryEngine,
    llm: engine.llm,
    integrations,
    documentSource: engine.documentSource,
    knowledgeBase: engine.knowledgeBase,
    toolRegistry: engine.toolRegistry,
    primitiveRegistry: engine.primitiveRegistry,
    skillRegistry: engine.skillRegistry,
    skillLoader: engine.skillLoader,
    skillRuntime: engine.skillRuntime,
    agenticSkillView: engine.agenticSkillView,
    enterpriseContextProvider: engine.enterpriseContextProvider,
    sessionStore: engine.sessionStore,
    scenarioRouter: engine.scenarioRouter,
    userContextResolver: engine.userContextResolver,
    intentRegistry: engine.intentRegistry,
    intentRouter: engine.intentRouter,
    intentQueryHandler: engine.intentQueryHandler,
    chitchatHandler: engine.chitchatHandler,
    agenticHandler: engine.agenticHandler,
    evolutionRuntime: engine.evolutionRuntime,
    transcriptStore: engine.transcriptStore,
    pendingActionStore: engine.pendingActionStore,
    hooks: engine.hooks,
    metricsCollector: engine.metricsCollector,
    cronStore: engine.cronStore,
    cronRunner: engine.cronRunner,
    messageGateway: engine.messageGateway,
    domainRegistry: engine.domainRegistry,
    resourceRegistry: engine.resourceRegistry,
    // 新增：EngineHost 实例本身，供需要 inspect/dispose 的调用方使用
    engine,
  };
}

/**
 * 启动 MCP client：把 data/mcp-servers.json 中 enabled server 的 tool 拍进 ToolRegistry。
 * 失败的 server 不阻塞主进程；返回 status 列表 + registry 句柄供调用方在退出时 stop()。
 *
 * 用法（CLI / HTTP server 启动时调用）：
 *   const app = createApp();
 *   await app.init();
 *   const mcp = await attachMcpServers(app.toolRegistry);
 *   process.once("SIGINT", () => mcp.registry.stop());
 */
export async function attachMcpServers(
  toolRegistry: ToolRegistry,
  options: { configPath?: string } = {}
): Promise<{ registry: McpRegistry; statuses: McpServerStatus[] }> {
  // 委托给 engine-host 中的独立实现，保持向后兼容
  const { loadMcpServerConfigs, McpRegistry: McpRegistryClass } = await import("./mcp/registry.js");
  const configs = await loadMcpServerConfigs(options.configPath);
  const registry = new McpRegistryClass();
  if (configs.length === 0) {
    return { registry, statuses: [] };
  }
  const statuses = await registry.start({
    configs,
    register: (tool: import("./types/agent-contracts.js").ToolDefinition) => toolRegistry.register(tool),
    onStartupError: (id: string, err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[mcp] server '${id}' failed to start: ${message}`);
    }
  });
  return { registry, statuses };
}
