import { loadEnvFile } from "./config/load-env.js";
import { getIntegrationConfig } from "./config/integrations.js";
import { SimpleWorkflowOrchestrator } from "./agent/orchestrator.js";
import { UserWorkspaceSessionStore } from "./agent/session-store.js";
import {
  LocalPermissionProvider,
  MockWeComDirectory,
  UserContextResolver,
  WeComDirectory
} from "./auth/user-context-resolver.js";
import { OpenAILLMClient } from "./llm/openai-llm.js";
import { EvolutionRuntime } from "./evolution/runtime.js";
import { createSkillCuratorPlugin } from "./evolution/skill-curator-plugin.js";
import { createEvolutionSignalPlugin } from "./evolution/evolution-signal-plugin.js";
import { createEvolutionIterationPlugin } from "./evolution/iteration-plugin.js";
import { createEvolutionTools } from "./evolution/tools.js";
import { createMemoryTools } from "./memory/tools.js";
import { createTaskTools } from "./tasks/tools.js";
import { DEFAULT_COMMANDS } from "./router/default-commands.js";
import { IntentRegistry } from "./router/intent-registry.js";
import { IntentRouter } from "./router/intent-router.js";
import { IntentQueryHandler } from "./handlers/intent-query-handler.js";
import { ChitchatHandler } from "./handlers/chitchat-handler.js";
import { AgenticHandler } from "./handlers/agentic-handler.js";
import { MockTencentDocsSource, TencentDocsSource } from "./rag/document-sources.js";
import { LocalKnowledgeBase } from "./rag/local-knowledge-base.js";
import { PrimitiveRegistry } from "./primitives/registry.js";
import { EnterpriseContextProvider } from "./runtime/enterprise-context.js";
import { BusinessQueryEngine } from "./runtime/business-query-engine.js";
import { PendingActionStore } from "./runtime/pending-action-store.js";
import { RuntimeHooks } from "./runtime/hooks.js";
import { resolveUserWorkspace } from "./runtime/workspace-context.js";
import { createMaintenanceSchedulerPlugin } from "./runtime/maintenance-scheduler-plugin.js";
import { createTranscriptPlugin } from "./runtime/transcript-plugin.js";
import { createPromptAuthorityAlertPlugin } from "./runtime/prompt-authority-alert-plugin.js";
import { MetricsCollector, createMetricsPlugin } from "./runtime/metrics-collector.js";
import { FileSystemSkillLoader } from "./runtime/skill-loader.js";
import { TranscriptStore } from "./transcript/transcript-store.js";
import { createTaskContinuityPlugin } from "./tasks/task-continuity-plugin.js";
import { ScenarioRouter } from "./scenarios/router.js";
import { SkillRegistryStore } from "./skills/registry-store.js";
import { SkillRuntime } from "./skills/runtime.js";
import { AgenticSkillView } from "./skills/agentic-skill-view.js";
import { createBusinessTools } from "./tools/business-tools.js";
import { createKnowledgeTools } from "./tools/knowledge-tools.js";
import { createMaintenanceTools } from "./tools/maintenance-tools.js";
import { createPluginTools } from "./tools/plugin-tools.js";
import { createPendingActionTools } from "./tools/pending-action-tools.js";
import { createRuntimeInspectionTools } from "./tools/runtime-inspection-tools.js";
import { createSandboxTools } from "./tools/sandbox-tools.js";
import { createTerminalTools } from "./tools/terminal-tools.js";
import { ToolRegistry } from "./tools/registry.js";
import { loadToolPolicyStore } from "./tools/tool-policy.js";
import { createSpawnAgentTool } from "./tools/spawn-agent-tool.js";
import { createCronTools } from "./tools/cron-tools.js";
import { UserCronStore } from "./cron/user-cron-store.js";
import { AgentCronJobRunner } from "./cron/agent-job-runner.js";
import { MessageGateway } from "./messaging/message-gateway.js";
import { ConsoleChannel } from "./messaging/console-channel.js";
import { WeComChannel } from "./messaging/wecom-channel.js";
import { createMessagingTools } from "./tools/messaging-tools.js";
import { McpRegistry, loadMcpServerConfigs, type McpServerStatus } from "./mcp/registry.js";
import type { JsonValue } from "./types/agent-contracts.js";

loadEnvFile();

