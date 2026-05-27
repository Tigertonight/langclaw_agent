/**
 * Domain Pack 公共 API。
 *
 * 使用方只需 import { DomainRegistry, type DomainPack } from "./domains/index.js"
 *
 * 注意：所有协议类型的权威来源已迁移到 src/engine/contracts/。
 * 此文件通过 ./types.js 的 re-export 保持向后兼容。
 */

// 核心类型（通过 types.ts re-export hub 转发自 engine/contracts/）
export type {
  DomainPack,
  DomainInitContext,
  DomainRegistrationContext,
  DomainDisposeContext,
  ResourceConfig,
  ResourceFieldDef,
  DeterministicRuleDefinition,
  DomainExtractor,
  ExtractorContext,
  ExtractorFn,
  ExtractorSpec,
  RuleInput,
  RuleMatch,
  DomainQueryAdapter,
  QueryAdapterInput,
  DefaultsInput,
  DefaultsResult,
  FiltersInput,
  SortInput,
  AnswerPostProcessInput,
  CatalogDomainDefinition,
  DomainSurfaceBuilder,
  SurfaceBuildInput,
  DomainSkillConfig,
  MutableIntentRegistry,
  DeterministicRuleCollector,
  CatalogDomainCollector,
  SurfaceBuilderCollector,
} from "./types.js";

// Engine API Version
export { ENGINE_API_VERSION } from "./types.js";

// 统一 pack 入口
export { AVAILABLE_PACKS, discoverDomainPacks } from "./available-packs.js";

// Registry
export { DomainRegistry, createRegistrationContext } from "./registry.js";
export { QueryAdapterRegistry } from "./query-adapter-registry.js";
