import { loadEnvFile } from "./config/load-env.js";
import { getIntegrationConfig } from "./config/integrations.js";
import { SimpleWorkflowOrchestrator } from "./agent/orchestrator.js";
import { FileSessionStore } from "./agent/session-store.js";
import {
  LocalPermissionProvider,
  MockWeComDirectory,
  UserContextResolver,
  WeComDirectory
} from "./auth/user-context-resolver.js";
import { OpenAILLMClient } from "./llm/openai-llm.js";
import { LocalLLMClient } from "./llm/local-llm.js";
import { IntentRegistry } from "./router/intent-registry.js";
import { IntentRouter } from "./router/intent-router.js";
import { IntentQueryHandler } from "./handlers/intent-query-handler.js";
import { ChitchatHandler } from "./handlers/chitchat-handler.js";
import { AgenticHandler } from "./handlers/agentic-handler.js";
import { MockTencentDocsSource, TencentDocsSource } from "./rag/document-sources.js";
import { LocalKnowledgeBase } from "./rag/local-knowledge-base.js";
import { PrimitiveRegistry } from "./primitives/registry.js";
import { EnterpriseContextProvider } from "./runtime/enterprise-context.js";
import { FileSystemSkillLoader } from "./runtime/skill-loader.js";
import { ScenarioRouter } from "./scenarios/router.js";
import { SkillRegistryStore } from "./skills/registry-store.js";
import { SkillRuntime } from "./skills/runtime.js";
import { createBusinessTools } from "./tools/business-tools.js";
import { createKnowledgeTools } from "./tools/knowledge-tools.js";
import { createSandboxTools } from "./tools/sandbox-tools.js";
import { ToolRegistry } from "./tools/registry.js";

loadEnvFile();

export function createApp() {
  const integrations = getIntegrationConfig();
  const llm = new OpenAILLMClient();
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
    ...createSandboxTools()
  ]);
  const primitiveRegistry = new PrimitiveRegistry({ toolRegistry, knowledgeBase });
  const skillRegistry = new SkillRegistryStore();
  const skillLoader = new FileSystemSkillLoader({ registryStore: skillRegistry });
  const enterpriseContextProvider = new EnterpriseContextProvider();
  const sessionStore = new FileSessionStore();
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
  const localLLM = new LocalLLMClient();
  const intentRouter = new IntentRouter({ llm, registry: intentRegistry, localLLM });
  const intentQueryHandler = new IntentQueryHandler({ llm, toolRegistry, registry: intentRegistry });
  const chitchatHandler = new ChitchatHandler({ llm });
  const agenticHandler = new AgenticHandler({
    intentRegistry,
    intentQueryHandler,
    skillRegistry: null, // v2 接入
    toolRegistry: null   // v2 接入（需要 expose_to_agentic 标记）
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
    agenticHandler
  });
  return { agent, llm, integrations, documentSource, knowledgeBase, toolRegistry, primitiveRegistry, skillRegistry, skillLoader, skillRuntime, enterpriseContextProvider, sessionStore, scenarioRouter, userContextResolver, intentRegistry, intentRouter, intentQueryHandler, chitchatHandler, agenticHandler };
}
