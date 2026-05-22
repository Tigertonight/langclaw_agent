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
import { IntentRegistry } from "./router/intent-registry.js";
import { IntentRouter } from "./router/intent-router.js";
import { IntentQueryHandler } from "./handlers/intent-query-handler.js";
import { ChitchatHandler } from "./handlers/chitchat-handler.js";
import { AgenticHandler } from "./handlers/agentic-handler.js";
import { MockTencentDocsSource, TencentDocsSource } from "./rag/document-sources.js";
import { LocalKnowledgeBase } from "./rag/local-knowledge-base.js";
import { PrimitiveRegistry } from "./primitives/registry.js";
import { EnterpriseContextProvider } from "./runtime/enterprise-context.js";
import { RuntimeHooks } from "./runtime/hooks.js";
import { createMaintenanceSchedulerPlugin } from "./runtime/maintenance-scheduler-plugin.js";
import { createTranscriptPlugin } from "./runtime/transcript-plugin.js";
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
import { createSandboxTools } from "./tools/sandbox-tools.js";
import { ToolRegistry } from "./tools/registry.js";
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
  const toolRegistry = new ToolRegistry([
    ...createBusinessTools(),
    ...createKnowledgeTools({ knowledgeBase }),
    ...createSandboxTools(),
    ...createMaintenanceTools(),
    ...createPluginTools(),
    ...createMemoryTools(),
    ...createTaskTools(),
    ...createEvolutionTools({ evolutionRuntime })
  ]);
  const primitiveRegistry = new PrimitiveRegistry({ toolRegistry, knowledgeBase });
  const skillRegistry = new SkillRegistryStore();
  const skillLoader = new FileSystemSkillLoader({ registryStore: skillRegistry });
  const enterpriseContextProvider = new EnterpriseContextProvider();
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
  return { agent, llm, integrations, documentSource, knowledgeBase, toolRegistry, primitiveRegistry, skillRegistry, skillLoader, skillRuntime, agenticSkillView, enterpriseContextProvider, sessionStore, scenarioRouter, userContextResolver, intentRegistry, intentRouter, intentQueryHandler, chitchatHandler, agenticHandler, evolutionRuntime, transcriptStore, hooks };
}

function normalizeAppJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue;
}