export function createApp() {
  const integrations = getIntegrationConfig();
  const llm = new OpenAILLMClient();
  const hooks = new RuntimeHooks();
  const evolutionRuntime = new EvolutionRuntime({
    onSessionIdle: (input) => hooks.emit("session_idle", {
      user_id: input.user.id,
      session_id: input.sessionId,
      reason: "evolution_debounce_elapsed",
      trace_turns: input.sessionTrace?.turns.length ?? 0
    }),
    onReviewed: (input, result) => hooks.emit("evolution_applied", {
      user_id: input.user.id,
      session_id: input.sessionId,
      trigger: input.trigger,
      status: result.status,
      result: normalizeAppJson(result),
      decision: normalizeAppJson(result.decision)
    })
  });
  const transcriptStore = new TranscriptStore();
  hooks.use(createTranscriptPlugin({ transcriptStore }));
  hooks.use(createPromptAuthorityAlertPlugin({ transcriptStore }));
  const metricsCollector = new MetricsCollector();
  hooks.use(createMetricsPlugin(metricsCollector));
  hooks.use(createEvolutionSignalPlugin({ evolutionRuntime }));
  hooks.use(createEvolutionIterationPlugin());
  hooks.use(createTaskContinuityPlugin());
  hooks.use(createSkillCuratorPlugin());
  hooks.use(createMaintenanceSchedulerPlugin());
  const documentSource = integrations.tencentDocs.mode === "real"
    ? new TencentDocsSource({
        baseUrl: integrations.tencentDocs.baseUrl,
        accessToken: integrations.tencentDocs.accessToken,
        docIds: integrations.tencentDocs.docIds,
        contentEndpointTemplate: integrations.tencentDocs.contentEndpointTemplate
      })
    : new MockTencentDocsSource();
  const knowledgeBase = new LocalKnowledgeBase({ documentSource });
  const pendingActionStore = new PendingActionStore();
  const baseTools = [
    ...createBusinessTools(),
    ...createKnowledgeTools({ knowledgeBase }),
    ...createSandboxTools(),
    ...createTerminalTools(),
    ...createMaintenanceTools(),
    ...createPluginTools(),
    ...createMemoryTools(),
    ...createTaskTools(),
    ...createEvolutionTools({ evolutionRuntime })
  ];
  const toolPolicyStore = loadToolPolicyStore();
  const toolRegistry = new ToolRegistry(baseTools, { hooks, pendingActionStore, policyStore: toolPolicyStore });
  for (const tool of createPendingActionTools({ pendingActionStore, toolRegistry })) {
    toolRegistry.register(tool);
  }
  const primitiveRegistry = new PrimitiveRegistry({ toolRegistry, knowledgeBase });
  const skillRegistry = new SkillRegistryStore();
  const skillLoader = new FileSystemSkillLoader({ registryStore: skillRegistry });
  const enterpriseContextProvider = new EnterpriseContextProvider();
  for (const tool of createRuntimeInspectionTools({ transcriptStore, enterpriseContextProvider, toolRegistry })) {
    toolRegistry.register(tool);
  }
  const sessionStore = new UserWorkspaceSessionStore();
  const scenarioRouter = new ScenarioRouter({ toolRegistry });
  const skillRuntime = new SkillRuntime({ skillLoader, scenarioRouter });
  const directory = integrations.wecom.mode === "real"
    ? new WeComDirectory({
        corpId: integrations.wecom.corpId,
        contactSecret: integrations.wecom.contactSecret,
        baseUrl: integrations.wecom.baseUrl
      })
    : new MockWeComDirectory();
  const userContextResolver = new UserContextResolver({
    directory,
    permissionProvider: new LocalPermissionProvider()
  });
  const intentRegistry = new IntentRegistry({ dir: "data/intent-codes" });
  const intentRouter = new IntentRouter({ llm, registry: intentRegistry });
  intentRouter.commands.registerAll(DEFAULT_COMMANDS);
  const intentQueryHandler = new IntentQueryHandler({ llm, toolRegistry, registry: intentRegistry });
  const chitchatHandler = new ChitchatHandler({ llm });
  // 给 agentic 单独的 skill 视图（注入式包），与 workflow 的 SkillRegistryStore 解耦。
  const agenticSkillView = new AgenticSkillView();
  const agenticHandler = new AgenticHandler({
    intentRegistry,
    intentQueryHandler,
    skillRegistry: agenticSkillView, // 提供 listForAgent / loadForInjection
    toolRegistry,                     // 通过 expose_to_agentic 元数据筛掉非授权的工具
    hooks
  });
  // spawn_agent：让主 agent 委派隔离子 agent。注册在 handler 创建之后，避免循环依赖。
  toolRegistry.register(createSpawnAgentTool({ handler: agenticHandler }));
  // 消息网关：默认开启 console channel；WeCom 凭证齐全才注册。
  // gateway 必须在 cron runner 之前建好，让 runner 拿到能用的 onAfterRun 钩子。
  const messageGateway = new MessageGateway();
  messageGateway.register(new ConsoleChannel());
  const wecomAppCorpId = process.env.WECOM_APP_CORP_ID ?? integrations.wecom.corpId;
  const wecomAppSecret = process.env.WECOM_APP_SECRET;
  const wecomAppId = process.env.WECOM_APP_AGENT_ID;
  if (wecomAppCorpId && wecomAppSecret && wecomAppId) {
    messageGateway.register(new WeComChannel({
      corpId: wecomAppCorpId,
      agentSecret: wecomAppSecret,
      agentId: wecomAppId,
      baseUrl: integrations.wecom.baseUrl
    }));
  }
  for (const tool of createMessagingTools({ gateway: messageGateway })) toolRegistry.register(tool);

  // cron.*：用户级定时任务管理工具（create/list/delete/update/resume/history）。runner 由调用方启动。
  const cronStore = new UserCronStore();
  const cronRunner = new AgentCronJobRunner({
    handler: agenticHandler,
    cronStore,
    onAfterRun: async (entry, spec) => {
      // cron 跑完通知用户：默认走偏好 channel；console 永远兜底。
      const ws = resolveUserWorkspace(spec.user_id);
      const isOk = entry.status === "ok";
      const subject = isOk ? "cron 已完成" : "cron 失败";
      const content = `任务：${spec.task}\n结果：${entry.summary}\n用时：${entry.duration_ms}ms`;
      await messageGateway.send(
        {
          to: { user_id: spec.user_id },
          subject,
          body: { type: "text", content },
          source: "cron",
          ref: { kind: "cron_spec", id: spec.id }
        },
        { workspace: ws }
      ).catch(() => undefined); // 通知失败不影响 cron 主流程
    }
  });
  for (const tool of createCronTools({ cronStore, runner: cronRunner })) toolRegistry.register(tool);
  const agent = new SimpleWorkflowOrchestrator({
    llm,
    knowledgeBase,
    toolRegistry,
    primitiveRegistry,
    sessionStore,
    scenarioRouter,
    userContextResolver,
    skillRuntime,
    enterpriseContextProvider,
    intentRouter,
    intentQueryHandler,
    chitchatHandler,
    agenticHandler,
    evolutionRuntime,
    transcriptStore,
    hooks
  });
  const queryEngine = new BusinessQueryEngine({
    agent,
    streamAgent: agent,
    userContextResolver,
    enterpriseContextProvider,
    hooks,
    transcriptStore,
    evolutionRuntime,
    sessionStore
  });
  return { agent, queryEngine, llm, integrations, documentSource, knowledgeBase, toolRegistry, primitiveRegistry, skillRegistry, skillLoader, skillRuntime, agenticSkillView, enterpriseContextProvider, sessionStore, scenarioRouter, userContextResolver, intentRegistry, intentRouter, intentQueryHandler, chitchatHandler, agenticHandler, evolutionRuntime, transcriptStore, pendingActionStore, hooks, metricsCollector, cronStore, cronRunner, messageGateway };
}

/**
 * 启动 MCP client：把 data/mcp-servers.json 中 enabled server 的 tool 拍进 ToolRegistry。
 * 失败的 server 不阻塞主进程；返回 status 列表 + registry 句柄供调用方在退出时 stop()。
 *
 * 用法（CLI / HTTP server 启动时调用）：
 *   const app = createApp();
 *   const mcp = await attachMcpServers(app.toolRegistry);
 *   process.once("SIGINT", () => mcp.registry.stop());
 */
export async function attachMcpServers(
  toolRegistry: ToolRegistry,
  options: { configPath?: string } = {}
): Promise<{ registry: McpRegistry; statuses: McpServerStatus[] }> {
  const configs = await loadMcpServerConfigs(options.configPath);
  const registry = new McpRegistry();
  if (configs.length === 0) {
    return { registry, statuses: [] };
  }
  const statuses = await registry.start({
    configs,
    register: (tool) => toolRegistry.register(tool),
    onStartupError: (id, err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[mcp] server '${id}' failed to start: ${message}`);
    }
  });
  return { registry, statuses };
}

function normalizeAppJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}
