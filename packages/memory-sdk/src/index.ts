export { IdentityProvider } from "./identity.js";
export type { Identity, IdentityProviderOptions } from "./identity.js";

export {
  MemoryClient,
  MemoryServiceError
} from "./client.js";
export type {
  MemoryClientOptions,
  CallContext,
  CreateMemoryInput,
  MemoryRecord,
  MemoryListItem,
  SearchHit,
  KnowledgeSearchInput,
  MemorySearchInput,
  GrepInput,
  MessageItem,
  DocumentIngestInput
} from "./client.js";

export { buildMemoryTools } from "./tools.js";
export type { ToolDefinition, ToolFactoryOptions } from "./tools.js";
