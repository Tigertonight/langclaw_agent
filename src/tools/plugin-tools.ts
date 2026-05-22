import { PluginGovernanceStore } from "../runtime/plugin-governance.js";
import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject, ToolDefinition, ToolExecutionContext } from "../types/agent-contracts.js";

export function createPluginTools({ store = new PluginGovernanceStore() }: { store?: PluginGovernanceStore } = {}): ToolDefinition[] {
  return [
    {
      name: "runtime.plugin.list",
      description: "List workspace plugin governance state, including enablement, config, and recent failures.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      schema: { type: "object", properties: {} },
      execute(_args, context) {
        return { ok: true, tool: "runtime.plugin.list", data: store.list(getWorkspace(context)) };
      }
    },
    {
      name: "runtime.plugin.enable",
      description: "Enable or disable a Hook Runtime plugin for this user workspace.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: { type: "object", properties: { plugin: { type: "string" }, enabled: { type: "boolean" } }, required: ["plugin", "enabled"] },
      async execute(args, context) {
        const plugin = typeof args?.plugin === "string" ? args.plugin : "";
        if (!plugin) return { ok: false, tool: "runtime.plugin.enable", error: "missing_plugin" };
        return { ok: true, tool: "runtime.plugin.enable", data: { plugin: await store.setEnabled(getWorkspace(context), plugin, args?.enabled === true) } };
      }
    },
    {
      name: "runtime.plugin.config",
      description: "Set workspace-scoped config for a Hook Runtime plugin.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: { type: "object", properties: { plugin: { type: "string" }, config: { type: "object" } }, required: ["plugin", "config"] },
      async execute(args, context) {
        const plugin = typeof args?.plugin === "string" ? args.plugin : "";
        const config = args?.config && typeof args.config === "object" && !Array.isArray(args.config) ? args.config as JsonObject : {};
        if (!plugin) return { ok: false, tool: "runtime.plugin.config", error: "missing_plugin" };
        return { ok: true, tool: "runtime.plugin.config", data: { plugin: await store.setConfig(getWorkspace(context), plugin, config) } };
      }
    }
  ];
}

function getWorkspace(context: ToolExecutionContext = {}): WorkspaceContext {
  const workspace = context.workspace;
  if (workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof (workspace as { root?: unknown }).root === "string") {
    return workspace as WorkspaceContext;
  }
  return resolveUserWorkspace(context.user?.id ?? "anonymous");
}
