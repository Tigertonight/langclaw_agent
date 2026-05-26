/**
 * DomainRegistry：DomainPack 的注册中心和生命周期管理器。
 *
 * 职责：
 * 1. 接收 DomainPack 注册（register / registerMany）
 * 2. 拓扑排序验证依赖关系
 * 3. 按序执行 init → 声明式配置分发 → register() 逃生口 → 就绪
 * 4. 提供 dispose() 用于 runtime 关闭时清理
 *
 * 规则合并排序语义：
 *   priority ASC → domainOrder ASC → declarationIndex ASC
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  DomainPack,
  DomainInitContext,
  DomainRegistrationContext,
  DomainDisposeContext,
  DeterministicRuleDefinition,
  DomainSurfaceBuilder,
  CatalogDomainDefinition,
  CronTemplateDefinition,
  QueryResourceSchema,
  DomainQueryAdapter,
  AgenticFallbackDefinition,
  ReportComposerDefinition,
  EvidenceInferenceDefinition,
  FactExtractorDefinition,
  RuntimePluginDefinition,
  LocalPolicyQuestionPattern,
  LocalPlannerHeuristic,
  SkillMappingDefinition,
  ExtractorFn,
  FilterTransformFn,
  PermissionRuleFn,
  ToolPermissionPolicy,
  UserFieldSourceDefinition,
  MutableIntentRegistry,
  DeterministicRuleCollector,
  CatalogDomainCollector,
  SurfaceBuilderCollector,
  ScenarioRegistrar,
} from "./types.js";
import type { IntentManifest, ToolDefinition } from "../types/agent-contracts.js";
import type { CommandDefinition } from "../router/command-registry.js";
import type { FieldLabels } from "../resources/types.js";

// ─── Internal bookkeeping ────────────────────────────────────────────────────

interface RegisteredDomain {
  pack: DomainPack;
  /** 注册顺序（用于 domainOrder tiebreak） */
  order: number;
}

// ─── DomainRegistry ──────────────────────────────────────────────────────────

export class DomainRegistry {
  private readonly domains = new Map<string, RegisteredDomain>();
  private readonly sorted: RegisteredDomain[] = [];
  private initialized = false;

  // ── 收集到的声明式配置（供 runtime 消费） ──────────────────────────────

