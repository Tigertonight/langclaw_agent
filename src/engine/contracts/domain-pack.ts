/**
 * Engine Contract: DomainPack
 * Stability: stable
 *
 * DomainPack 是业务域的可插拔封装单元。
 * 一个 DomainPack 代表一个完整的业务域（如 dealer、attendance、knowledge），
 * 包含该域的所有资源定义、工具、命令、确定性规则、意图清单、Surface 构建器等。
 *
 * 通过 DomainRegistry.register() 注册后，runtime 会自动将声明式配置分发到
 * 对应的注册表（ToolRegistry、CommandRegistry 等），无需修改 runtime 核心代码。
 *
 * 设计约束：
 * 1. 能声明式注册的能力，不放进 register()。
 * 2. register() 只处理远程初始化、条件注册、复杂依赖注入等逃生口。
 * 3. toy domain 禁止使用 register()，用于验证声明式接口是否足够。
 * 4. dependencies 用于声明强依赖，optionalDependencies 用于声明可选增强。
 * 5. init / dispose 只处理生命周期，不承载业务注册。
 * 6. registerMany() 做拓扑排序验证，缺失强依赖在 register() 前抛出，
 *    缺失可选依赖只打 warn 日志。
 */

import type {
  IntentManifest,
  ToolDefinition,
} from "./base-types.js";
import type { ResourceConfig as RuntimeResourceConfig, FieldLabels } from "../../resources/types.js";
import type { CommandDefinition } from "../../router/command-registry.js";
import type { SurfacePlugin } from "../../a2ui/plugins/types.js";

// ── Contract imports ─────────────────────────────────────────────────────────

import type {
  DeterministicRuleDefinition,
  ExtractorFn,
  IntentCodeInferenceFn,
  CorrectionDeltaRule,
  UserFieldSourceDefinition,
} from "./intent-contract.js";

import type {
  DomainQueryAdapter,
  QueryResourceSchema,
  FilterTransformFn,
  ScopeSentinel,
} from "./query-contract.js";

import type {
  CatalogDomainDefinition,
  AgenticFallbackDefinition,
  ReportComposerDefinition,
} from "./tool-contract.js";

import type {
  DomainSkillConfig,
  SkillContractEnforcer,
  SkillMappingDefinition,
  CronTemplateDefinition,
} from "./workflow-contract.js";

import type {
  DomainSurfaceBuilder,
} from "./surface-contract.js";

import type {
  PermissionRuleFn,
  ToolPermissionPolicy,
} from "./permission-contract.js";

import type {
  EvidenceInferenceDefinition,
  FactExtractorDefinition,
} from "./evidence-contract.js";

import type {
  RuntimePluginDefinition,
} from "./runtime-plugin-contract.js";

import type {
  LocalPolicyQuestionPattern,
  LocalPlannerHeuristic,
  KnowledgeChunkHeadingHint,
  ImportantSentenceKeyword,
} from "./llm-contract.js";

import type {
  DomainInitContext,
  DomainRegistrationContext,
  DomainDisposeContext,
} from "./lifecycle-contract.js";

// ─── Engine API Version ──────────────────────────────────────────────────────

/**
 * 当前 Engine API 版本。
 * DomainPack 通过 engineApiVersion 声明兼容的版本范围。
 * Engine 在加载 DomainPack 时会校验兼容性。
 */
export const ENGINE_API_VERSION = "1.0.0";

// ─── DomainPack ──────────────────────────────────────────────────────────────

