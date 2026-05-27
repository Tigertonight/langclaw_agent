/**
 * Engine Host — 统一导出。
 *
 * 使用方只需：
 *   import { createEngine, EngineHost } from "./engine/host/index.js";
 */

export { createEngine } from "./create-engine.js";
export { EngineHost } from "./engine-host.js";
export type { EngineConfig, EngineInspection } from "./engine-host.js";
export {
  loadDomainPacks,
  validateAndFilterPacks,
  formatDiagnostics,
  isVersionCompatible,
} from "./pack-loader.js";
export type { PackLoadDiagnostic, PackLoadResult } from "./pack-loader.js";

// ── Ports & Adapters ─────────────────────────────────────────────────────────
export type {
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
  EnginePorts,
} from "./engine-ports.js";

export {
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