  /** 所有 domain 注册的工具（按 domain 注册顺序） */
  readonly allTools: ToolDefinition[] = [];
  /** 所有 domain 注册的命令（按 domain 注册顺序） */
  readonly allCommands: CommandDefinition[] = [];
  /** 所有 domain 注册的确定性规则（按 priority / domainOrder / declarationIndex 排序） */
  readonly allDeterministicRules: DeterministicRuleDefinition[] = [];
  /** 所有 domain 注册的意图清单 */
  readonly allIntentManifests: IntentManifest[] = [];
  /** 所有 domain 注册的 Surface builder（按 priority / 注册顺序排序） */
  readonly allSurfaceBuilders: DomainSurfaceBuilder[] = [];
  /** 所有 domain 注册的 Catalog domain 定义 */
  readonly allCatalogDomains: CatalogDomainDefinition[] = [];
  /** 所有 domain 注册的 QueryAdapter */
  readonly allQueryAdapters: DomainQueryAdapter[] = [];
  /** 所有 domain 注册的 extractors（合并后的全局 extractor 注册表） */
  readonly allExtractors: Record<string, ExtractorFn> = {};
  /** 所有 domain 注册的 filterTransforms（合并后的全局 filter transform 注册表） */
  readonly allFilterTransforms: Record<string, FilterTransformFn> = {};
  /** 所有 domain 注册的 permissionRules（按 domain 注册顺序） */
  readonly allPermissionRules: PermissionRuleFn[] = [];
  /** 所有 domain 注册的 toolPermissionPolicies（按 domain 注册顺序） */
  readonly allToolPermissionPolicies: ToolPermissionPolicy[] = [];
  /** 所有 domain 注册的 fieldLabels（合并后的全局字段标签） */
  readonly allFieldLabels: Record<string, string> = {};
  /** 所有 domain 注册的 resources（合并后的全局资源配置） */
  readonly allResources: Record<string, import("../resources/types.js").ResourceConfig> = {};
  /** 所有 domain 注册的 toolLabels（合并后的全局工具标签） */
  readonly allToolLabels: Record<string, string> = {};
  /** 所有 domain 注册的 cronTemplates */
  readonly allCronTemplates: CronTemplateDefinition[] = [];
  /** 所有 domain 注册的 routerPromptHints */
  readonly allRouterPromptHints: string[] = [];
  /** 所有 domain 注册的 intentCodeMappings（resource → intent_code） */
  readonly allIntentCodeMappings: Record<string, string> = {};
  /** 所有 domain 注册的 factKeyMappings（resource → fact key） */
  readonly allFactKeyMappings: Record<string, string> = {};
  /** 所有 domain 注册的 answerPromptHints */
  readonly allAnswerPromptHints: string[] = [];
  /** 所有 domain 注册的 querySchemas（resource → QueryResourceSchema） */
  readonly allQuerySchemas: Record<string, QueryResourceSchema> = {};
  /** 所有 domain 注册的 resourceDetectionKeywords（resource → keywords[]） */
  readonly allResourceDetectionKeywords: Record<string, string[]> = {};
  /** 所有 domain 注册的 agenticFallbacks */
  readonly allAgenticFallbacks: AgenticFallbackDefinition[] = [];
  /** 所有 domain 注册的 reportComposers */
  readonly allReportComposers: ReportComposerDefinition[] = [];
  /** 所有 domain 注册的 evidenceInferenceFns */
  readonly allEvidenceInferenceFns: EvidenceInferenceDefinition[] = [];
  /** 所有 domain 注册的 skillMappings */
  readonly allSkillMappings: SkillMappingDefinition[] = [];
  /** 所有 domain 注册的 slotUpdateDetectors */
  readonly allSlotUpdateDetectors: Record<string, (message: string) => boolean> = {};
  /** 所有 domain 注册的 skillContractEnforcers */
  readonly allSkillContractEnforcers: import("./types.js").SkillContractEnforcer[] = [];
  /** 所有 domain 注册的 intentCodeInferenceFns */
  readonly allIntentCodeInferenceFns: import("./types.js").IntentCodeInferenceFn[] = [];
  /** 所有 domain 注册的 correctionDeltaRules */
  readonly allCorrectionDeltaRules: import("./types.js").CorrectionDeltaRule[] = [];
  /** 所有 domain 注册的 classifierIntents（intent name → 描述） */
  readonly allClassifierIntents: Record<string, string> = {};
  /** 所有 domain 注册的 dataQueryKeywords */
  readonly allDataQueryKeywords: string[] = [];
  /** 所有 domain 注册的 classificationKeywords（intent → 关键词数组） */
  readonly allClassificationKeywords: Record<string, string[]> = {};
  /** 所有 domain 注册的 classificationPatterns（intent → 正则数组） */
  readonly allClassificationPatterns: Record<string, RegExp[]> = {};
  /** 所有 domain 注册的 capabilityDescriptions */
  readonly allCapabilityDescriptions: string[] = [];
  /** 所有 domain 注册的 standaloneTaskKeywords */
  readonly allStandaloneTaskKeywords: string[] = [];
  /** 所有 domain 注册的 surfacePlugins（A2UI SurfacePlugin 协议） */
  readonly allSurfacePlugins: import("../a2ui/plugins/types.js").SurfacePlugin<unknown>[] = [];
  /** 所有 domain 注册的 shortCorrectionPatterns */
  readonly allShortCorrectionPatterns: RegExp[] = [];
  /** 所有 domain 注册的 metricKeywordMappings */
  readonly allMetricKeywordMappings: Array<[RegExp, string]> = [];
  /** 所有 domain 注册的 intentMappings（intent ↔ intentCode 双向映射） */
  readonly allIntentMappings: Record<string, string> = {};
  /** 所有 domain 注册的 chatPageRenderers（前端组件渲染器代码片段） */
  readonly allChatPageRenderers: Array<{ name: string; code: string }> = [];
  /** 所有 domain 注册的 entityAliases（正式名称 → 别名数组） */
  readonly allEntityAliases: Record<string, string[]> = {};
  /** 所有 domain 注册的 entityAliasSuffixRules */
  readonly allEntityAliasSuffixRules: Array<{ suffix: string; replacement: string }> = [];
  /**
   * 所有 domain 注册的 RuntimePlugin 声明。
   * 由 EngineHost 在 init() 末尾按 priority 排序、按 id 去重后挂载到 RuntimeHooks。
   */
  readonly allRuntimePlugins: RuntimePluginDefinition[] = [];
  /** 本地 LLM 策略问题模式（业务"制度/政策"类问题） */
  readonly allLocalPolicyQuestionPatterns: LocalPolicyQuestionPattern[] = [];
  /** 本地 LLM 兜底规划启发式 */
  readonly allLocalPlannerHeuristics: LocalPlannerHeuristic[] = [];
  /** 知识库检索关键词（合并去重） */
  readonly allKnowledgeRetrievalKeywords: string[] = [];
  /** 所有 domain 注册的 agentic question patterns */
  readonly allAgenticQuestionPatterns: RegExp[] = [];
  /** 所有 domain 注册的危险关键词（去重） */
  readonly allDangerousQuestionKeywords: string[] = [];
  /** 所有 domain 注册的知识库 chunk heading 启发式 */
  readonly allKnowledgeChunkHeadingHints: import("./types.js").KnowledgeChunkHeadingHint[] = [];
  /** 所有 domain 注册的重要句关键词（去重） */
  readonly allImportantSentenceKeywords: string[] = [];
  /** 所有 domain 注册的 fact extractor（按 resource 路由） */
  readonly allFactExtractors: FactExtractorDefinition[] = [];
  /** 所有 domain 注册的 scope sentinel（去重） */
  readonly allScopeSentinels: string[] = [];
  /** 所有 domain 注册的 user field source（按 name 路由） */
  readonly allUserFieldSources: UserFieldSourceDefinition[] = [];
  /** 所有 domain 注册的取消/放弃短语（去重） */
  readonly allCancellationPhrases: string[] = [];
  /** 所有 domain 注册的 router 抽参示例（按注册顺序） */
  readonly allParamExtractionExamples: string[] = [];
  /** 已注册 DomainPack 的元数据快照，用于动态加载和冲突诊断。 */
  readonly domainMetadata: Array<{ id: string; name: string; version: string; conflictPolicy: string; order: number }> = [];

