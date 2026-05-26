/**
 * Engine Ports — EngineHost 的能力分组接口。
 *
 * 每个 Port 代表一组内聚的运行时能力。EngineHost 通过组合这些 Port 来
 * 提供完整的 Engine 功能，而不是把所有组件平铺在一个 God Object 上。
 *
 * Port 是接口（what），Adapter 是实现（how）。
 * 新增能力时只需新增 Port + Adapter，不需要修改 EngineHost 本身。
 */

import type { OpenAILLMClient } from "../../llm/openai-llm.js";
import type { RuntimeHooks } from "../../runtime/hooks.js";
import type { EvolutionRuntime } from "../../evolution/runtime.js";
import type { TranscriptStore } from "../../transcript/transcript-store.js";
import type { MetricsCollector } from "../../runtime/metrics-collector.js";
import type { LocalKnowledgeBase } from "../../rag/local-knowledge-base.js";
import type { TencentDocsSource, MockTencentDocsSource } from "../../rag/document-sources.js";
import type { PendingActionStore } from "../../runtime/pending-action-store.js";
import type { UserWorkspaceSessionStore } from "../../agent/session-store.js";
import type { DomainRegistry, QueryAdapterRegistry } from "../../domains/index.js";
import type { ResourceRegistry } from "../../resources/index.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { PrimitiveRegistry } from "../../primitives/registry.js";
import type { SkillRegistryStore } from "../../skills/registry-store.js";
import type { FileSystemSkillLoader } from "../../runtime/skill-loader.js";
import type { SkillRuntime } from "../../skills/runtime.js";
import type { AgenticSkillView } from "../../skills/agentic-skill-view.js";
import type { EnterpriseContextProvider } from "../../runtime/enterprise-context.js";
import type { ScenarioRouter } from "../../scenarios/router.js";
import type { UserContextResolver } from "../../auth/user-context-resolver.js";
import type { IntentRegistry } from "../../router/intent-registry.js";
import type { IntentRouter } from "../../router/intent-router.js";
import type { IntentQueryHandler } from "../../handlers/intent-query-handler.js";
import type { ChitchatHandler } from "../../handlers/chitchat-handler.js";
import type { AgenticHandler } from "../../handlers/agentic-handler.js";
import type { MessageGateway } from "../../messaging/message-gateway.js";
import type { UserCronStore } from "../../cron/user-cron-store.js";
import type { AgentCronJobRunner } from "../../cron/agent-job-runner.js";
import type { SimpleWorkflowOrchestrator } from "../../agent/orchestrator.js";
import type { BusinessQueryEngine } from "../../runtime/business-query-engine.js";

// ─── Port 定义 ───────────────────────────────────────────────────────────────

/** 基础设施：LLM、Hooks、Evolution、Transcript、Metrics */
export interface InfraPort {
  llm: OpenAILLMClient;
  hooks: RuntimeHooks;
  evolutionRuntime: EvolutionRuntime;
  transcriptStore: TranscriptStore;
  metricsCollector: MetricsCollector;
}

/** 知识库：文档源 + 本地知识库 */
export interface KnowledgePort {
  documentSource: TencentDocsSource | MockTencentDocsSource;
  knowledgeBase: LocalKnowledgeBase;
}

/** 存储：PendingAction + Session */
export interface StoragePort {
  pendingActionStore: PendingActionStore;
  sessionStore: UserWorkspaceSessionStore;
}

/** Domain 注册表：DomainRegistry + ResourceRegistry + QueryAdapterRegistry */
export interface DomainPort {
  domainRegistry: DomainRegistry;
  resourceRegistry: ResourceRegistry;
  queryAdapterRegistry: QueryAdapterRegistry;
}

/** 工具：ToolRegistry + PrimitiveRegistry */
export interface ToolPort {
  toolRegistry: ToolRegistry;
  primitiveRegistry: PrimitiveRegistry;
}

/** Skill：SkillRegistry + SkillLoader + SkillRuntime + AgenticSkillView */
export interface SkillPort {
  skillRegistry: SkillRegistryStore;
  skillLoader: FileSystemSkillLoader;
  skillRuntime: SkillRuntime;
  agenticSkillView: AgenticSkillView;
  enterpriseContextProvider: EnterpriseContextProvider;
  scenarioRouter: ScenarioRouter;
}

/** 用户上下文：UserContextResolver */
export interface UserContextPort {
  userContextResolver: UserContextResolver;
}

/** Intent 路由：IntentRegistry + IntentRouter */
export interface RoutingPort {
  intentRegistry: IntentRegistry;
  intentRouter: IntentRouter;
}

/** Handler：IntentQueryHandler + ChitchatHandler + AgenticHandler */
export interface HandlerPort {
  intentQueryHandler: IntentQueryHandler;
  chitchatHandler: ChitchatHandler;
  agenticHandler: AgenticHandler;
  agenticSkillView: AgenticSkillView;
}

/** 消息网关：MessageGateway */
export interface MessagingPort {
  messageGateway: MessageGateway;
}

/** Cron：UserCronStore + AgentCronJobRunner */
export interface CronPort {
  cronStore: UserCronStore;
  cronRunner: AgentCronJobRunner;
}

/** 顶层编排：Orchestrator + QueryEngine */
export interface OrchestratorPort {
  agent: SimpleWorkflowOrchestrator;
  queryEngine: BusinessQueryEngine;
}

// ─── 组合类型 ─────────────────────────────────────────────────────────────────

/** EngineHost 的完整能力集 = 所有 Port 的组合 */
export type EnginePorts =
  & InfraPort
  & KnowledgePort
  & StoragePort
  & DomainPort
  & ToolPort
  & SkillPort
  & UserContextPort
  & RoutingPort
  & HandlerPort
  & MessagingPort
  & CronPort
  & OrchestratorPort;
