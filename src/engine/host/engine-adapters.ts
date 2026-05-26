/**
 * Engine Adapters — 各 Port 的工厂函数。
 *
 * 每个 create*() 函数负责创建一组内聚的运行时组件，
 * 对应 engine-ports.ts 中定义的 Port 接口。
 *
 * EngineHost 通过调用这些工厂函数来组装完整的 Engine，
 * 而不是在构造函数中平铺 400 行初始化代码。
 *
 * 设计约束：
 * - 每个工厂函数只依赖自己的输入参数，不读全局状态
 * - 工厂函数之间的依赖通过参数显式传递
 * - 工厂函数返回的对象满足对应 Port 接口
 */

import { DomainRegistry, QueryAdapterRegistry } from "../../domains/index.js";
import { ResourceRegistry } from "../../resources/index.js";
import { SimpleWorkflowOrchestrator } from "../../agent/orchestrator.js";
import { UserWorkspaceSessionStore } from "../../agent/session-store.js";
import {
  LocalPermissionProvider,
  MockWeComDirectory,
  UserContextResolver,
  WeComDirectory,
} from "../../auth/user-context-resolver.js";
import { OpenAILLMClient } from "../../llm/openai-llm.js";
import { EvolutionRuntime } from "../../evolution/runtime.js";
import { createEvolutionSignalPlugin } from "../../evolution/evolution-signal-plugin.js";
import { createEvolutionIterationPlugin } from "../../evolution/iteration-plugin.js";
import { createEvolutionTools } from "../../evolution/tools.js";
import { createMemoryTools } from "../../memory/tools.js";
import { createTaskTools } from "../../tasks/tools.js";
import { IntentRegistry } from "../../router/intent-registry.js";
import { IntentRouter } from "../../router/intent-router.js";
import { IntentQueryHandler } from "../../handlers/intent-query-handler.js";
import { ChitchatHandler } from "../../handlers/chitchat-handler.js";
import { AgenticHandler } from "../../handlers/agentic-handler.js";
import { MockTencentDocsSource, TencentDocsSource } from "../../rag/document-sources.js";
import { LocalKnowledgeBase } from "../../rag/local-knowledge-base.js";
import { PrimitiveRegistry } from "../../primitives/registry.js";
import { EnterpriseContextProvider } from "../../runtime/enterprise-context.js";
import { BusinessQueryEngine } from "../../runtime/business-query-engine.js";
import { PendingActionStore } from "../../runtime/pending-action-store.js";
import { RuntimeHooks } from "../../runtime/hooks.js";
import { resolveUserWorkspace } from "../../runtime/workspace-context.js";
import { createTranscriptPlugin } from "../../runtime/transcript-plugin.js";
import { createPromptAuthorityAlertPlugin } from "../../runtime/prompt-authority-alert-plugin.js";
import { MetricsCollector, createMetricsPlugin } from "../../runtime/metrics-collector.js";
import { FileSystemSkillLoader } from "../../runtime/skill-loader.js";
import { TranscriptStore } from "../../transcript/transcript-store.js";
import { ScenarioRouter } from "../../scenarios/router.js";
import { SkillRegistryStore } from "../../skills/registry-store.js";
import { SkillRuntime } from "../../skills/runtime.js";
import { AgenticSkillView } from "../../skills/agentic-skill-view.js";
import { createBusinessTools } from "../../tools/business-tools.js";
import { createKnowledgeTools } from "../../tools/knowledge-tools.js";
import { createMaintenanceTools } from "../../tools/maintenance-tools.js";
import { createPluginTools } from "../../tools/plugin-tools.js";
import { createPendingActionTools } from "../../tools/pending-action-tools.js";
import { createRuntimeInspectionTools } from "../../tools/runtime-inspection-tools.js";
import { createSandboxTools } from "../../tools/sandbox-tools.js";
import { createTerminalTools } from "../../tools/terminal-tools.js";
import { ToolRegistry } from "../../tools/registry.js";
import { loadToolPolicyStore } from "../../tools/tool-policy.js";
import { createSpawnAgentTool } from "../../tools/spawn-agent-tool.js";
import { createCronTools } from "../../tools/cron-tools.js";
import { UserCronStore } from "../../cron/user-cron-store.js";
import { AgentCronJobRunner } from "../../cron/agent-job-runner.js";
import { MessageGateway } from "../../messaging/message-gateway.js";
import { ConsoleChannel } from "../../messaging/console-channel.js";
import { WeComChannel } from "../../messaging/wecom-channel.js";
import { createMessagingTools } from "../../tools/messaging-tools.js";