  // ── 注册 ───────────────────────────────────────────────────────────────

  /**
   * 注册单个 DomainPack。
   * 重复 id 会被忽略（warn 日志）。
   */
  register(pack: DomainPack): void {
    if (this.initialized) {
      throw new Error(`[DomainRegistry] 已初始化后不能再注册 domain: ${pack.id}`);
    }
    if (this.domains.has(pack.id)) {
      console.warn(`[DomainRegistry] domain '${pack.id}' 已注册，跳过重复注册。`);
      return;
    }
    this.validatePackMetadata(pack);
    this.domains.set(pack.id, { pack, order: this.domains.size });
  }

  /**
   * 初始化前移除 DomainPack。动态加载/卸载的最小边界：
   * runtime 初始化后不能热卸载，避免注册表和已持有实例不一致。
   */
  unregister(id: string): boolean {
    if (this.initialized) {
      throw new Error(`[DomainRegistry] 已初始化后不能卸载 domain: ${id}`);
    }
    return this.domains.delete(id);
  }

  /**
   * 批量注册 DomainPack。
   */
  registerMany(packs: DomainPack[]): void {
    for (const pack of packs) this.register(pack);
  }

  // ── 初始化 ─────────────────────────────────────────────────────────────

  /**
   * 初始化所有已注册的 DomainPack。
   *
   * 流程：
   * 1. 拓扑排序验证依赖关系
   * 2. 按拓扑序执行 init()
   * 3. 收集声明式配置
   * 4. 如果提供了 registrationContext，执行 register() 逃生口
   */
  async initialize(options: {
    initContext?: DomainInitContext;
    registrationContext?: DomainRegistrationContext;
  } = {}): Promise<void> {
    if (this.initialized) {
      console.warn("[DomainRegistry] 已初始化，跳过重复调用。");
      return;
    }

    // 1. 拓扑排序
    this.topologicalSort();

    const initCtx: DomainInitContext = options.initContext ?? {
      cwd: process.cwd(),
      env: process.env as Record<string, string | undefined>,
    };

    // 2. 按拓扑序执行 init()
    for (const { pack } of this.sorted) {
      if (pack.init) {
        try {
          await pack.init(initCtx);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`[DomainRegistry] domain '${pack.id}' init() 失败: ${msg}`);
        }
      }
    }

    // 3. 收集声明式配置
    this.collectDeclarativeConfigs();

    // 4. 执行 register() 逃生口
    if (options.registrationContext) {
      await this.executeRegisterHooks(options.registrationContext);
    }