export interface DomainPack {
  /** 唯一标识，如 "dealer"、"attendance"、"knowledge" */
  id: string;
  /** 展示名称 */
  name: string;
  /** DomainPack 版本。用于动态加载、兼容性检查和冲突定位。 */
  version?: string;
  /** 描述 */
  description?: string;
  /**
   * 声明此 pack 兼容的 Engine API 版本（semver range）。
   * Engine 在加载时会校验兼容性。未声明时视为兼容当前版本。
   *
   * 示例：
   *   "^1.0.0"  — 兼容 1.x.x
   *   ">=1.0.0 <2.0.0" — 兼容 1.x.x
   */
  engineApiVersion?: string;
  /**
   * 声明式配置冲突策略。
   * warn：保留后注册项并打印告警；error：发现重复 key 即中止初始化；override：显式允许覆盖。
   */
  conflictPolicy?: "warn" | "error" | "override";
  /** 可选的 runtime 兼容性提示。当前仅记录边界，不做 semver 求解。 */
  runtimeCompatibility?: {
    minRuntimeVersion?: string;
    maxRuntimeVersion?: string;
  };

  /**
   * 强依赖的其他 DomainPack id。
   * registerMany() 时会做拓扑排序验证，缺失强依赖在 register() 前抛出。
   */
  dependencies?: string[];
  /**
   * 可选依赖的其他 DomainPack id。
   * 缺失时只打 warn 日志，不阻塞注册。
   */
  optionalDependencies?: string[];

  // ── 声明式配置 ──────────────────────────────────────────────────────────

  /**
   * 资源定义（将注册到 ResourceRegistry），key 为资源 id。
   * 使用 src/resources/types.ts 中的 ResourceConfig（运行时实际类型）。
   */
  resources?: Record<string, RuntimeResourceConfig>;
  /** 工具定义（将注册到 ToolRegistry） */
  tools?: ToolDefinition[];
  /** 前置命令（将注册到 CommandRegistry） */
  commands?: CommandDefinition[];
  /** 确定性路由规则（将注册到 DeterministicRuleRegistry） */
  deterministicRules?: DeterministicRuleDefinition[];
  /** 意图清单（将注册到 IntentRegistry） */
  intentManifests?: IntentManifest[];
  /**
   * 域专属 intent-codes 目录路径（相对 cwd）。
   * DomainRegistry.initialize 时扫描该目录下的 *.json 文件，
   * 自动加载为 IntentManifest 并合并到 allIntentManifests。
   * 与 intentManifests 数组互补：intentDir 适合大量 manifest 文件，
   * intentManifests 适合少量内联声明。
   */
  intentDir?: string;
  /**
   * 参数提取器注册表。
   * key 为 extractor 名称（建议 <domain>.<name> 格式），value 为提取函数。
   * DomainRegistry 会自动合并所有域的 extractors 到全局 extractorRegistry。
   */
  extractors?: Record<string, ExtractorFn>;
  /**
   * 字段标签映射（field name → 中文展示标签）。
   * DomainRegistry 会自动合并所有域的 fieldLabels 到 ResourceRegistry。
   */
  fieldLabels?: FieldLabels;
  /** Skill 配置 */
  skills?: DomainSkillConfig[];
  /** A2UI Surface 构建器 */
  surfaces?: DomainSurfaceBuilder[];
  /**
   * A2UI Surface 插件（SurfacePlugin 协议）。
   * 与 surfaces（DomainSurfaceBuilder）互补：surfacePlugins 遵循 SurfacePlugin 协议，
   * 由 A2UI adapter 引擎直接调度（extract → build → envelope）。
   * DomainRegistry 会自动合并所有域的 surfacePlugins 到全局列表。
   */
  surfacePlugins?: SurfacePlugin<unknown>[];
  /** ToolCatalog domain taxonomy */
  catalogDomains?: CatalogDomainDefinition[];
  /** Domain Query Adapter（业务查询特例处理） */
  queryAdapters?: DomainQueryAdapter[];
  /**
   * Filter Transform 注册表。
   * key 为 transform 名称（对应 intent manifest param_mapping 中的 transform 字段），
   * value 为转换函数。
   * DomainRegistry 会自动合并所有域的 filterTransforms 到全局 filterTransformRegistry。
   */
  filterTransforms?: Record<string, FilterTransformFn>;
  /**
   * 权限规则列表。
   * 按注册顺序依次检查，第一个返回 { ok: true } 的规则即放行。
   * DomainRegistry 会自动合并所有域的 permissionRules 到全局列表。
   */
  permissionRules?: PermissionRuleFn[];

