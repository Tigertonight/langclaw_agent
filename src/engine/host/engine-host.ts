/**
 * Engine Host: EngineHost
 *
 * 薄组合器 — 通过 Adapter 工厂函数组装各 Port，提供统一的生命周期管理。
 *
 * 职责：
 * 1. 按依赖顺序调用 Adapter 工厂函数，组装完整的 Engine
 * 2. 加载和初始化 DomainPack（通过 PackLoader）
 * 3. 提供 inspect() 用于运行时诊断
 * 4. 提供 dispose() 用于优雅关闭
 *
 * 设计约束：
 * - EngineHost 不做 IO 层决策（HTTP/CLI/env 由调用方处理）
 * - 外部集成配置通过 EngineConfig 注入，不直接读 process.env
 * - DomainPack 加载失败产生清晰诊断，不静默吞错
 * - 新增能力时只需新增 Port + Adapter，不需要修改 EngineHost 本身
 */

import { setRuntimeRegistryAccessor } from "../../domains/runtime-registry.js";
import { McpRegistry, loadMcpServerConfigs, type McpServerStatus } from "../../mcp/registry.js";
import { ENGINE_API_VERSION } from "../contracts/domain-pack.js";
import { loadDomainPacks, validateAndFilterPacks, formatDiagnostics } from "./pack-loader.js";
import {
  createInfraAdapter,
  createKnowledgeAdapter,
  createStorageAdapter,
  createDomainAdapter,
  createToolAdapter,
  createSkillAdapter,
  createUserContextAdapter,
  createRoutingAdapter,
  createHandlerAdapter,
  createMessagingAdapter,
  createCronAdapter,
  createOrchestratorAdapter,
} from "./engine-adapters.js";

import type { PackLoadDiagnostic } from "./pack-loader.js";
import type { DomainPack } from "../contracts/domain-pack.js";
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

// ─── EngineConfig ────────────────────────────────────────────────────────────

/**
 * Engine 外部配置。
 * 由调用方（app.ts / test harness）注入，EngineHost 不直接读 process.env。
 */
export interface EngineConfig {
  /** 外部集成配置（WeCom、腾讯文档等） */
  integrations: {
    tencentDocs: {
      mode: string;
      baseUrl: string;
      clientId?: string;
      clientSecret?: string;
      accessToken?: string;
      refreshToken?: string;
      docIds: string[];
      contentEndpointTemplate?: string;
    };
    wecom: {
      mode: string;
      corpId?: string;
      contactSecret?: string;
      baseUrl: string;
    };
  };

  /** WeCom 应用推送凭证（可选，来自环境变量） */
  wecomApp?: {
    corpId: string;
    agentSecret: string;
    agentId: string;
  };

  /** MCP server 配置路径（可选） */
  mcpConfigPath?: string;

  /** 额外的 DomainPack（用于测试注入或动态加载） */
  extraPacks?: DomainPack[];
}

// ─── EngineInspection ────────────────────────────────────────────────────────

export interface EngineInspection {
  engineApiVersion: string;
  domains: Array<{
    id: string;
    name: string;
    version: string;
    engineApiVersion: string | undefined;
  }>;
  packDiagnostics: PackLoadDiagnostic[];
  toolCount: number;
  intentCount: number;
  resourceCount: number;
}

// ─── EngineHost ──────────────────────────────────────────────────────────────

export class EngineHost {
  // ── Ports（按依赖顺序组装） ──

  readonly infra: InfraPort;
  readonly knowledge: KnowledgePort;
  readonly storage: StoragePort;
  readonly domain: DomainPort;
  readonly tool: ToolPort;
  readonly skill: SkillPort;
  readonly userContext: UserContextPort;
  readonly routing: RoutingPort;
  readonly handler: HandlerPort;
  readonly messaging: MessagingPort;
  readonly cron: CronPort;
  readonly orchestrator: OrchestratorPort;

  // ── 向后兼容的快捷访问器（供 app.ts / HTTP server 使用） ──

