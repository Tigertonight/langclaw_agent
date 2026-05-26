/**
 * Runtime Registry 访问器。
 *
 * 提供一个全局可访问的 DomainRegistry 引用，供 runtime 模块中的
 * 独立函数（如 readableResourceName、extractDealerFacts 等）使用。
 *
 * 设计约束：
 * 1. 只在 app.init() 之后设置，确保 DomainRegistry 已初始化。
 * 2. 只提供只读查询接口，不暴露注册能力。
 * 3. 所有查询方法在 registry 未设置时优雅降级（返回 fallback）。
 */

import type { ResourceConfig } from "../resources/types.js";
import type { QueryResourceSchema, DomainQueryAdapter, PermissionRuleFn, ToolPermissionPolicy, CronTemplateDefinition, CatalogDomainDefinition, AgenticFallbackDefinition, ReportComposerDefinition, ToolResultSummarizerDefinition, ToolObservationSanitizerDefinition, EvidenceInferenceDefinition, FactExtractorDefinition, ExtractedFact, SkillMappingDefinition, IntentCodeInferenceFn, CorrectionDeltaRule, LocalPolicyQuestionPattern, LocalPlannerHeuristic, FollowUpPlannerHeuristic, KnownEntityProbe, KnowledgeChunkHeadingHint, UserFieldSourceDefinition } from "./types.js";
import type { JsonObject, JsonValue, UserContext, Route, ToolCall, ToolResult } from "../types/agent-contracts.js";

/**
 * RuntimeRegistryAccessor：供 runtime 独立函数使用的只读查询接口。
 */
