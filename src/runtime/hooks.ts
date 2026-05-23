import type { JsonObject } from "../types/agent-contracts.js";
import { PluginGovernanceStore } from "./plugin-governance.js";
import { resolveUserWorkspace } from "./workspace-context.js";

export type RuntimeHookName =
  | "turn_start"
  | "context_ingest"
  | "context_assembly"
  | "route_decision"
  | "agentic_prepare"
  | "agentic_complete"
  | "tool_result"
  | "turn_end"
  | "session_idle"
  | "task_change"
  | "evolution_applied";

export type RuntimeHookHandler = ((event: JsonObject) => Promise<void | JsonObject> | void | JsonObject) & { pluginName?: string };

export interface RuntimePlugin {
  name: string;
  register(hooks: RuntimeHooks): void;
}

export class RuntimeHooks {
  private readonly handlers = new Map<RuntimeHookName, RuntimeHookHandler[]>();
  private readonly events: JsonObject[] = [];
  private readonly plugins = new Set<string>();
  private readonly governance = new PluginGovernanceStore();
  private registeringPlugin?: string;

  on(name: RuntimeHookName, handler: RuntimeHookHandler): void {
    if (this.registeringPlugin) handler.pluginName = this.registeringPlugin;
    const list = this.handlers.get(name) ?? [];
    list.push(handler);
    this.handlers.set(name, list);
  }

  /**
   * 永不抛错。即使 dispatch 内部 governance / 插件 / 内存写入全部炸掉，
   * 也只 console.warn 并返回。emit 是旁路通道，绝不能拖累主对话主循环。
   */
  async emit(name: RuntimeHookName, event: JsonObject): Promise<void> {
    try {
      await this.dispatch(name, event);
    } catch (error) {
      console.warn(`[hooks] emit ${name} crashed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async dispatch(name: RuntimeHookName, event: JsonObject): Promise<JsonObject> {
    const record: JsonObject = { ...event, hook: name, at: new Date().toISOString() };
    this.events.push(record);
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
    const merged: JsonObject = {};
    for (const handler of this.handlers.get(name) ?? []) {
      const pluginName = handler.pluginName ?? "anonymous";
      const workspace = typeof record.user_id === "string" ? safeResolveWorkspace(record.user_id) : null;
      if (workspace) {
        try {
          if (!this.governance.isEnabled(workspace, pluginName)) continue;
        } catch (governanceErr) {
          console.warn(`[hooks] governance.isEnabled crashed for ${pluginName}: ${governanceErr instanceof Error ? governanceErr.message : String(governanceErr)}`);
        }
      }
      try {
        const result = await handler(record);
        if (result && typeof result === "object" && !Array.isArray(result)) {
          Object.assign(merged, result);
        }
      } catch (error) {
        console.warn(`[hooks] handler ${pluginName} for ${name} threw: ${error instanceof Error ? error.message : String(error)}`);
        if (workspace) {
          try {
            await this.governance.recordFailure(workspace, pluginName, name, error);
          } catch (recordErr) {
            console.warn(`[hooks] governance.recordFailure crashed: ${recordErr instanceof Error ? recordErr.message : String(recordErr)}`);
          }
        }
      }
    }
    return merged;
  }

  use(plugin: RuntimePlugin): void {
    if (this.plugins.has(plugin.name)) return;
    this.registeringPlugin = plugin.name;
    try {
      plugin.register(this);
    } finally {
      this.registeringPlugin = undefined;
    }
    this.plugins.add(plugin.name);
  }

  listenerCount(name?: RuntimeHookName): number {
    if (name) return this.handlers.get(name)?.length ?? 0;
    return Array.from(this.handlers.values()).reduce((sum, list) => sum + list.length, 0);
  }

  recent(limit = 20): JsonObject[] {
    return this.events.slice(-Math.max(0, limit));
  }

  inspect(): JsonObject {
    return {
      plugins: Array.from(this.plugins),
      listeners: Object.fromEntries(Array.from(this.handlers.entries()).map(([name, list]) => [name, list.length])),
      recent: this.recent(20)
    };
  }
}

function safeResolveWorkspace(userId: string): ReturnType<typeof resolveUserWorkspace> | null {
  try {
    return resolveUserWorkspace(userId);
  } catch (err) {
    console.warn(`[hooks] resolveUserWorkspace crashed for user=${userId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}