  /**
   * 工具级权限策略列表。
   * 与 permissionRules（资源级、同步、只能放行）互补：toolPermissionPolicies 工作在
   * 工具调用粒度，支持 async（可加载数据做 scope 校验），可以返回明确的 deny。
   *
   * checkToolPermission 在执行内置策略后会遍历所有注册的 toolPermissionPolicies。
   * 任一策略返回 PermissionDecision（无论 allow 或 deny）即作为最终结论。
   *
   * 使用场景：dealer 的 customer scope 校验、sales_report 的部门隔离等。
   */
  toolPermissionPolicies?: ToolPermissionPolicy[];

  /**
   * 工具标签映射（tool name → 中文展示标签）。
   * 用于 readableToolName / tool-error-formatter 等场景。
   * DomainRegistry 会自动合并所有域的 toolLabels 到全局映射。
   */
  toolLabels?: Record<string, string>;

  /**
   * Cron 模板定义。
   * 用于 cron-templates / cron-tools 等场景，替代硬编码模板。
   * DomainRegistry 会自动合并所有域的 cronTemplates 到全局列表。
   */
  cronTemplates?: CronTemplateDefinition[];

  /**
   * 路由提示词片段。
   * 用于 router-prompt.ts buildSystemPrompt 等场景，替代硬编码提示。
   * DomainRegistry 会自动合并所有域的 routerPromptHints 到全局列表。
   */
  routerPromptHints?: string[];

  /**
   * resource → intent_code 映射。
   * 用于 inferIntentCode 等场景，替代硬编码映射。
   * DomainRegistry 会自动合并所有域的 intentCodeMappings 到全局映射。
   */
  intentCodeMappings?: Record<string, string>;

  /**
   * Fact key 映射（resource → fact key）。
   * 用于 extractDealerFacts / inferRequiredFacts 等场景。
   * DomainRegistry 会自动合并所有域的 factKeyMappings 到全局映射。
   */
  factKeyMappings?: Record<string, string>;

  /**
   * Fact 提取器列表（按 resource 路由）。
   *
   * 与 factKeyMappings（一个 resource 对应一个 fact key）互补：FactExtractor 用于
   * 那些需要从一次工具结果中派生多个 fact 的 resource（例如 employees 同时产出
   * direct_leader / direct_reports / org_profile）。
   *
   * runtime 在收到 query_business_data 结果时，先按 resource 查找已注册的
   * FactExtractor；命中即由 extractor 接管，跳过通用 factKey 路径。
   * DomainRegistry 会自动合并所有域的 factExtractors 到全局列表。
   */
  factExtractors?: FactExtractorDefinition[];

  /**
   * 作用域 sentinel 字符串列表。
   *
   * 业务用作 filter value 的占位符，标记"按当前用户的某种作用域过滤"。
   * 例如 dealer/HR 的 "__CURRENT_USER_REPORTS__"、"__CURRENT_USER_SUBORDINATES__"。
   *
   * agent-state 在判断查询是否属于"按当前用户的下属范围"时会检查 filter.value
   * 是否命中任一已注册 sentinel。多个域的 sentinel 会合并去重。
   */
  scopeSentinels?: ScopeSentinel[];

  /**
   * User Field Source 定义列表。
   *
   * intent manifest 的 param_mapping 支持 `source: "<name>"` 从用户上下文取值。
   * 引擎内置 "message" / "user_id"；业务专属字段（dealer 的 default_store 等）
   * 通过此契约由 DomainPack 声明。
   *
   * intent-query-handler 的 valueForMapping 在内置 source 不命中时按 name 查找
   * 已注册的 UserFieldSource，调用其 read() 返回用户字段值。
   */
  userFieldSources?: UserFieldSourceDefinition[];

  /**
   * LLM 答案生成系统提示词片段。
   * 用于 createAnswerSystemPrompt 等场景，替代硬编码提示。
   * DomainRegistry 会自动合并所有域的 answerPromptHints 到全局列表。
   */
  answerPromptHints?: string[];