export interface RuntimeRegistryAccessor {
  /** 所有已注册资源配置 */
  readonly allResources: Record<string, ResourceConfig>;
  /** resource → fact key 映射 */
  readonly allFactKeyMappings: Record<string, string>;
  /** 工具标签映射 */
  readonly allToolLabels: Record<string, string>;
  /** 工具分类映射（tool name → category） */
  readonly allToolCategories: Record<string, string>;
  /** 字段标签映射 */
  readonly allFieldLabels: Record<string, string>;
  /** resource → intent_code 映射 */
  readonly allIntentCodeMappings: Record<string, string>;
  /** LLM 答案生成提示词片段 */
  readonly allAnswerPromptHints: string[];
  /** 路由提示词片段 */
  readonly allRouterPromptHints: string[];
  /** 查询 schema 映射 */
  readonly allQuerySchemas: Record<string, QueryResourceSchema>;
  /** 资源检测关键词映射 */
  readonly allResourceDetectionKeywords: Record<string, string[]>;
  /** 查询适配器列表 */
  readonly allQueryAdapters: DomainQueryAdapter[];
  /** 权限规则列表 */
  readonly allPermissionRules: PermissionRuleFn[];
  /** 工具级权限策略列表 */
  readonly allToolPermissionPolicies: ToolPermissionPolicy[];
  /** Cron 模板列表 */
  readonly allCronTemplates: CronTemplateDefinition[];
  /** Catalog domain 定义列表 */
  readonly allCatalogDomains: CatalogDomainDefinition[];
  /** Agentic fallback 定义列表 */
  readonly allAgenticFallbacks: AgenticFallbackDefinition[];
  /** Report Composer 定义列表 */
  readonly allReportComposers: ReportComposerDefinition[];
  /** Tool Result Summarizer 映射（toolName → 定义） */
  readonly allToolResultSummarizers: Map<string, ToolResultSummarizerDefinition>;
  /** Tool Observation Sanitizer 映射（toolName → 定义） */
  readonly allToolObservationSanitizers: Map<string, ToolObservationSanitizerDefinition>;
  /** Evidence Inference 定义列表 */
  readonly allEvidenceInferenceFns: EvidenceInferenceDefinition[];
  /** Skill Mapping 定义列表 */
  readonly allSkillMappings: SkillMappingDefinition[];
  /** Slot update 检测器映射 */
  readonly allSlotUpdateDetectors: Record<string, (message: string) => boolean>;
  /** Skill contract enforcer 列表 */
  readonly allSkillContractEnforcers: import("./types.js").SkillContractEnforcer[];
  /** Intent code 推断函数列表 */
  readonly allIntentCodeInferenceFns: IntentCodeInferenceFn[];
  /** 域特定的分类器意图声明 */
  readonly allClassifierIntents: Record<string, string>;
  /** 域特定的 data_query 描述关键词 */
  readonly allDataQueryKeywords: string[];
  /** 域特定的本地分类关键词 */
  readonly allClassificationKeywords: Record<string, string[]>;
  /** 域特定的本地分类正则模式 */
  readonly allClassificationPatterns: Record<string, RegExp[]>;
  /** 域特定的能力描述 */
  readonly allCapabilityDescriptions: string[];
  /** 域特定的独立任务关键词 */
  readonly allStandaloneTaskKeywords: string[];
  /** 域特定的短修正 delta 规则 */
  readonly allCorrectionDeltaRules: CorrectionDeltaRule[];
  /** 域特定的 A2UI Surface 插件 */
  readonly allSurfacePlugins: import("../a2ui/plugins/types.js").SurfacePlugin<unknown>[];
  /** 域特定的短修正识别模式 */
  readonly allShortCorrectionPatterns: RegExp[];
  /** 域特定的 metric 关键词映射 */
  readonly allMetricKeywordMappings: Array<[RegExp, string]>;
  /** 域特定的 intent ↔ intentCode 双向映射 */
  readonly allIntentMappings: Record<string, string>;
  /** 域特定的前端组件渲染器代码片段 */
  readonly allChatPageRenderers: Array<{ name: string; code: string }>;
  /** 域特定的实体别名映射（正式名称 → 别名数组） */
  readonly allEntityAliases: Record<string, string[]>;
  /** 域特定的实体别名后缀规则 */
  readonly allEntityAliasSuffixRules: Array<{ suffix: string; replacement: string }>;
  /** 本地 LLM 策略问题模式 */
  readonly allLocalPolicyQuestionPatterns: LocalPolicyQuestionPattern[];
  /** 本地 LLM 兜底规划启发式 */
  readonly allLocalPlannerHeuristics: LocalPlannerHeuristic[];
  /** 知识库检索关键词 */
  readonly allKnowledgeRetrievalKeywords: string[];
  /** 域特定的 agentic 问题识别正则 */
  readonly allAgenticQuestionPatterns: RegExp[];
  /** 域特定的危险问题关键词 */
  readonly allDangerousQuestionKeywords: string[];
  /** 域特定的知识库 chunk heading 启发式 */
  readonly allKnowledgeChunkHeadingHints: KnowledgeChunkHeadingHint[];
  /** 域特定的重要句关键词 */
  readonly allImportantSentenceKeywords: string[];
  /** 域特定的 fact 提取器（按 resource 路由） */
  readonly allFactExtractors: FactExtractorDefinition[];
  /** 域特定的作用域 sentinel 字符串列表 */
  readonly allScopeSentinels: string[];
  /** 域特定的 user field source 定义 */
  readonly allUserFieldSources: UserFieldSourceDefinition[];
  /** 域贡献的取消/放弃流程短语（已去重） */
  readonly allCancellationPhrases: string[];
  /** 域贡献的 router 抽参示例片段 */
  readonly allParamExtractionExamples: string[];
  /** 域贡献的 follow-up planner 启发式（按 priority 排序） */
  readonly allFollowUpPlannerHeuristics: FollowUpPlannerHeuristic[];
  /** 域贡献的已知命名实体探针 */
  readonly allKnownEntityProbes: KnownEntityProbe[];
  /** 域贡献的"明确数据查找"信号词（已去重） */
  readonly allDataLookupHints: string[];
}

let _accessor: RuntimeRegistryAccessor | null = null;

/**
 * 设置全局 RuntimeRegistryAccessor。
 * 应在 app.init() 完成后调用一次。
 */
export function setRuntimeRegistryAccessor(accessor: RuntimeRegistryAccessor): void {
  _accessor = accessor;
}

/**
 * 获取全局 RuntimeRegistryAccessor。
 * 如果未设置，返回 null。
 */
