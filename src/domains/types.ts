/**
 * Domain Pack 核心类型定义 — Re-export Hub。
 *
 * 所有协议类型已迁移到 src/engine/contracts/，
 * 此文件保留为向后兼容的 re-export 入口。
 *
 * 新代码应直接从 "../engine/contracts/index.js" 导入。
 * 现有代码通过此文件的 re-export 继续工作，零破坏性变更。
 */

// ── Resource Contract ────────────────────────────────────────────────────────
export type {
  ResourceFieldDef,
  ResourceConfig,
} from "../engine/contracts/resource-contract.js";

// ── Intent Contract ──────────────────────────────────────────────────────────
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
} from "../engine/contracts/intent-contract.js";

// ── Query Contract ───────────────────────────────────────────────────────────
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
} from "../engine/contracts/query-contract.js";

// ── Tool Contract ────────────────────────────────────────────────────────────
export type {
  CatalogDomainDefinition,
  ReportComposerDefinition,
  AgenticFallbackDefinition,
} from "../engine/contracts/tool-contract.js";

// ── Workflow Contract ────────────────────────────────────────────────────────
export type {
  DomainSkillConfig,
  SkillContractEnforcer,
  SkillMappingDefinition,
  CronTemplateDefinition,
} from "../engine/contracts/workflow-contract.js";

// ── Surface Contract ─────────────────────────────────────────────────────────
export type {
  SurfaceBuildInput,
  DomainSurfaceBuilder,
} from "../engine/contracts/surface-contract.js";

// ── Permission Contract ──────────────────────────────────────────────────────
export type {
  PermissionRuleInput,
  PermissionRuleFn,
} from "../engine/contracts/permission-contract.js";

// ── Evidence Contract ────────────────────────────────────────────────────────
export type {
  EvidenceInferenceDefinition,
} from "../engine/contracts/evidence-contract.js";

// ── Runtime Plugin Contract ──────────────────────────────────────────────────
export type {
  RuntimePluginDefinition,
} from "../engine/contracts/runtime-plugin-contract.js";

// ── Lifecycle Contract ───────────────────────────────────────────────────────
export type {
  DomainInitContext,
  ScenarioRegistrar,
  DomainRegistrationContext,
  DomainDisposeContext,
  MutableIntentRegistry,
  DeterministicRuleCollector,
  CatalogDomainCollector,
  SurfaceBuilderCollector,
} from "../engine/contracts/lifecycle-contract.js";

// ── DomainPack ───────────────────────────────────────────────────────────────
export type {
  DomainPack,
} from "../engine/contracts/domain-pack.js";

export {
  ENGINE_API_VERSION,
} from "../engine/contracts/domain-pack.js";