import type { EngineConfig } from "./engine-host.js";
import type {
  InfraPort,
  KnowledgePort,
  StoragePort,
  DomainPort,
  ToolPort,
  SkillPort,
  UserContextPort,
  RoutingPort,
  HandlerPort,
  MessagingPort,
  CronPort,
  OrchestratorPort,
} from "./engine-ports.js";
import type { JsonValue } from "../contracts/base-types.js";

// ─── 1. Infra Adapter ────────────────────────────────────────────────────────

export function createInfraAdapter(): InfraPort {
  const llm = new OpenAILLMClient();
  const hooks = new RuntimeHooks();

  const evolutionRuntime = new EvolutionRuntime({
    onSessionIdle: (input) =>
      hooks.emit("session_idle", {
        user_id: input.user.id,
        session_id: input.sessionId,
        reason: "evolution_debounce_elapsed",
        trace_turns: input.sessionTrace?.turns.length ?? 0,
      }),
    onReviewed: (input, result) =>
      hooks.emit("evolution_applied", {
        user_id: input.user.id,
        session_id: input.sessionId,
        trigger: input.trigger,
        status: result.status,
        result: normalizeJson(result),
        decision: normalizeJson(result.decision),
      }),
  });

  const transcriptStore = new TranscriptStore();
  hooks.use(createTranscriptPlugin({ transcriptStore }));
  hooks.use(createPromptAuthorityAlertPlugin({ transcriptStore }));

  const metricsCollector = new MetricsCollector();
  hooks.use(createMetricsPlugin(metricsCollector));

  hooks.use(createEvolutionSignalPlugin({ evolutionRuntime }));
  hooks.use(createEvolutionIterationPlugin());

  // 注：task-continuity / skill-curator / maintenance-scheduler 已迁移到
  // corePack.runtimePlugins，由 EngineHost.init() 末尾统一挂载。
  // 引擎层只保留真正通用的插件（transcript / promptAuthority / metrics / evolution）。

  return { llm, hooks, evolutionRuntime, transcriptStore, metricsCollector };
}

// ─── 2. Knowledge Adapter ────────────────────────────────────────────────────

export function createKnowledgeAdapter(config: EngineConfig): KnowledgePort {
  const { integrations } = config;
  const documentSource =
    integrations.tencentDocs.mode === "real"
      ? new TencentDocsSource({
          baseUrl: integrations.tencentDocs.baseUrl,
          accessToken: integrations.tencentDocs.accessToken,
          docIds: integrations.tencentDocs.docIds,
          contentEndpointTemplate: integrations.tencentDocs.contentEndpointTemplate,
        })
      : new MockTencentDocsSource();
  const knowledgeBase = new LocalKnowledgeBase({ documentSource });
  return { documentSource, knowledgeBase };
}

// ─── 3. Storage Adapter ─────────────────────────────────────────────────────

export function createStorageAdapter(): StoragePort {
  return {
    pendingActionStore: new PendingActionStore(),
    sessionStore: new UserWorkspaceSessionStore(),
  };
}

// ─── 4. Domain Adapter ──────────────────────────────────────────────────────

export function createDomainAdapter(): DomainPort {
  return {
    domainRegistry: new DomainRegistry(),
    resourceRegistry: new ResourceRegistry(),
    queryAdapterRegistry: new QueryAdapterRegistry(),
  };
}

// ─── 5. Tool Adapter ────────────────────────────────────────────────────────

export interface ToolAdapterDeps {
  infra: InfraPort;
  knowledge: KnowledgePort;
  storage: StoragePort;
  domain: DomainPort;
}