export function getRuntimeRegistry(): RuntimeRegistryAccessor | null {
  return _accessor;
}

/**
 * 通过 registry 查找资源的中文标签。
 * 优先使用 ResourceConfig.label，否则返回 fallback。
 */
export function readableResourceNameFromRegistry(resource: unknown, fallback = "业务数据"): string {
  const key = String(resource ?? "");
  return _accessor?.allResources[key]?.label ?? fallback;
}

/**
 * 通过 registry 查找工具的中文标签。
 */
export function readableToolNameFromRegistry(toolName: string, fallback?: string): string {
  return _accessor?.allToolLabels[toolName] ?? fallback ?? toolName;
}

/**
 * 通过 registry 查找工具的分类（business_query / knowledge_search / compute / ...）。
 * 未注册时返回 null，调用方应对 null 走通用分支。
 */
export function getToolCategoryFromRegistry(toolName: string): string | null {
  return _accessor?.allToolCategories[toolName] ?? null;
}

/**
 * 通过 registry 查找资源的 fact key。
 */
export function getFactKeyFromRegistry(resource: string): string | undefined {
  return _accessor?.allFactKeyMappings[resource] ?? _accessor?.allResources[resource]?.factKey;
}

/**
 * 通过 registry 查找资源的 intent_code。
 */
export function getIntentCodeFromRegistry(resource: string): string | undefined {
  return _accessor?.allIntentCodeMappings[resource];
}

/**
 * 获取所有已注册资源的 id 列表。
 */
export function getRegisteredResourceIds(): string[] {
  return Object.keys(_accessor?.allResources ?? {});
}

/**
 * 获取资源的数据文件路径。
 * 通过 registry 动态查找，替代硬编码的 "data/xxx.json" 路径。
 */
export function getResourceDataPath(resourceId: string): string | null {
  const config = _accessor?.allResources[resourceId];
  return config?.file ?? null;
}

/**
 * 获取所有已注册域的域名列表（从 queryAdapters 和 intentCodeMappings 动态推断）。
 */
export function getRegisteredDomainNames(): string[] {
  const domains = new Set<string>();
  // 从 queryAdapters 收集
  for (const adapter of getQueryAdapters()) {
    if (adapter.domain) domains.add(adapter.domain);
  }
  // 从 intentCodeMappings 的值中提取域前缀
  for (const mapped of Object.values(_accessor?.allIntentCodeMappings ?? {})) {
    const prefix = String(mapped).split(".")[0];
    if (prefix) domains.add(prefix);
  }
  // 从 resources 的 domain 字段收集
  for (const config of Object.values(_accessor?.allResources ?? {})) {
    if (config.domain) domains.add(config.domain);
  }
  return [...domains];
}

/**
 * 通过 registry 查找 fact 的中文标签。
 * 优先使用 allFieldLabels，否则返回 name 本身。
 */
export function readableFactNameFromRegistry(name: string): string {
  return _accessor?.allFieldLabels[name] ?? name;
}

/**
 * 从 registry 获取字段标签。
 * 如果 registry 已初始化，返回 allFieldLabels 中的标签；否则返回 undefined。
 */
export function getFieldLabelFromRegistry(fieldName: string): string | undefined {
  return _accessor?.allFieldLabels[fieldName];
}

/**
 * 检查 intent_code 是否属于 "analysis" 类型。
 * 通过 registry 中的 intentCodeMappings 查找，而非硬编码 "dealer.analysis_query"。
 */
export function isAnalysisIntentCode(intentCode: string | undefined | null): boolean {
  if (!intentCode) return false;
  // 如果 intent_code 以 .analysis 结尾，视为分析类意图
  return intentCode.endsWith("_analysis") || intentCode.endsWith(".analysis_query") || intentCode.endsWith("_analysis_query");
}

/**
 * 获取所有 domain 注册的 LLM 答案生成提示词片段。
 */
export function getAnswerPromptHints(): string[] {
  return _accessor?.allAnswerPromptHints ?? [];
}

/**
 * 获取所有 domain 注册的路由提示词片段。
 */
export function getRouterPromptHints(): string[] {
  return _accessor?.allRouterPromptHints ?? [];
}

