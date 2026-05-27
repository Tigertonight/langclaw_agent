/**
 * Engine Contract: Lifecycle
 * Stability: stable
 *
 * DomainPack 生命周期协议。定义 init/register/dispose 阶段的上下文接口，
 * 以及 register() 逃生口所需的收集器接口。
 */

import type { IntentManifest } from "./base-types.js";
import type { ToolRegistry } from "../../tools/registry.js";
import type { CommandRegistry } from "../../router/command-registry.js";
import type { DeterministicRuleDefinition } from "./intent-contract.js";
import type { CatalogDomainDefinition } from "./tool-contract.js";
import type { DomainSurfaceBuilder } from "./surface-contract.js";

/**
 * DomainPack 初始化上下文。
 * init() 阶段可用于读取配置、建立连接等，不做业务注册。
 */
export interface DomainInitContext {
  /** 当前工作目录 */
  cwd: string;
  /** 环境变量快照 */
  env: Record<string, string | undefined>;
}

/**
 * Scenario 注册器接口，供 register() 逃生口使用。
 */
export interface ScenarioRegistrar {
  register(intentCode: string, scenario: { run(input: unknown): Promise<unknown> }): void;
}

/**
 * DomainPack 注册上下文。
 * register() 阶段可用于向各注册表注入动态内容（逃生口）。
 */
export interface DomainRegistrationContext {
  toolRegistry: ToolRegistry;
  intentRegistry: MutableIntentRegistry;
  commandRegistry: CommandRegistry;
  deterministicRules: DeterministicRuleCollector;
  catalogRegistry: CatalogDomainCollector;
  surfaceRegistry: SurfaceBuilderCollector;
  scenarioRouter: ScenarioRegistrar;
}

/**
 * DomainPack 销毁上下文。
 * dispose() 阶段可用于关闭连接、释放资源。
 */
export interface DomainDisposeContext {
  reason?: string;
}

/**
 * 可变的 IntentRegistry 接口，供 register() 逃生口使用。
 */
export interface MutableIntentRegistry {
  register(manifest: IntentManifest): void;
  registerMany(manifests: IntentManifest[]): void;
}

/**
 * 确定性规则收集器，供 register() 逃生口使用。
 */
export interface DeterministicRuleCollector {
  add(rule: DeterministicRuleDefinition): void;
  addMany(rules: DeterministicRuleDefinition[]): void;
}

/**
 * Catalog domain 收集器，供 register() 逃生口使用。
 */
export interface CatalogDomainCollector {
  add(domain: CatalogDomainDefinition): void;
}

/**
 * Surface builder 收集器，供 register() 逃生口使用。
 */
export interface SurfaceBuilderCollector {
  add(builder: DomainSurfaceBuilder): void;
}
