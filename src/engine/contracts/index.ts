/**
 * Engine Contracts — 统一导出。
 *
 * 所有 Engine 协议的公共 API 入口。
 * DomainPack 和 Engine 内部模块都应通过此文件导入协议类型。
 *
 * 稳定等级标注在各 contract 文件头部：
 * - frozen: 基础类型，永不变更
 * - stable: 不会在 minor 版本中做破坏性变更
 * - experimental: 可能在 minor 版本中调整
 * - internal: 仅 Engine 内部使用，不保证稳定
 */

// ── Base Types (frozen) ──────────────────────────────────────────────────────
export type {
  JsonPrimitive,
  JsonValue,
  JsonObject,
  Confidence,
  ExecutionClass,
  HandlerType,
  IntentParamSchemaField,
  IntentParamSchema,
  DeterministicRuleManifest,
  IntentToolBinding,
  IntentManifest,
  Route,
  UserContext,
  QueryFilter,
  QuerySort,
  QueryEntity,
  QueryMetric,
  QueryIR,
  ToolMetadata,
  ToolExecutionContext,
  ToolDefinition,
  ToolResult,
  ToolCall,
} from "./base-types.js";

// ── Resource Contract (stable) ───────────────────────────────────────────────
export type {
  ResourceFieldDef,
  ResourceConfig,
} from "./resource-contract.js";

// ── Intent Contract (stable) ─────────────────────────────────────────────────
export type {
  ExtractorContext,
  ExtractorFn,
  ExtractorSpec,
  DomainExtractor,
  RuleInput,
  RuleMatch,
  DeterministicRuleDefinition,
  IntentCodeInferenceFn,
  CorrectionDeltaRule,
  UserFieldSourceDefinition,
} from "./intent-contract.js";

// ── Query Contract (stable) ──────────────────────────────────────────────────
export type {
  FilterTransformContext,
  FilterTransformFn,
  QueryAdapterInput,
  DefaultsInput,
  DefaultsResult,
  FiltersInput,
  SortInput,
  AnswerPostProcessInput,
  DomainQueryAdapter,
  QueryResourceSchema,
  ScopeSentinel,
} from "./query-contract.js";

// ── Tool Contract (stable) ───────────────────────────────────────────────────
export type {
  CatalogDomainDefinition,
  ReportComposerDefinition,
  AgenticFallbackDefinition,
  ToolResultSummarizerDefinition,
  ToolObservationSanitizerDefinition,
} from "./tool-contract.js";

// ── Workflow Contract (stable) ───────────────────────────────────────────────
export type {
  DomainSkillConfig,
  SkillContractEnforcer,
  SkillMappingDefinition,
  CronTemplateDefinition,
} from "./workflow-contract.js";

// ── Surface Contract (stable) ────────────────────────────────────────────────
export type {
  SurfaceBuildInput,
  DomainSurfaceBuilder,
} from "./surface-contract.js";

// ── Permission Contract (stable) ─────────────────────────────────────────────
export type {
  PermissionRuleInput,
  PermissionRuleFn,
  ToolPermissionPolicy,
  ToolPermissionPolicyInput,
} from "./permission-contract.js";

// ── Evidence Contract (stable) ───────────────────────────────────────────────
export type {
  EvidenceInferenceDefinition,
  FactExtractorDefinition,
  FactExtractionInput,
  ExtractedFact,
} from "./evidence-contract.js";

// ── Runtime Plugin Contract (stable) ─────────────────────────────────────────
export type {
  RuntimePluginDefinition,
} from "./runtime-plugin-contract.js";

// ── LLM Contract (stable) ────────────────────────────────────────────────────
export type {
  LocalPolicyQuestionPattern,
  LocalPlannerHeuristic,
  FollowUpPlannerHeuristic,
  KnownEntityProbe,
  DataLookupHint,
  KnowledgeChunkHeadingHint,
  ImportantSentenceKeyword,
} from "./llm-contract.js";

// ── Lifecycle Contract (stable) ──────────────────────────────────────────────
export type {
  DomainInitContext,
  ScenarioRegistrar,
  DomainRegistrationContext,
  DomainDisposeContext,
  MutableIntentRegistry,
  DeterministicRuleCollector,
  CatalogDomainCollector,
  SurfaceBuilderCollector,
} from "./lifecycle-contract.js";

// ── DomainPack (stable) ──────────────────────────────────────────────────────
export type {
  DomainPack,
} from "./domain-pack.js";

export {
  ENGINE_API_VERSION,
} from "./domain-pack.js";