/**
 * 获取所有 domain 注册的查询 schema 映射。
 */
export function getQuerySchemas(): Record<string, QueryResourceSchema> {
  return _accessor?.allQuerySchemas ?? {};
}

/**
 * 获取资源检测关键词（resource → keywords[]）。
 */
export function getResourceDetectionKeywords(): Record<string, string[]> {
  return _accessor?.allResourceDetectionKeywords ?? {};
}

/**
 * 获取所有 domain 注册的查询适配器。
 */
export function getQueryAdapters(): DomainQueryAdapter[] {
  return _accessor?.allQueryAdapters ?? [];
}

/**
 * 获取所有 domain 注册的 cron 模板。
 */
export function getCronTemplates(): CronTemplateDefinition[] {
  return _accessor?.allCronTemplates ?? [];
}

/**
 * 获取所有 domain 注册的 catalog domain 定义。
 */
export function getCatalogDomains(): CatalogDomainDefinition[] {
  return _accessor?.allCatalogDomains ?? [];
}

/**
 * 获取所有 domain 注册的 agentic fallback 定义。
 */
export function getAgenticFallbacks(): AgenticFallbackDefinition[] {
  return _accessor?.allAgenticFallbacks ?? [];
}

/**
 * 获取所有 domain 注册的 report composer 定义。
 */
export function getReportComposers(): ReportComposerDefinition[] {
  return _accessor?.allReportComposers ?? [];
}

/**
 * 通过 registry 动态组装域特定报告。
 * 遍历所有注册的 report composer，找到第一个匹配的执行。
 */
export function composeReportFromRegistry(input: { question: string; route?: { intent_code?: string } | null; toolResults: ToolResult[] }): { answer: string; artifacts: import("../types/agent-contracts.js").JsonObject[] } | null {
  for (const composer of getReportComposers()) {
    if (composer.matches(input)) {
      const result = composer.compose(input);
      if (result) return result;
    }
  }
  return null;
}

/**
 * 按工具名分发到域贡献的 ToolResultSummarizer。
 * 命中且返回非空字符串则使用，否则返回 null（runtime 自行 fallback）。
 */
export function summarizeToolResultFromRegistry(result: ToolResult): string | null {
  const toolName = String(result?.tool ?? "");
  if (!toolName) return null;
  const def = _accessor?.allToolResultSummarizers.get(toolName);
  if (!def) return null;
  const summary = def.summarize(result);
  return summary && summary.length > 0 ? summary : null;
}

/**
 * 按工具名分发到域贡献的 ToolObservationSanitizer。
 * 返回 null 时由 runtime 走通用 fallback。
 */
export function sanitizeToolObservationFromRegistry(result: ToolResult): import("../types/agent-contracts.js").JsonObject | null {
  const toolName = String(result?.tool ?? "");
  if (!toolName) return null;
  const def = _accessor?.allToolObservationSanitizers.get(toolName);
  if (!def) return null;
  return def.sanitize(result);
}

/**
 * 通过 registry 动态推断所需的证据 fact。
 * 遍历所有注册的 evidence inference 函数，合并结果。
 */
export function inferEvidenceFactsFromRegistry(message: string, route?: Partial<Route> | null): string[] {
  const facts: string[] = [];
  for (const def of (_accessor?.allEvidenceInferenceFns ?? [])) {
    facts.push(...def.inferFacts(message, route));
  }
  return [...new Set(facts)];
}

/**
 * 通过 registry 动态推断 skill id。
 */
export function inferSkillFromRegistry(intentCode: string | undefined | null): { id: string } | null {
  if (!intentCode) return null;
  for (const mapping of (_accessor?.allSkillMappings ?? [])) {
    if (mapping.matches(intentCode)) return { id: mapping.skillId };
  }
  return null;
}

/**
 * 判断 intent_code 是否属于某个已注册域的数据查询意图。
 * 通用替代 startsWith("dealer.") / startsWith("attendance.") 等硬编码检查。
 *
 * 逻辑：intent_code 格式为 "<domain>.<action>"，提取 domain 前缀后
 * 检查是否存在对应的 intentCodeMappings 或 querySchemas。
 */
