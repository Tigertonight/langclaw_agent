import { PluginGovernanceStore } from "../runtime/plugin-governance.js";
import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject, ToolDefinition, ToolExecutionContext } from "../types/agent-contracts.js";
import { defineTool, z, ToolResultBaseSchema } from "./zod-helpers.js";

export function createPluginTools({ store = new PluginGovernanceStore() }: { store?: PluginGovernanceStore } = {}): ToolDefinition[] {
  return [
    defineTool({
      name: "runtime.plugin.list",
      description: "List workspace plugin governance state, including enablement, config, and recent failures.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      inputSchema: z.object({}).strict(),
      outputSchema: ToolResultBaseSchema,
      execute(_args, context) {
        return { ok: true, tool: "runtime.plugin.list", data: store.list(getWorkspace(context)) };
      }
    }),
    defineTool({
      name: "runtime.plugin.enable",
      description: "Enable or disable a Hook Runtime plugin for this user workspace.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({
        plugin: z.string().min(1).max(128).regex(/^[A-Za-z0-9_.\-:]+$/),
        enabled: z.boolean()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        return { ok: true, tool: "runtime.plugin.enable", data: { plugin: await store.setEnabled(getWorkspace(context), args.plugin, args.enabled) } };
      }
    }),
    defineTool({
      name: "runtime.plugin.config",
      description: "Set workspace-scoped config for a Hook Runtime plugin.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({
        plugin: z.string().min(1).max(128).regex(/^[A-Za-z0-9_.\-:]+$/),
        config: z.record(z.string(), z.unknown())
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        return {
          ok: true,
          tool: "runtime.plugin.config",
          data: { plugin: await store.setConfig(getWorkspace(context), args.plugin, args.config as JsonObject) }
        };
      }
    })
  ];
}

function getWorkspace(context: ToolExecutionContext = {}): WorkspaceContext {
  const workspace = context.workspace;
  if (workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof (workspace as { root?: unknown }).root === "string") {
    return workspace as WorkspaceContext;
  }
  return resolveUserWorkspace(context.user?.id ?? "anonymous");
}