    this.initialized = true;
  }

  // ── 销毁 ───────────────────────────────────────────────────────────────

  /**
   * 按注册逆序执行 dispose()。
   */
  async dispose(ctx: DomainDisposeContext = {}): Promise<void> {
    // 逆序 dispose
    for (let i = this.sorted.length - 1; i >= 0; i--) {
      const { pack } = this.sorted[i];
      if (pack.dispose) {
        try {
          await pack.dispose(ctx);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[DomainRegistry] domain '${pack.id}' dispose() 失败: ${msg}`);
        }
      }
    }
  }

  // ── 查询 ───────────────────────────────────────────────────────────────

  get(id: string): DomainPack | undefined {
    return this.domains.get(id)?.pack;
  }

  list(): DomainPack[] {
    return this.sorted.map((d) => d.pack);
  }

  has(id: string): boolean {
    return this.domains.has(id);
  }

  get size(): number {
    return this.domains.size;
  }

  get isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * 查找资源的中文标签。
   * 优先使用 ResourceConfig.label，否则返回 fallback。
   */
  getResourceLabel(resource: string, fallback = "业务数据"): string {
    return this.allResources[resource]?.label ?? fallback;
  }

  /**
   * 查找资源的 fact key。
   * 优先使用 allFactKeyMappings，否则使用 ResourceConfig.factKey，否则返回 resource 本身。
   */
  getFactKey(resource: string): string {
    return this.allFactKeyMappings[resource] ?? this.allResources[resource]?.factKey ?? resource;
  }

  /**
   * 查找资源的 row template。
   */
  getRowTemplate(resource: string): import("../resources/types.js").ResourceConfig["rowTemplate"] | undefined {
    return this.allResources[resource]?.rowTemplate;
  }

  /**
   * 查找资源的 debug fields。
   */
  getDebugFields(resource: string): string[] | undefined {
    return this.allResources[resource]?.debugFields;
  }

  /**
   * 查找资源的 schema。
   */
  getResourceSchema(resource: string): import("../resources/types.js").ResourceConfig["schema"] | undefined {
    return this.allResources[resource]?.schema;
  }

  /**
   * 获取所有已注册资源的 id 列表。
   */
  getResourceIds(): string[] {
    return Object.keys(this.allResources);
  }

  /**
   * 查找工具的中文标签。
   */
  getToolLabel(toolName: string, fallback?: string): string {
    return this.allToolLabels[toolName] ?? fallback ?? toolName;
  }

  /**
   * 根据 resource 查找对应的 intent_code。
   */
  getIntentCode(resource: string): string | undefined {
    return this.allIntentCodeMappings[resource];
  }

  private validatePackMetadata(pack: DomainPack): void {
    if (pack.version && !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(pack.version)) {
      throw new Error(`[DomainRegistry] domain '${pack.id}' version 必须是 semver 形态，当前为 '${pack.version}'。`);
    }
    if (pack.conflictPolicy && !["warn", "error", "override"].includes(pack.conflictPolicy)) {
      throw new Error(`[DomainRegistry] domain '${pack.id}' conflictPolicy 无效：${pack.conflictPolicy}`);
    }
  }

  // ── 内部：拓扑排序 ────────────────────────────────────────────────────

  private topologicalSort(): void {
    const ids = new Set(this.domains.keys());

    // 验证依赖
    for (const [id, { pack }] of this.domains) {
      for (const dep of pack.dependencies ?? []) {
        if (!ids.has(dep)) {
          throw new Error(
            `[DomainRegistry] domain '${id}' 声明了强依赖 '${dep}'，但该 domain 未注册。`
          );
        }
      }
      for (const dep of pack.optionalDependencies ?? []) {
        if (!ids.has(dep)) {
          console.warn(
            `[DomainRegistry] domain '${id}' 声明了可选依赖 '${dep}'，但该 domain 未注册。`
          );
        }
      }
    }

    // Kahn's algorithm
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();
    for (const id of ids) {
      inDegree.set(id, 0);
      adjacency.set(id, []);
    }
    for (const [id, { pack }] of this.domains) {
      for (const dep of pack.dependencies ?? []) {
        adjacency.get(dep)!.push(id);
        inDegree.set(id, (inDegree.get(id) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree) {
      if (degree === 0) queue.push(id);
    }

    // 稳定排序：同层级按注册顺序
    queue.sort((a, b) => (this.domains.get(a)!.order - this.domains.get(b)!.order));

    const result: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) {
          // 插入排序保持注册顺序
          const neighborOrder = this.domains.get(neighbor)!.order;
          let insertIdx = queue.length;
          for (let i = 0; i < queue.length; i++) {
            if (this.domains.get(queue[i])!.order > neighborOrder) {
              insertIdx = i;
              break;
            }
          }
          queue.splice(insertIdx, 0, neighbor);
        }
      }
    }

    if (result.length !== ids.size) {
      const missing = [...ids].filter((id) => !result.includes(id));
      throw new Error(
        `[DomainRegistry] 检测到循环依赖，涉及 domain: ${missing.join(", ")}`
      );
    }

    this.sorted.length = 0;
    for (const id of result) {
      this.sorted.push(this.domains.get(id)!);
    }
  }

  // ── 内部：收集声明式配置 ──────────────────────────────────────────────

  private collectDeclarativeConfigs(): void {
    // 清空
    this.allTools.length = 0;
    this.allCommands.length = 0;
    this.allDeterministicRules.length = 0;
    this.allIntentManifests.length = 0;
    this.allSurfaceBuilders.length = 0;
    this.allCatalogDomains.length = 0;
    this.allQueryAdapters.length = 0;
    this.allPermissionRules.length = 0;
    this.allToolPermissionPolicies.length = 0;
    this.allCronTemplates.length = 0;
    this.allRouterPromptHints.length = 0;
    this.allAnswerPromptHints.length = 0;
    this.allAgenticFallbacks.length = 0;
    this.allReportComposers.length = 0;
    this.allEvidenceInferenceFns.length = 0;
    this.allSkillMappings.length = 0;
    this.allSkillContractEnforcers.length = 0;
    this.allIntentCodeInferenceFns.length = 0;
    this.allCorrectionDeltaRules.length = 0;
    this.allDataQueryKeywords.length = 0;
    this.allCapabilityDescriptions.length = 0;
    this.allStandaloneTaskKeywords.length = 0;
    this.allSurfacePlugins.length = 0;
    this.allShortCorrectionPatterns.length = 0;
    this.allMetricKeywordMappings.length = 0;
    this.allChatPageRenderers.length = 0;
    this.allEntityAliasSuffixRules.length = 0;
    this.allRuntimePlugins.length = 0;
    this.allLocalPolicyQuestionPatterns.length = 0;
    this.allLocalPlannerHeuristics.length = 0;
    this.allKnowledgeRetrievalKeywords.length = 0;
    this.allAgenticQuestionPatterns.length = 0;
    this.allDangerousQuestionKeywords.length = 0;
    this.allKnowledgeChunkHeadingHints.length = 0;
    this.allImportantSentenceKeywords.length = 0;
    this.allFactExtractors.length = 0;
    this.allScopeSentinels.length = 0;
    this.allUserFieldSources.length = 0;
    this.allCancellationPhrases.length = 0;
    this.allParamExtractionExamples.length = 0;
    this.domainMetadata.length = 0;
    // 清空 object 类型的收集器
    for (const key of Object.keys(this.allExtractors)) delete this.allExtractors[key];
    for (const key of Object.keys(this.allFilterTransforms)) delete this.allFilterTransforms[key];
    for (const key of Object.keys(this.allFieldLabels)) delete this.allFieldLabels[key];
    for (const key of Object.keys(this.allResources)) delete this.allResources[key];
    for (const key of Object.keys(this.allToolLabels)) delete this.allToolLabels[key];
    for (const key of Object.keys(this.allIntentCodeMappings)) delete this.allIntentCodeMappings[key];
    for (const key of Object.keys(this.allFactKeyMappings)) delete this.allFactKeyMappings[key];
    for (const key of Object.keys(this.allQuerySchemas)) delete this.allQuerySchemas[key];
    for (const key of Object.keys(this.allResourceDetectionKeywords)) delete this.allResourceDetectionKeywords[key];
    for (const key of Object.keys(this.allSlotUpdateDetectors)) delete this.allSlotUpdateDetectors[key];
    for (const key of Object.keys(this.allClassifierIntents)) delete this.allClassifierIntents[key];
    for (const key of Object.keys(this.allClassificationKeywords)) delete this.allClassificationKeywords[key];
    for (const key of Object.keys(this.allClassificationPatterns)) delete this.allClassificationPatterns[key];
    for (const key of Object.keys(this.allIntentMappings)) delete this.allIntentMappings[key];
    for (const key of Object.keys(this.allEntityAliases)) delete this.allEntityAliases[key];

    // 临时收集规则（需要排序）
    const ruleEntries: Array<{
      rule: DeterministicRuleDefinition;
      domainOrder: number;
      declarationIndex: number;
    }> = [];

    // 临时收集 surface builder（需要排序）
    const surfaceEntries: Array<{
      builder: DomainSurfaceBuilder;
      domainOrder: number;
      declarationIndex: number;
    }> = [];

    for (const { pack, order } of this.sorted) {
      this.domainMetadata.push({
        id: pack.id,
        name: pack.name,
        version: pack.version ?? "0.0.0",
        conflictPolicy: pack.conflictPolicy ?? "warn",
        order
      });
      // Resources
      if (pack.resources) {
        mergeRecordWithConflict(this.allResources, pack.resources, { domainId: pack.id, kind: "resource", policy: pack.conflictPolicy });
      }

      // Tools
      if (pack.tools) {
        assertUniqueByName(pack.tools, { domainId: pack.id, kind: "tool", policy: pack.conflictPolicy });
        for (const tool of pack.tools) {
          if (this.allTools.some((item) => item.name === tool.name)) {
            handleConflict({ domainId: pack.id, kind: "tool", key: tool.name, policy: pack.conflictPolicy });
          }
        }
        this.allTools.push(...pack.tools);
      }

      // Commands
      if (pack.commands) {
        this.allCommands.push(...pack.commands);
      }

      // Deterministic Rules
      if (pack.deterministicRules) {
        for (let i = 0; i < pack.deterministicRules.length; i++) {
          ruleEntries.push({
            rule: pack.deterministicRules[i],
            domainOrder: order,
            declarationIndex: i,
          });
        }
      }

      // Extractors
      if (pack.extractors) {
        mergeRecordWithConflict(this.allExtractors, pack.extractors, { domainId: pack.id, kind: "extractor", policy: pack.conflictPolicy });
      }

      // Filter Transforms
      if (pack.filterTransforms) {
        mergeRecordWithConflict(this.allFilterTransforms, pack.filterTransforms, { domainId: pack.id, kind: "filterTransform", policy: pack.conflictPolicy });
      }

      // Field Labels
      if (pack.fieldLabels) {
        Object.assign(this.allFieldLabels, pack.fieldLabels);
      }

      // Intent Manifests（内联声明）
      if (pack.intentManifests) {
        assertUniqueIntentManifests(pack.intentManifests, { domainId: pack.id, policy: pack.conflictPolicy });
        for (const manifest of pack.intentManifests) {
          if (this.allIntentManifests.some((item) => item.intent_code === manifest.intent_code)) {
            handleConflict({ domainId: pack.id, kind: "intent", key: manifest.intent_code, policy: pack.conflictPolicy });
          }
        }
        this.allIntentManifests.push(...pack.intentManifests);
      }

      // Intent Manifests（从 intentDir 目录加载 *.json）
      if (pack.intentDir) {
        const loaded = loadIntentManifestsFromDir(pack.intentDir, pack.id);
        assertUniqueIntentManifests(loaded, { domainId: pack.id, policy: pack.conflictPolicy });
        for (const manifest of loaded) {
          if (this.allIntentManifests.some((item) => item.intent_code === manifest.intent_code)) {
            handleConflict({ domainId: pack.id, kind: "intent", key: manifest.intent_code, policy: pack.conflictPolicy });
          }
        }
        this.allIntentManifests.push(...loaded);
      }

      // Surface Builders
      if (pack.surfaces) {
        for (let i = 0; i < pack.surfaces.length; i++) {
          surfaceEntries.push({
            builder: pack.surfaces[i],
            domainOrder: order,
            declarationIndex: i,
          });
        }
      }

      // Catalog Domains
      if (pack.catalogDomains) {
        this.allCatalogDomains.push(...pack.catalogDomains);
      }

      // Query Adapters
      if (pack.queryAdapters) {
        this.allQueryAdapters.push(...pack.queryAdapters);
      }

      // Permission Rules
      if (pack.permissionRules) {
        this.allPermissionRules.push(...pack.permissionRules);
      }
      if (pack.toolPermissionPolicies) {
        this.allToolPermissionPolicies.push(...pack.toolPermissionPolicies);
      }

      // Tool Labels
      if (pack.toolLabels) {
        Object.assign(this.allToolLabels, pack.toolLabels);
      }

      // Cron Templates
      if (pack.cronTemplates) {
        this.allCronTemplates.push(...pack.cronTemplates);
      }

      // Router Prompt Hints
      if (pack.routerPromptHints) {
        this.allRouterPromptHints.push(...pack.routerPromptHints);
      }

      // Intent Code Mappings
      if (pack.intentCodeMappings) {
        Object.assign(this.allIntentCodeMappings, pack.intentCodeMappings);
      }

      // Fact Key Mappings
      if (pack.factKeyMappings) {
        Object.assign(this.allFactKeyMappings, pack.factKeyMappings);
      }

      // Answer Prompt Hints
      if (pack.answerPromptHints) {
        this.allAnswerPromptHints.push(...pack.answerPromptHints);
      }

      // Query Schemas
      if (pack.querySchemas) {
        Object.assign(this.allQuerySchemas, pack.querySchemas);
      }

      // Resource Detection Keywords
      if (pack.resourceDetectionKeywords) {
        for (const [resource, keywords] of Object.entries(pack.resourceDetectionKeywords)) {
          if (!this.allResourceDetectionKeywords[resource]) {
            this.allResourceDetectionKeywords[resource] = [];
          }
          this.allResourceDetectionKeywords[resource].push(...keywords);
        }
      }

      // Agentic Fallbacks
      if (pack.agenticFallbacks) {
        this.allAgenticFallbacks.push(...pack.agenticFallbacks);
      }

      // Report Composers
      if (pack.reportComposers) {
        this.allReportComposers.push(...pack.reportComposers);
      }

      // Evidence Inference Functions
      if (pack.evidenceInferenceFns) {
        this.allEvidenceInferenceFns.push(...pack.evidenceInferenceFns);
      }

      // Skill Mappings
      if (pack.skillMappings) {
        this.allSkillMappings.push(...pack.skillMappings);
      }

      // Slot Update Detectors
      if (pack.slotUpdateDetectors) {
        Object.assign(this.allSlotUpdateDetectors, pack.slotUpdateDetectors);
      }

      // Skill Contract Enforcers
      if (pack.skillContractEnforcers) {
        this.allSkillContractEnforcers.push(...pack.skillContractEnforcers);
      }

      // Intent Code Inference Functions
      if (pack.intentCodeInferenceFns) {
        this.allIntentCodeInferenceFns.push(...pack.intentCodeInferenceFns);
      }

      // Classifier Intents
      if (pack.classifierIntents) {
        Object.assign(this.allClassifierIntents, pack.classifierIntents);
      }

      // Data Query Keywords
      if (pack.dataQueryKeywords) {
        this.allDataQueryKeywords.push(...pack.dataQueryKeywords);
      }

      // Classification Keywords
      if (pack.classificationKeywords) {
        for (const [intent, keywords] of Object.entries(pack.classificationKeywords)) {
          if (!this.allClassificationKeywords[intent]) {
            this.allClassificationKeywords[intent] = [];
          }
          this.allClassificationKeywords[intent].push(...keywords);
        }
      }

      // Classification Patterns
      if (pack.classificationPatterns) {
        for (const [intent, patterns] of Object.entries(pack.classificationPatterns)) {
          if (!this.allClassificationPatterns[intent]) {
            this.allClassificationPatterns[intent] = [];
          }
          this.allClassificationPatterns[intent].push(...patterns);
        }
      }

      // Capability Descriptions
      if (pack.capabilityDescriptions) {
        this.allCapabilityDescriptions.push(...pack.capabilityDescriptions);
      }

      // Standalone Task Keywords
      if (pack.standaloneTaskKeywords) {
        this.allStandaloneTaskKeywords.push(...pack.standaloneTaskKeywords);
      }

      // Correction Delta Rules
      if (pack.correctionDeltaRules) {
        this.allCorrectionDeltaRules.push(...pack.correctionDeltaRules);
      }

      // Surface Plugins (A2UI SurfacePlugin 协议)
      if (pack.surfacePlugins) {
        this.allSurfacePlugins.push(...pack.surfacePlugins);
      }

      // Short Correction Patterns
      if (pack.shortCorrectionPatterns) {
        this.allShortCorrectionPatterns.push(...pack.shortCorrectionPatterns);
      }

      // Metric Keyword Mappings
      if (pack.metricKeywordMappings) {
        this.allMetricKeywordMappings.push(...pack.metricKeywordMappings);
      }

      // Intent Mappings (intent ↔ intentCode)
      if (pack.intentMappings) {
        Object.assign(this.allIntentMappings, pack.intentMappings);
      }

      // Chat Page Renderers（前端组件渲染器代码片段）
      if (pack.chatPageRenderers) {
        this.allChatPageRenderers.push(...pack.chatPageRenderers);
      }

      // Entity Aliases（正式名称 → 别名数组，同名 key 合并去重）
      if (pack.entityAliases) {
        for (const [name, aliases] of Object.entries(pack.entityAliases)) {
          if (!this.allEntityAliases[name]) {
            this.allEntityAliases[name] = [];
          }
          for (const alias of aliases) {
            if (!this.allEntityAliases[name].includes(alias)) {
              this.allEntityAliases[name].push(alias);
            }
          }
        }
      }

      // Entity Alias Suffix Rules
      if (pack.entityAliasSuffixRules) {
        this.allEntityAliasSuffixRules.push(...pack.entityAliasSuffixRules);
      }

      // Runtime Plugins（声明式插件挂载，由 EngineHost 在 init 末尾统一挂载）
      if (pack.runtimePlugins) {
        this.allRuntimePlugins.push(...pack.runtimePlugins);
      }

      // 本地 LLM 启发式
      if (pack.localPolicyQuestionPatterns) {
        this.allLocalPolicyQuestionPatterns.push(...pack.localPolicyQuestionPatterns);
      }
      if (pack.localPlannerHeuristics) {
        this.allLocalPlannerHeuristics.push(...pack.localPlannerHeuristics);
      }
      if (pack.knowledgeRetrievalKeywords) {
        for (const keyword of pack.knowledgeRetrievalKeywords) {
          if (!this.allKnowledgeRetrievalKeywords.includes(keyword)) {
            this.allKnowledgeRetrievalKeywords.push(keyword);
          }
        }
      }
      if (pack.agenticQuestionPatterns) {
        this.allAgenticQuestionPatterns.push(...pack.agenticQuestionPatterns);
      }
      if (pack.dangerousQuestionKeywords) {
        for (const word of pack.dangerousQuestionKeywords) {
          if (!this.allDangerousQuestionKeywords.includes(word)) {
            this.allDangerousQuestionKeywords.push(word);
          }
        }
      }
      if (pack.knowledgeChunkHeadingHints) {
        this.allKnowledgeChunkHeadingHints.push(...pack.knowledgeChunkHeadingHints);
      }
      if (pack.importantSentenceKeywords) {
        for (const word of pack.importantSentenceKeywords) {
          if (!this.allImportantSentenceKeywords.includes(word)) {
            this.allImportantSentenceKeywords.push(word);
          }
        }
      }

      // Fact Extractors（按 resource 路由）
      if (pack.factExtractors) {
        this.allFactExtractors.push(...pack.factExtractors);
      }

      // Scope Sentinels（去重）
      if (pack.scopeSentinels) {
        for (const sentinel of pack.scopeSentinels) {
          if (!this.allScopeSentinels.includes(sentinel)) {
            this.allScopeSentinels.push(sentinel);
          }
        }
      }

      // User Field Sources（按 name 路由）
      if (pack.userFieldSources) {
        this.allUserFieldSources.push(...pack.userFieldSources);
      }

      // Cancellation Phrases（去重）
      if (pack.cancellationPhrases) {
        for (const phrase of pack.cancellationPhrases) {
          if (phrase && !this.allCancellationPhrases.includes(phrase)) {
            this.allCancellationPhrases.push(phrase);
          }
        }
      }

      // Param Extraction Examples（按注册顺序合并）
      if (pack.paramExtractionExamples) {
        this.allParamExtractionExamples.push(...pack.paramExtractionExamples);
      }
    }

    // 规则排序：priority ASC → domainOrder ASC → declarationIndex ASC
    ruleEntries.sort((a, b) => {
      const pa = a.rule.priority ?? 100;
      const pb = b.rule.priority ?? 100;
      if (pa !== pb) return pa - pb;
      if (a.domainOrder !== b.domainOrder) return a.domainOrder - b.domainOrder;
      return a.declarationIndex - b.declarationIndex;
    });
    this.allDeterministicRules.push(...ruleEntries.map((e) => e.rule));

    // Surface builder 排序：priority ASC → domainOrder ASC → declarationIndex ASC
    surfaceEntries.sort((a, b) => {
      const pa = a.builder.priority ?? 100;
      const pb = b.builder.priority ?? 100;
      if (pa !== pb) return pa - pb;
      if (a.domainOrder !== b.domainOrder) return a.domainOrder - b.domainOrder;
      return a.declarationIndex - b.declarationIndex;
    });
    this.allSurfaceBuilders.push(...surfaceEntries.map((e) => e.builder));
  }

  // ── 内部：执行 register() 逃生口 ──────────────────────────────────────

  private async executeRegisterHooks(ctx: DomainRegistrationContext): Promise<void> {
    for (const { pack } of this.sorted) {
      if (pack.register) {
        try {
          await pack.register(ctx);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(`[DomainRegistry] domain '${pack.id}' register() 失败: ${msg}`);
        }
      }
    }
  }
}

// ─── 辅助：创建 DomainRegistrationContext ────────────────────────────────────

/**
 * 从现有 runtime 组件创建 DomainRegistrationContext。
 *
 * 这是一个便利工厂函数，将 runtime 的各个注册表包装成 DomainPack register()
 * 逃生口所需的接口。
 */
export function createRegistrationContext(deps: {
  toolRegistry: import("../tools/registry.js").ToolRegistry;
  intentRegistry: { register?: (m: IntentManifest) => void; registerMany?: (ms: IntentManifest[]) => void } & import("../types/agent-contracts.js").IntentRegistry;
  commandRegistry: import("../router/command-registry.js").CommandRegistry;
  scenarioRouter?: ScenarioRegistrar;
}): DomainRegistrationContext {
  // MutableIntentRegistry adapter
  const reg = deps.intentRegistry as unknown as { register?: (m: IntentManifest) => void };
  const mutableIntentRegistry: MutableIntentRegistry = {
    register(manifest: IntentManifest): void {
      if (typeof reg.register === "function") {
        reg.register(manifest);
      }
    },
    registerMany(manifests: IntentManifest[]): void {
      for (const m of manifests) mutableIntentRegistry.register(m);
    },
  };

  // DeterministicRuleCollector (no-op placeholder — rules are collected declaratively)
  const deterministicRules: DeterministicRuleCollector = {
    add(_rule: DeterministicRuleDefinition): void {
      // Milestone 3 will wire this to the actual DeterministicRuleRegistry
    },
    addMany(rules: DeterministicRuleDefinition[]): void {
      for (const r of rules) deterministicRules.add(r);
    },
  };

  // CatalogDomainCollector (no-op placeholder)
  const catalogRegistry: CatalogDomainCollector = {
    add(_domain: CatalogDomainDefinition): void {
      // Milestone 5 will wire this to ToolCatalog
    },
  };

  // SurfaceBuilderCollector (no-op placeholder)
  const surfaceRegistry: SurfaceBuilderCollector = {
    add(_builder: DomainSurfaceBuilder): void {
      // Milestone 5 will wire this to A2UI
    },
  };

  // ScenarioRegistrar (no-op fallback if not provided)
  const scenarioRouter: ScenarioRegistrar = deps.scenarioRouter ?? {
    register(_intentCode: string, _scenario: { run(input: unknown): Promise<unknown> }): void {
      // no-op placeholder
    },
  };

  return {
    toolRegistry: deps.toolRegistry,
    intentRegistry: mutableIntentRegistry,
    commandRegistry: deps.commandRegistry,
    deterministicRules,
    catalogRegistry,
    surfaceRegistry,
    scenarioRouter,
  };
}

// ── 辅助：从目录加载 IntentManifest ──────────────────────────────────────────

/**
 * 扫描指定目录下的 *.json 文件，解析为 IntentManifest 数组。
 * 加载失败的文件只打 warn 日志，不阻塞其他文件。
 */
function loadIntentManifestsFromDir(dir: string, domainId: string): IntentManifest[] {
  const absDir = resolve(process.cwd(), dir);
  let entries: string[];
  try {
    entries = readdirSync(absDir);
  } catch {
    // 目录不存在或不可读 — 静默跳过（域可能尚未迁移 manifest）
    return [];
  }
  const manifests: IntentManifest[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const fullPath = join(absDir, entry);
    try {
      const stat = statSync(fullPath);
      if (!stat.isFile()) continue;
      const raw = readFileSync(fullPath, "utf8");
      const manifest = JSON.parse(raw) as IntentManifest;
      if (!manifest.intent_code) {
        console.warn(`[DomainRegistry] domain '${domainId}' intentDir: ${entry} 缺少 intent_code，跳过。`);
        continue;
      }
      manifests.push(manifest);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[DomainRegistry] domain '${domainId}' intentDir: 加载 ${entry} 失败: ${msg}`);
    }
  }
  return manifests;
}