export function isDomainDataQueryIntent(intentCode: string | undefined | null): boolean {
  if (!intentCode) return false;
  const code = String(intentCode);
  // 核心 intent codes 不算域数据查询
  if (code.startsWith("knowledge.") || code.startsWith("chat.") || code.startsWith("system.")) return false;
  // 有 "." 分隔的 intent code 且前缀匹配已注册域的 intentCodeMappings 或 querySchemas
  if (code.includes(".")) {
    const prefix = code.split(".")[0];
    // 检查 intentCodeMappings 中是否有该前缀的值
    const mappings = _accessor?.allIntentCodeMappings ?? {};
    for (const mapped of Object.values(mappings)) {
      if (String(mapped).startsWith(`${prefix}.`)) return true;
    }
    // 检查 querySchemas 中是否有该前缀的 schema
    const schemas = _accessor?.allQuerySchemas ?? {};
    for (const schema of Object.values(schemas)) {
      if (schema.entity && String(schema.entity).startsWith(prefix)) return true;
    }
    // 从已注册的 queryAdapters 动态构建域前缀集合
    const adapterDomains = getQueryAdapters().map((a) => a.domain);
    if (adapterDomains.includes(prefix)) return true;
    // 从已注册的 intentCodeInferenceFns 推断：如果任何推断函数能识别该前缀的 intent，也算
    const allMappedPrefixes = new Set<string>();
    for (const mapped of Object.values(mappings)) {
      const p = String(mapped).split(".")[0];
      if (p) allMappedPrefixes.add(p);
    }
    return allMappedPrefixes.has(prefix);
  }
  return false;
}

/**
 * 从 intent_code 推断域名。
 * 通用替代硬编码的 inferDomainFromIntentCode。
 */
export function inferDomainFromIntentCodeViaRegistry(intentCode: string | undefined | null): string | null {
  if (!intentCode) return null;
  const code = String(intentCode);
  if (!code.includes(".")) return null;
  return code.split(".")[0];
}

/**
 * 通过 registry 的 queryAdapters 推断会话任务。
 * 用于 conversation-context 的 inferTaskFromText，替代硬编码的域特定 NLP 启发式。
 */
export function inferTaskFromRegistry(text: string): { intent_code: string; selected_skill: string; target: string; operation: string } | null {
  for (const adapter of getQueryAdapters()) {
    const task = adapter.inferTask?.(text);
    if (task) return task;
  }
  return null;
}

/**
 * 通过 registry 检测 slot update。
 * 用于 workflow-runner 的 looksLikeSlotUpdate，替代硬编码的域特定检测逻辑。
 */
export function detectSlotUpdateFromRegistry(activeIntent: string, message: string): boolean {
  const detector = _accessor?.allSlotUpdateDetectors[activeIntent];
  return detector ? detector(message) : false;
}

/**
 * 通过 registry 执行 skill contract enforcement。
 * 遍历所有注册的 enforcer，找到第一个匹配的执行。
 */
export async function enforceSkillContractsFromRegistry<T extends { calls: Array<{ name: string; args?: Record<string, unknown> }> }>(
  plan: T,
  context: { message: string; selectedSkill?: { id: string; name: string } | null; enterpriseContext?: unknown }
): Promise<T> {
  for (const enforcer of (_accessor?.allSkillContractEnforcers ?? [])) {
    if (enforcer.matchesSkill(context.selectedSkill)) {
      return enforcer.enforce(plan, context) as Promise<T>;
    }
  }
  return plan;
}

/**
 * 通过 registry 推断 intent code。
 * 遍历所有注册的 intentCodeInferenceFn，返回第一个非 null 结果。
 * 如果没有匹配，返回 null。
 */
export function inferIntentCodeFromRegistry(message: string): string | null {
  for (const fn of (_accessor?.allIntentCodeInferenceFns ?? [])) {
    const result = fn(message);
    if (result) return result;
  }
  return null;
}

/**
 * 通过 registry 的 queryAdapters 判断消息是否属于某个域的分析类问题。
 * 通用替代硬编码的 isDomainAnalysisQuestion。
 * 返回匹配的 intent_code（如 "dealer.analysis_query"），或 null。
 */