  get llm() { return this.infra.llm; }
  get hooks() { return this.infra.hooks; }
  get evolutionRuntime() { return this.infra.evolutionRuntime; }
  get transcriptStore() { return this.infra.transcriptStore; }
  get metricsCollector() { return this.infra.metricsCollector; }
  get knowledgeBase() { return this.knowledge.knowledgeBase; }
  get documentSource() { return this.knowledge.documentSource; }
  get pendingActionStore() { return this.storage.pendingActionStore; }
  get sessionStore() { return this.storage.sessionStore; }
  get domainRegistry() { return this.domain.domainRegistry; }
  get resourceRegistry() { return this.domain.resourceRegistry; }
  get queryAdapterRegistry() { return this.domain.queryAdapterRegistry; }
  get toolRegistry() { return this.tool.toolRegistry; }
  get primitiveRegistry() { return this.tool.primitiveRegistry; }
  get skillRegistry() { return this.skill.skillRegistry; }
  get skillLoader() { return this.skill.skillLoader; }
  get skillRuntime() { return this.skill.skillRuntime; }
  get agenticSkillView() { return this.skill.agenticSkillView; }
  get enterpriseContextProvider() { return this.skill.enterpriseContextProvider; }
  get scenarioRouter() { return this.skill.scenarioRouter; }
  get userContextResolver() { return this.userContext.userContextResolver; }
  get intentRegistry() { return this.routing.intentRegistry; }
  get intentRouter() { return this.routing.intentRouter; }
  get intentQueryHandler() { return this.handler.intentQueryHandler; }
  get chitchatHandler() { return this.handler.chitchatHandler; }
  get agenticHandler() { return this.handler.agenticHandler; }
  get messageGateway() { return this.messaging.messageGateway; }
  get cronStore() { return this.cron.cronStore; }
  get cronRunner() { return this.cron.cronRunner; }
  get agent() { return this.orchestrator.agent; }
  get queryEngine() { return this.orchestrator.queryEngine; }

  // ── 内部状态 ──

  private readonly config: EngineConfig;
  private packDiagnostics: PackLoadDiagnostic[] = [];
  private mcpRegistry: McpRegistry | null = null;
  private initialized = false;

  constructor(config: EngineConfig) {
    this.config = config;

    // 按依赖顺序组装各 Port
    this.infra = createInfraAdapter();
    this.knowledge = createKnowledgeAdapter(config);
    this.storage = createStorageAdapter();
    this.domain = createDomainAdapter();
    this.tool = createToolAdapter({
      infra: this.infra,
      knowledge: this.knowledge,
      storage: this.storage,
      domain: this.domain,
    });
    this.skill = createSkillAdapter({
      infra: this.infra,
      tool: this.tool,
    });
    this.userContext = createUserContextAdapter(config);
    this.routing = createRoutingAdapter({
      infra: this.infra,
      domain: this.domain,
    });
    this.handler = createHandlerAdapter({
      infra: this.infra,
      domain: this.domain,
      tool: this.tool,
      skill: this.skill,
      routing: this.routing,
    });
    this.messaging = createMessagingAdapter({
      config,
      tool: this.tool,
    });
    this.cron = createCronAdapter({
      handler: this.handler,
      messaging: this.messaging,
      tool: this.tool,
    });
    this.orchestrator = createOrchestratorAdapter({
      infra: this.infra,
      knowledge: this.knowledge,
      storage: this.storage,
      tool: this.tool,
      skill: this.skill,
      userContext: this.userContext,
      routing: this.routing,
      handler: this.handler,
    });
  }

  // ── 异步初始化 ─────────────────────────────────────────────────────────