  /**
   * 查询 schema 定义（resource → QueryResourceSchema）。
   * 用于 query-compiler / schema-catalog 等场景，替代硬编码 RESOURCE_SCHEMAS。
   * DomainRegistry 会自动合并所有域的 querySchemas 到全局映射。
   */
  querySchemas?: Record<string, QueryResourceSchema>;

  /**
   * 资源检测关键词（resource → keywords[]）。
   * 用于 query-parser 判断用户问题涉及哪个资源。
   * DomainRegistry 会自动合并所有域的 resourceDetectionKeywords 到全局映射。
   */
  resourceDetectionKeywords?: Record<string, string[]>;

  /**
   * Agentic fallback 定义列表。
   * 当 LLM API 不可用时，agentic-handler 会遍历所有注册的 fallback。
   * DomainRegistry 会自动合并所有域的 agenticFallbacks 到全局列表。
   */
  agenticFallbacks?: AgenticFallbackDefinition[];

  /**
   * Report Composer 定义列表。
   * 用于 LLM 答案生成阶段组装域特定的结构化报告。
   * DomainRegistry 会自动合并所有域的 reportComposers 到全局列表。
   */
  reportComposers?: ReportComposerDefinition[];

  /**
   * Evidence Inference 定义列表。
   * 用于从用户消息和路由信息推断所需的证据 fact。
   * DomainRegistry 会自动合并所有域的 evidenceInferenceFns 到全局列表。
   */
  evidenceInferenceFns?: EvidenceInferenceDefinition[];

  /**
   * Skill Mapping 定义列表。
   * 用于从 intent_code 推断对应的 skill id。
   * DomainRegistry 会自动合并所有域的 skillMappings 到全局列表。
   */
  skillMappings?: SkillMappingDefinition[];

  /**
   * Slot update 检测器。
   * key 为 intent 名称（如 "leave_request"），value 为检测函数。
   * 用于 workflow-runner 判断用户消息是否为 slot 补充。
   * DomainRegistry 会自动合并所有域的 slotUpdateDetectors 到全局映射。
   */
  slotUpdateDetectors?: Record<string, (message: string) => boolean>;

  /**
   * Skill contract enforcer 列表。
   * 在 LLM 规划工具调用后，对特定 skill 的调用进行后处理（如强制添加范围过滤器）。
   * DomainRegistry 会自动合并所有域的 skillContractEnforcers 到全局列表。
   */
  skillContractEnforcers?: SkillContractEnforcer[];

  /**
   * Intent code 推断函数列表。
   * 用于从用户消息文本推断 intent_code，替代 intent-codes.ts 中的硬编码正则。
   * DomainRegistry 会自动合并所有域的 intentCodeInferenceFns 到全局列表。
   */
  intentCodeInferenceFns?: IntentCodeInferenceFn[];

  /**
   * 域特定的分类器意图声明（intent name → 中文描述）。
   * 用于 LLM 分类器 prompt 中动态构建可选 intent 列表和描述。
   * 例如 attendance 域声明 { "leave_request": "表示用户想办理/提交/发起请假申请" }。
   * DomainRegistry 会自动合并所有域的 classifierIntents 到全局映射。
   */
  classifierIntents?: Record<string, string>;

  /**
   * 域特定的 data_query 描述关键词。
   * 用于 LLM 分类器 prompt 中动态构建 data_query 意图的描述。
   * 例如 dealer 域声明 ["客户", "订单", "销售额", "经销商库存", "线索"]。
   * DomainRegistry 会自动合并所有域的 dataQueryKeywords 到全局列表。
   */
  dataQueryKeywords?: string[];

  /**
   * 域特定的本地分类关键词（用于 local-llm 快速意图识别）。
   * key 为意图名称（如 "data_query"、"leave_request"），value 为关键词数组。
   * DomainRegistry 会自动合并所有域的 classificationKeywords 到全局映射。
   */
  classificationKeywords?: Record<string, string[]>;