export function inferAnalysisIntentFromRegistry(message: string): string | null {
  const text = String(message ?? "");
  for (const adapter of getQueryAdapters()) {
    if (adapter.isAnalysisQuestion?.(text)) {
      // 从 intentCodeInferenceFns 推断具体的 intent_code
      const code = inferIntentCodeFromRegistry(text);
      if (code) return code;
    }
  }
  return null;
}

/**
 * 通过 registry 的 queryAdapters 判断消息是否属于某个域的数据查询问题。
 * 通用替代硬编码的 isLeaveRecordQuestion / isDomainRelevantQuestion。
 */
export function isAnyDomainDataQuestion(message: string): boolean {
  const text = String(message ?? "");
  return getQueryAdapters().some((a) => a.isRelevantQuestion?.(text));
}

/**
 * 获取所有域注册的分类器意图声明。
 * 返回 intent name → 描述 的映射。
 */
export function getClassifierIntents(): Record<string, string> {
  return _accessor?.allClassifierIntents ?? {};
}

/**
 * 获取所有域注册的 data_query 描述关键词。
 */
export function getDataQueryKeywords(): string[] {
  return _accessor?.allDataQueryKeywords ?? [];
}

/**
 * 获取所有域注册的本地分类关键词。
 */
export function getClassificationKeywords(): Record<string, string[]> {
  return _accessor?.allClassificationKeywords ?? {};
}

/**
 * 获取所有域注册的本地分类正则模式。
 */
export function getClassificationPatterns(): Record<string, RegExp[]> {
  return _accessor?.allClassificationPatterns ?? {};
}

/**
 * 获取所有域注册的能力描述。
 */
export function getCapabilityDescriptions(): string[] {
  return _accessor?.allCapabilityDescriptions ?? [];
}

/**
 * 获取所有域注册的独立任务关键词。
 */
export function getStandaloneTaskKeywords(): string[] {
  return _accessor?.allStandaloneTaskKeywords ?? [];
}

/**
 * 动态构建 LLM 分类器的可选 intent 列表。
 * 核心 intents（knowledge_qa, data_query, mixed, smalltalk, unsupported）始终包含，
 * 域特定 intents（如 leave_request）从 registry 动态注入。
 */
export function buildClassifierIntentList(): string {
  const coreIntents = ["knowledge_qa", "data_query", "mixed", "smalltalk", "unsupported"];
  const domainIntents = Object.keys(getClassifierIntents());
  const all = [...new Set([...coreIntents, ...domainIntents])];
  return all.join(", ");
}

/**
 * 动态构建 LLM 分类器的 data_query 描述。
 * 基础描述 + 域特定关键词动态拼接。
 */
export function buildDataQueryDescription(): string {
  const base = "data_query 表示查询业务数据";
  const keywords = getDataQueryKeywords();
  if (keywords.length === 0) return `${base}。`;
  return `${base}，例如${keywords.join("、")}等。`;
}

/**
 * 动态构建 LLM 分类器的域特定意图描述行。
 * 返回描述行数组，每行格式为 "<intent> 表示..."。
 */
export function buildClassifierIntentDescriptions(): string[] {
  const intents = getClassifierIntents();
  return Object.entries(intents).map(([name, desc]) => `${name} ${desc}`);
}

/**
 * 获取所有域注册的短修正 delta 规则。
 */
export function getCorrectionDeltaRules(): CorrectionDeltaRule[] {
  return _accessor?.allCorrectionDeltaRules ?? [];
}

/**
 * 获取所有域注册的 A2UI Surface 插件。
 */
export function getSurfacePlugins(): import("../a2ui/plugins/types.js").SurfacePlugin<unknown>[] {
  return _accessor?.allSurfacePlugins ?? [];
}

/**
 * 获取所有域注册的短修正识别模式。
 */
export function getShortCorrectionPatterns(): RegExp[] {
  return _accessor?.allShortCorrectionPatterns ?? [];
}

/**
 * 获取所有域注册的 metric 关键词映射。
 */