export function createToolAdapter(deps: ToolAdapterDeps): ToolPort {
  const { infra, knowledge, storage, domain } = deps;

  const baseTools = [
    ...createBusinessTools({ resourceRegistry: domain.resourceRegistry }),
    ...createKnowledgeTools({ knowledgeBase: knowledge.knowledgeBase }),
    ...createSandboxTools(),
    ...createTerminalTools(),
    ...createMaintenanceTools(),
    ...createPluginTools(),
    ...createMemoryTools(),
    ...createTaskTools(),
    ...createEvolutionTools({ evolutionRuntime: infra.evolutionRuntime }),
  ];
  const toolPolicyStore = loadToolPolicyStore();
  const toolRegistry = new ToolRegistry(baseTools, {
    hooks: infra.hooks,
    pendingActionStore: storage.pendingActionStore,
    policyStore: toolPolicyStore,
  });
  for (const tool of createPendingActionTools({
    pendingActionStore: storage.pendingActionStore,
    toolRegistry,
  })) {
    toolRegistry.register(tool);
  }

  const primitiveRegistry = new PrimitiveRegistry({
    toolRegistry,
    knowledgeBase: knowledge.knowledgeBase,
  });

  return { toolRegistry, primitiveRegistry };
}

// ─── 6. Skill Adapter ───────────────────────────────────────────────────────

export interface SkillAdapterDeps {
  infra: InfraPort;
  tool: ToolPort;
}

export function createSkillAdapter(deps: SkillAdapterDeps): SkillPort {
  const { infra, tool } = deps;

  const skillRegistry = new SkillRegistryStore();
  const skillLoader = new FileSystemSkillLoader({ registryStore: skillRegistry });
  const enterpriseContextProvider = new EnterpriseContextProvider();

  for (const t of createRuntimeInspectionTools({
    transcriptStore: infra.transcriptStore,
    enterpriseContextProvider,
    toolRegistry: tool.toolRegistry,
  })) {
    tool.toolRegistry.register(t);
  }

  const scenarioRouter = new ScenarioRouter();
  const skillRuntime = new SkillRuntime({
    skillLoader,
    scenarioRouter,
  });
  const agenticSkillView = new AgenticSkillView();

  return { skillRegistry, skillLoader, skillRuntime, agenticSkillView, enterpriseContextProvider, scenarioRouter };
}

// ─── 7. UserContext Adapter ─────────────────────────────────────────────────

export function createUserContextAdapter(config: EngineConfig): UserContextPort {
  const { integrations } = config;
  const directory =
    integrations.wecom.mode === "real"
      ? new WeComDirectory({
          corpId: integrations.wecom.corpId,
          contactSecret: integrations.wecom.contactSecret,
          baseUrl: integrations.wecom.baseUrl,
        })
      : new MockWeComDirectory();
  return {
    userContextResolver: new UserContextResolver({
      directory,
      permissionProvider: new LocalPermissionProvider(),
    }),
  };
}

// ─── 8. Routing Adapter ─────────────────────────────────────────────────────

export interface RoutingAdapterDeps {
  infra: InfraPort;
  domain: DomainPort;
}

export function createRoutingAdapter(deps: RoutingAdapterDeps): RoutingPort {
  const { infra, domain } = deps;
  const intentRegistry = new IntentRegistry({ dir: "data/intent-codes" });
  const intentRouter = new IntentRouter({
    llm: infra.llm,
    registry: intentRegistry,
    domainRules: domain.domainRegistry.allDeterministicRules,
    extractorRegistry: domain.domainRegistry.allExtractors,
  });
  return { intentRegistry, intentRouter };
}

// ─── 9. Handler Adapter ─────────────────────────────────────────────────────

export interface HandlerAdapterDeps {
  infra: InfraPort;
  domain: DomainPort;
  tool: ToolPort;
  skill: SkillPort;
  routing: RoutingPort;
}

export function createHandlerAdapter(deps: HandlerAdapterDeps): HandlerPort {
  const { infra, domain, tool, skill, routing } = deps;

  const intentQueryHandler = new IntentQueryHandler({
    llm: infra.llm,
    toolRegistry: tool.toolRegistry,
    registry: routing.intentRegistry,
    queryAdapterRegistry: domain.queryAdapterRegistry,
    filterTransformRegistry: domain.domainRegistry.allFilterTransforms,
    permissionRules: domain.domainRegistry.allPermissionRules,
    fieldLabels: domain.domainRegistry.allFieldLabels,
    resourceConfigs: domain.domainRegistry.allResources,
  });
  const chitchatHandler = new ChitchatHandler({ llm: infra.llm });
  const agenticHandler = new AgenticHandler({
    intentRegistry: routing.intentRegistry,
    intentQueryHandler,
    skillRegistry: skill.agenticSkillView,
    toolRegistry: tool.toolRegistry,
    hooks: infra.hooks,
  });

  // spawn_agent：注册在 handler 创建之后，避免循环依赖
  tool.toolRegistry.register(createSpawnAgentTool({ handler: agenticHandler }));

  return { intentQueryHandler, chitchatHandler, agenticHandler, agenticSkillView: skill.agenticSkillView };
}