  /**
   * 域特定的本地分类正则模式（用于 local-llm 快速意图识别）。
   * key 为意图名称（如 "leave_request"），value 为正则表达式数组。
   * 与 classificationKeywords 互补：关键词用于 includes 匹配，正则用于模式匹配。
   * DomainRegistry 会自动合并所有域的 classificationPatterns 到全局映射。
   */
  classificationPatterns?: Record<string, RegExp[]>;

  /**
   * 域特定的 intent ↔ intentCode 双向映射。
   * key 为 intent 名称（如 "leave_request"），value 为 intentCode（如 "workflow.leave_request"）。
   * 用于 inferIntentCode（intent → intentCode）和 intentFromIntentCode（intentCode → intent）。
   * DomainRegistry 会自动合并所有域的 intentMappings 到全局映射。
   */
  intentMappings?: Record<string, string>;

  /**
   * 域特定的能力描述（中文）。
   * 用于 chitchat-handler 等场景动态构建系统能力描述。
   * DomainRegistry 会自动合并所有域的 capabilityDescriptions 到全局列表。
   */
  capabilityDescriptions?: string[];

  /**
   * 域特定的独立任务关键词。
   * 用于 conversation-context 的 hasStandaloneTask 正则动态构建。
   * DomainRegistry 会自动合并所有域的 standaloneTaskKeywords 到全局列表。
   */
  standaloneTaskKeywords?: string[];

  /**
   * 域特定的短修正 delta 规则。
   * 用于 intent-router 的 buildShortCorrectionDelta，替代硬编码的字段别名和状态消歧逻辑。
   * DomainRegistry 会自动合并所有域的 correctionDeltaRules 到全局列表。
   */
  correctionDeltaRules?: CorrectionDeltaRule[];

  /**
   * 域特定的短修正识别模式。
   * 用于 intent-router 的 looksLikeShortCorrection，替代硬编码的门店名/车型名等业务词。
   * 每个 RegExp 会对用户输入做 test()，任一命中即视为短修正。
   * DomainRegistry 会自动合并所有域的 shortCorrectionPatterns 到全局列表。
   */
  shortCorrectionPatterns?: RegExp[];

  /**
   * 域特定的 metric 关键词映射。
   * 用于 intent-router 的 extractMetricForSchema，替代硬编码的 metric 正则映射。
   * 每项为 [pattern, metricName]，pattern 匹配用户输入时返回 metricName。
   * DomainRegistry 会自动合并所有域的 metricKeywordMappings 到全局列表。
   */
  metricKeywordMappings?: Array<[RegExp, string]>;

  /**
   * 域特定的前端组件渲染器代码片段。
   * 用于 chat-page.ts 动态注入域特定的 OpenUI 组件渲染器。
   * 每项包含 name（组件名）和 code（前端 JS 函数代码字符串）。
   * code 中可使用 chat-page.ts 提供的工具函数（materialCard, materialChip 等）。
   * DomainRegistry 会自动合并所有域的 chatPageRenderers 到全局列表。
   */
  chatPageRenderers?: Array<{ name: string; code: string }>;

  /**
   * 实体别名映射（正式名称 → 别名数组）。
   * 用于 entity-resolver 在匹配部门/客户/员工等实体时，将别名映射到正式名称。
   * 例如 { "行政人事部": ["行政部", "人事部", "HR部", "HR"], "市场与新媒体部": ["市场部", "新媒体部"] }。
   * DomainRegistry 会自动合并所有域的 entityAliases 到全局映射（同名 key 的别名数组会合并去重）。
   */
  entityAliases?: Record<string, string[]>;

  /**
   * 实体别名通用后缀规则。
   * 用于 entity-resolver 自动生成后缀变体别名。
   * 例如 [{ suffix: "组", replacement: "" }, { suffix: "部", replacement: "" }]
   * 表示 "技术组" 自动生成别名 "技术"，"销售部" 自动生成别名 "销售"。
   * DomainRegistry 会自动合并所有域的 entityAliasSuffixRules 到全局列表。
   */
  entityAliasSuffixRules?: Array<{ suffix: string; replacement: string }>;