  /**
   * 初始化 Engine：发现、验证、加载 DomainPack，激活声明式配置分发。
   *
   * 必须在构造后、使用前调用。
   * 加载失败的 pack 会产生诊断日志，不会阻塞其他 pack。
   */
  async init(): Promise<void> {
    if (this.initialized) {
      console.warn("[EngineHost] 已初始化，跳过重复调用。");
      return;
    }

    // 1. 发现并验证 DomainPack
    const loadResult = await loadDomainPacks();
    this.packDiagnostics = loadResult.diagnostics;

    // 合并额外注入的 pack（测试/动态加载场景）
    const extraPacks = this.config.extraPacks ?? [];
    if (extraPacks.length > 0) {
      const extraResult = validateAndFilterPacks(extraPacks);
      loadResult.packs.push(...extraResult.packs);
      this.packDiagnostics.push(...extraResult.diagnostics);
    }

    // 输出加载诊断
    console.log(formatDiagnostics(this.packDiagnostics));

    // 2. 注册到 DomainRegistry
    this.domainRegistry.registerMany(loadResult.packs);

    // 3. 初始化 DomainRegistry（拓扑排序 → init → 声明式收集 → register 逃生口）
    await this.domainRegistry.initialize({
      registrationContext: {
        toolRegistry: this.toolRegistry,
        intentRegistry: this.intentRegistry,
        commandRegistry: this.intentRouter.commands,
        deterministicRules: {
          add: () => { /* 已通过声明式收集 */ },
          addMany: () => { /* 已通过声明式收集 */ },
        },
        catalogRegistry: {
          add: () => { /* 已通过声明式收集 */ },
        },
        surfaceRegistry: {
          add: () => { /* 已通过声明式收集 */ },
        },
        scenarioRouter: this.scenarioRouter,
      },
    });

    // 4. 设置全局 RuntimeRegistryAccessor
    setRuntimeRegistryAccessor(this.domainRegistry);

    // 5. 分发声明式配置到各注册表
    this.resourceRegistry.registerMany(this.domainRegistry.allResources);
    this.resourceRegistry.registerFieldLabels(this.domainRegistry.allFieldLabels);
    this.queryAdapterRegistry.registerMany(this.domainRegistry.allQueryAdapters);
    this.intentRouter.commands.registerAll(this.domainRegistry.allCommands);

    if (this.domainRegistry.allIntentManifests.length > 0) {
      this.intentRegistry.registerMany(this.domainRegistry.allIntentManifests);
    }

    for (const tool of this.domainRegistry.allTools) {
      this.toolRegistry.register(tool);
    }

    // 6. 挂载 DomainPack 声明的 RuntimePlugin
    //    按 priority ASC 排序；同 id 仅挂载第一个并打 warn 日志。
    const sortedPlugins = [...this.domainRegistry.allRuntimePlugins].sort(
      (a, b) => (a.priority ?? 100) - (b.priority ?? 100)
    );
    const seenPluginIds = new Set<string>();
    for (const def of sortedPlugins) {
      if (seenPluginIds.has(def.id)) {
        console.warn(`[EngineHost] duplicate runtime plugin '${def.id}', skipped`);
        continue;
      }
      seenPluginIds.add(def.id);
      this.infra.hooks.use(def.plugin);
    }

    this.initialized = true;
  }

  // ── MCP Server 附加 ────────────────────────────────────────────────────

  /**
   * 启动 MCP client，把 tool 注入 ToolRegistry。
   * 返回 McpRegistry 句柄供调用方在退出时 stop()。
   */
  async attachMcpServers(): Promise<{ registry: McpRegistry; statuses: McpServerStatus[] }> {
    const configs = await loadMcpServerConfigs(this.config.mcpConfigPath);
    const registry = new McpRegistry();
    if (configs.length === 0) {
      this.mcpRegistry = registry;
      return { registry, statuses: [] };
    }
    const statuses = await registry.start({
      configs,
      register: (tool) => this.toolRegistry.register(tool),
      onStartupError: (id, err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[mcp] server '${id}' failed to start: ${message}`);
      },
    });
    this.mcpRegistry = registry;
    return { registry, statuses };
  }

  // ── 诊断 ───────────────────────────────────────────────────────────────

  /**
   * 输出 Engine 运行时元数据快照，用于调试和治理。
   */
  inspect(): EngineInspection {
    return {
      engineApiVersion: ENGINE_API_VERSION,
      domains: this.domainRegistry.list().map((pack) => ({
        id: pack.id,
        name: pack.name,
        version: pack.version ?? "0.0.0",
        engineApiVersion: pack.engineApiVersion,
      })),
      packDiagnostics: this.packDiagnostics,
      toolCount: this.toolRegistry.list().length,
      intentCount: this.intentRegistry.listCodes().length,
      resourceCount: Object.keys(this.domainRegistry.allResources).length,
    };
  }

  // ── 优雅关闭 ───────────────────────────────────────────────────────────

  /**
   * 优雅关闭 Engine：dispose DomainPack、停止 MCP server。
   */
  async dispose(): Promise<void> {
    await this.domainRegistry.dispose({ reason: "engine_shutdown" });
    if (this.mcpRegistry) {
      await this.mcpRegistry.stop();
    }
  }
}