// ─── 10. Messaging Adapter ──────────────────────────────────────────────────

export interface MessagingAdapterDeps {
  config: EngineConfig;
  tool: ToolPort;
}

export function createMessagingAdapter(deps: MessagingAdapterDeps): MessagingPort {
  const { config, tool } = deps;
  const messageGateway = new MessageGateway();
  messageGateway.register(new ConsoleChannel());
  if (config.wecomApp) {
    messageGateway.register(
      new WeComChannel({
        corpId: config.wecomApp.corpId,
        agentSecret: config.wecomApp.agentSecret,
        agentId: config.wecomApp.agentId,
        baseUrl: config.integrations.wecom.baseUrl,
      })
    );
  }
  for (const t of createMessagingTools({ gateway: messageGateway })) {
    tool.toolRegistry.register(t);
  }
  return { messageGateway };
}

// ─── 11. Cron Adapter ───────────────────────────────────────────────────────

export interface CronAdapterDeps {
  handler: HandlerPort;
  messaging: MessagingPort;
  tool: ToolPort;
}

export function createCronAdapter(deps: CronAdapterDeps): CronPort {
  const { handler, messaging, tool } = deps;
  const cronStore = new UserCronStore();
  const cronRunner = new AgentCronJobRunner({
    handler: handler.agenticHandler,
    cronStore,
    onAfterRun: async (entry, spec) => {
      const ws = resolveUserWorkspace(spec.user_id);
      const isOk = entry.status === "ok";
      const subject = isOk ? "cron 已完成" : "cron 失败";
      const content = `任务：${spec.task}\n结果：${entry.summary}\n用时：${entry.duration_ms}ms`;
      await messaging.messageGateway
        .send(
          {
            to: { user_id: spec.user_id },
            subject,
            body: { type: "text", content },
            source: "cron",
            ref: { kind: "cron_spec", id: spec.id },
          },
          { workspace: ws }
        )
        .catch(() => undefined);
    },
  });
  for (const t of createCronTools({ cronStore, runner: cronRunner })) {
    tool.toolRegistry.register(t);
  }
  return { cronStore, cronRunner };
}

// ─── 12. Orchestrator Adapter ───────────────────────────────────────────────

export interface OrchestratorAdapterDeps {
  infra: InfraPort;
  knowledge: KnowledgePort;
  storage: StoragePort;
  tool: ToolPort;
  skill: SkillPort;
  userContext: UserContextPort;
  routing: RoutingPort;
  handler: HandlerPort;
}

export function createOrchestratorAdapter(deps: OrchestratorAdapterDeps): OrchestratorPort {
  const { infra, knowledge, storage, tool, skill, userContext, routing, handler } = deps;

  const agent = new SimpleWorkflowOrchestrator({
    llm: infra.llm,
    knowledgeBase: knowledge.knowledgeBase,
    toolRegistry: tool.toolRegistry,
    primitiveRegistry: tool.primitiveRegistry,
    sessionStore: storage.sessionStore,
    scenarioRouter: skill.scenarioRouter,
    userContextResolver: userContext.userContextResolver,
    skillRuntime: skill.skillRuntime,
    enterpriseContextProvider: skill.enterpriseContextProvider,
    intentRouter: routing.intentRouter,
    intentQueryHandler: handler.intentQueryHandler,
    chitchatHandler: handler.chitchatHandler,
    agenticHandler: handler.agenticHandler,
    evolutionRuntime: infra.evolutionRuntime,
    transcriptStore: infra.transcriptStore,
    hooks: infra.hooks,
  });

  const queryEngine = new BusinessQueryEngine({
    agent,
    streamAgent: agent,
    userContextResolver: userContext.userContextResolver,
    enterpriseContextProvider: skill.enterpriseContextProvider,
    hooks: infra.hooks,
    transcriptStore: infra.transcriptStore,
    evolutionRuntime: infra.evolutionRuntime,
    sessionStore: storage.sessionStore,
  });

  return { agent, queryEngine };
}

// ─── 内部辅助 ────────────────────────────────────────────────────────────────

function normalizeJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}