  /**
   * 运行时插件声明。
   * 由 EngineHost 在 init() 末尾统一收集、按 priority 排序、按 id 去重后挂载到 RuntimeHooks。
   * 业务侧增加 runtime plugin 不需要修改 engine-adapters.ts。
   *
   * 引擎层只内置真正通用的插件（transcript / metrics / promptAuthority / evolution），
   * 跨域共享但带业务语义的插件（task continuity / skill curator / maintenance scheduler）
   * 由 corePack 声明。
   */
  runtimePlugins?: RuntimePluginDefinition[];

  /**
   * 本地 LLM 启发式：判断用户问题是否为本域的"制度/政策/流程"类问题，
   * 命中时把意图归到 KNOWLEDGE_QA。
   * 替代 local-llm.ts 中硬编码的 isLeavePolicyQuestion。
   */
  localPolicyQuestionPatterns?: LocalPolicyQuestionPattern[];

  /**
   * 本地 LLM 启发式：本域的预设工具调用计划。
   * 命中时直接返回一组预设的工具调用，不走 query parser。
   * 替代 local-llm.ts 中硬编码的 isPersonalCustomerOverviewQuestion +
   * buildPersonalCustomerOverviewPlan。
   */
  localPlannerHeuristics?: LocalPlannerHeuristic[];

  /**
   * 知识库检索关键词。
   * 用于 local-llm.ts 中 shouldRetrieveKnowledge 判断 MIXED 意图下
   * 是否需要触发知识检索。多个域的关键词会合并去重。
   */
  knowledgeRetrievalKeywords?: string[];

  /**
   * Agentic（开放分析类）问题识别正则。
   * 用于 openai-llm.ts isClearlyAgenticQuestion 判断用户问题是否需要走 agentic 流程，
   * 命中任一即视为分析/复盘类问题。多个域的正则会合并。
   *
   * 业务侧的"晨会/经营计划/行动项/红黄绿"等管理动作词应通过此字段在域内声明。
   */
  agenticQuestionPatterns?: RegExp[];

  /**
   * 危险关键词列表（域特定的数据外泄/敏感意图标记）。
   * 用于 local-llm.ts 检测用户问题是否包含本域的敏感数据访问意图，
   * 命中后会降低意图识别置信度并改走 unsupported 分支。
   *
   * 引擎内置通用注入防御词（"忽略"、"绕过"），业务专属词（"全部客户"、"工资"、
   * "身份证"、"银行卡"等）由各域贡献。多个域的关键词会合并去重。
   */
  dangerousQuestionKeywords?: string[];

  /**
   * 知识库 chunk 选择启发式：heading 命中规则。
   * 用于 local-llm.ts chooseAnswerChunk 替代硬编码的 headingHints 表。
   */
  knowledgeChunkHeadingHints?: KnowledgeChunkHeadingHint[];

  /**
   * 知识库 chunk 重要句关键词。
   * 用于 local-llm.ts summarizeChunk 替代硬编码的关键词数组。
   * 多个域的关键词会合并去重。
   */
  importantSentenceKeywords?: ImportantSentenceKeyword[];

  // ── 生命周期钩子 ────────────────────────────────────────────────────────

  /**
   * 初始化钩子。在 register() 之前调用。
   * 用于读取配置、建立连接等，不做业务注册。
   */
  init?(ctx: DomainInitContext): void | Promise<void>;

  /**
   * 注册钩子（逃生口）。在声明式配置分发之后调用。
   * 用于远程初始化、条件注册、复杂依赖注入等无法声明式表达的场景。
   */
  register?(ctx: DomainRegistrationContext): void | Promise<void>;

  /**
   * 销毁钩子。在 runtime 关闭时调用。
   * 用于关闭连接、释放资源。
   */
  dispose?(ctx: DomainDisposeContext): void | Promise<void>;
}