export function getMetricKeywordMappings(): Array<[RegExp, string]> {
  return _accessor?.allMetricKeywordMappings ?? [];
}

/**
 * 根据 intent 名称查找对应的 intentCode。
 * 例如 "leave_request" → "workflow.leave_request"。
 * 如果没有匹配的映射，返回 null。
 */
export function getIntentCodeForIntent(intent: string): string | null {
  return _accessor?.allIntentMappings[intent] ?? null;
}

/**
 * 根据 intentCode 查找对应的 intent 名称。
 * 例如 "workflow.leave_request" → "leave_request"。
 * 如果没有匹配的映射，返回 null。
 */
export function getIntentForIntentCode(intentCode: string): string | null {
  const mappings = _accessor?.allIntentMappings ?? {};
  for (const [intent, code] of Object.entries(mappings)) {
    if (code === intentCode) return intent;
  }
  return null;
}

/**
 * 获取所有域注册的前端组件渲染器代码片段。
 */
export function getChatPageRenderers(): Array<{ name: string; code: string }> {
  return _accessor?.allChatPageRenderers ?? [];
}

/**
 * 获取所有域注册的实体别名映射（正式名称 → 别名数组）。
 * 用于 entity-resolver 在匹配部门等实体时，将别名映射到正式名称。
 */
export function getEntityAliases(): Record<string, string[]> {
  return _accessor?.allEntityAliases ?? {};
}

/**
 * 获取所有域注册的实体别名后缀规则。
 * 用于 entity-resolver 自动生成后缀变体别名。
 */
export function getEntityAliasSuffixRules(): Array<{ suffix: string; replacement: string }> {
  return _accessor?.allEntityAliasSuffixRules ?? [];
}

/**
 * 获取所有域注册的本地 LLM 策略问题模式。
 * 用于 local-llm.ts 判断"用户问题是否为本域的制度/政策类提问"。
 */
export function getLocalPolicyQuestionPatterns(): LocalPolicyQuestionPattern[] {
  return _accessor?.allLocalPolicyQuestionPatterns ?? [];
}

/**
 * 获取所有域注册的本地 LLM 兜底规划启发式（按 priority 升序）。
 * 用于 local-llm.ts planToolCalls 在不走 query parser 时返回预设工具计划。
 */
export function getLocalPlannerHeuristics(): LocalPlannerHeuristic[] {
  const all = _accessor?.allLocalPlannerHeuristics ?? [];
  return [...all].sort((a, b) => (a.priority ?? 100) - (b.priority ?? 100));
}

/**
 * 获取所有域注册的知识库检索关键词。
 * 用于 local-llm.ts shouldRetrieveKnowledge 判断 MIXED 意图下是否需要触发知识检索。
 */
export function getKnowledgeRetrievalKeywords(): string[] {
  return _accessor?.allKnowledgeRetrievalKeywords ?? [];
}

/**
 * 获取所有域注册的工具级权限策略。
 * 用于 auth/permissions.ts checkToolPermission 在内置策略后追加域级判断。
 */
export function getToolPermissionPolicies(): ToolPermissionPolicy[] {
  return _accessor?.allToolPermissionPolicies ?? [];
}

/**
 * 获取所有域注册的 agentic 问题识别正则。
 * 用于 openai-llm.ts isClearlyAgenticQuestion 判断问题是否走 agentic 流程。
 */
export function getAgenticQuestionPatterns(): RegExp[] {
  return _accessor?.allAgenticQuestionPatterns ?? [];
}

/**
 * 获取所有域注册的危险关键词。
 * 用于 local-llm.ts 检测用户问题是否触及敏感数据访问意图。
 */
export function getDangerousQuestionKeywords(): string[] {
  return _accessor?.allDangerousQuestionKeywords ?? [];
}

/**
 * 获取所有域注册的知识库 chunk heading 启发式。
 * 用于 local-llm.ts chooseAnswerChunk 选择最相关的 chunk。
 */
export function getKnowledgeChunkHeadingHints(): KnowledgeChunkHeadingHint[] {
  return _accessor?.allKnowledgeChunkHeadingHints ?? [];
}