function mergeRecordWithConflict<T>(
  target: Record<string, T>,
  source: Record<string, T>,
  input: { domainId: string; kind: string; policy?: DomainPack["conflictPolicy"] },
): void {
  for (const [key, value] of Object.entries(source)) {
    if (Object.prototype.hasOwnProperty.call(target, key)) {
      handleConflict({ ...input, key });
    }
    target[key] = value;
  }
}

function assertUniqueByName(
  items: Array<{ name: string }>,
  input: { domainId: string; kind: string; policy?: DomainPack["conflictPolicy"] },
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.name)) handleConflict({ ...input, key: item.name });
    seen.add(item.name);
  }
}

function assertUniqueIntentManifests(
  items: IntentManifest[],
  input: { domainId: string; policy?: DomainPack["conflictPolicy"] },
): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.intent_code)) handleConflict({ domainId: input.domainId, kind: "intent", key: item.intent_code, policy: input.policy });
    seen.add(item.intent_code);
  }
}

function handleConflict(input: { domainId: string; kind: string; key: string; policy?: DomainPack["conflictPolicy"] }): void {
  const policy = input.policy ?? "warn";
  if (policy === "override") return;
  const message = `[DomainRegistry] domain '${input.domainId}' 注册 ${input.kind} '${input.key}' 时发现冲突。`;
  if (policy === "error") throw new Error(message);
  console.warn(message);
}