/**
 * 获取所有域注册的重要句关键词。
 * 用于 local-llm.ts summarizeChunk 选择 chunk 内的关键句。
 */
export function getImportantSentenceKeywords(): string[] {
  return _accessor?.allImportantSentenceKeywords ?? [];
}

/**
 * 调用第一个匹配 resource 的 FactExtractor，返回提取出的 fact 列表。
 * 未命中任一 extractor 时返回 null（让调用方走通用 factKey 路径）。
 *
 * 用于 agent-state / agent-task-state 的工具结果 fact 提取，替代硬编码
 * `if (data.resource === "employees") return extractEmployeeFacts(data);`。
 */
export function extractFactsForResource(data: JsonObject): ExtractedFact[] | null {
  const resource = String(data.resource ?? "");
  if (!resource) return null;
  const extractors = _accessor?.allFactExtractors ?? [];
  for (const extractor of extractors) {
    if (extractor.resource === resource) {
      return extractor.extract({ data, resource });
    }
  }
  return null;
}

/**
 * 判断给定的 filter 列表是否带有"按当前用户作用域过滤"的 sentinel。
 *
 * 用于 agent-state.extractFactsFromToolResult 替代硬编码的
 * `["__CURRENT_USER_REPORTS__", "__CURRENT_USER_SUBORDINATES__"]` 检查。
 */
export function isScopedToCurrentUser(filters: unknown): boolean {
  if (!Array.isArray(filters)) return false;
  const sentinels = _accessor?.allScopeSentinels ?? [];
  if (!sentinels.length) return false;
  return filters.some((filter) => {
    if (!filter || typeof filter !== "object") return false;
    const value = String((filter as Record<string, unknown>).value ?? "");
    return sentinels.includes(value);
  });
}

/**
 * 通过 registry 查找已注册的 user field source。
 * 命中时返回 read() 结果；未命中返回 undefined（让调用方走 fallback）。
 *
 * 用于 intent-query-handler.valueForMapping 替代硬编码的
 * `if (rule.source === "default_store") return user?.default_store ?? null;`。
 */
export function readUserFieldFromRegistry(name: string, user?: UserContext): JsonValue | null | undefined {
  const sources = _accessor?.allUserFieldSources ?? [];
  for (const source of sources) {
    if (source.name === name) {
      return source.read(user);
    }
  }
  return undefined;
}

/**
 * 获取所有 domain 注册的取消/放弃流程短语。
 * 用于 workflow-runner 拼接 scenario 控制消息正则。
 */
export function getCancellationPhrases(): string[] {
  return _accessor?.allCancellationPhrases ?? [];
}

/**
 * 获取所有 domain 注册的 router 抽参示例片段。
 * 用于 router-prompt 注入"严格按用户原文"硬规则的示例文本。
 */
export function getParamExtractionExamples(): string[] {
  return _accessor?.allParamExtractionExamples ?? [];
}

/**
 * 应用所有域注册的 follow-up planner 启发式。
 * 按 priority 排序后依次执行，结果按顺序累加。
 */
export function applyFollowUpPlannersFromRegistry(question: string, previousCalls: ToolCall[]): ToolCall[] {
  const heuristics = _accessor?.allFollowUpPlannerHeuristics ?? [];
  const additions: ToolCall[] = [];
  for (const heuristic of heuristics) {
    const calls = heuristic.plan({ question, previousCalls: [...previousCalls, ...additions] });
    if (calls.length) additions.push(...calls);
  }
  return additions;
}

/**
 * 调用所有域注册的已知命名实体探针。
 * 任意一个探针返回 true 即返回 true（短路求值）。
 */
export async function probeKnownEntityFromRegistry(question: string): Promise<boolean> {
  const probes = _accessor?.allKnownEntityProbes ?? [];
  for (const probe of probes) {
    if (await probe.probe(question)) return true;
  }
  return false;
}

/**
 * 获取所有 domain 注册的"明确数据查找"信号词。
 * 用于 hasExplicitDataLookup 与引擎通用查询动词合并构造正则。
 */
export function getDataLookupHints(): string[] {
  return _accessor?.allDataLookupHints ?? [];
}
