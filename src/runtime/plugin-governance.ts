import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeJoinWorkspace, type WorkspaceContext } from "./workspace-context.js";
import type { JsonObject } from "../types/agent-contracts.js";

export interface PluginGovernanceRecord extends JsonObject {
  name: string;
  enabled: boolean;
  config?: JsonObject;
  updated_at: string;
}

interface PluginFailure extends JsonObject {
  plugin: string;
  hook: string;
  message: string;
  at: string;
}

interface PluginGovernanceState {
  version: 1;
  updated_at: string;
  plugins: Record<string, PluginGovernanceRecord>;
  failures: PluginFailure[];
}

export class PluginGovernanceStore {
  list(workspace: WorkspaceContext): JsonObject {
    const state = readState(workspace);
    return {
      plugins: Object.values(state.plugins),
      failures: state.failures.slice(-50)
    };
  }

  isEnabled(workspace: WorkspaceContext, plugin: string): boolean {
    return readState(workspace).plugins[plugin]?.enabled !== false;
  }

  async setEnabled(workspace: WorkspaceContext, plugin: string, enabled: boolean): Promise<PluginGovernanceRecord> {
    const state = readState(workspace);
    const now = new Date().toISOString();
    const record = {
      ...(state.plugins[plugin] ?? { name: plugin, config: {} }),
      name: plugin,
      enabled,
      updated_at: now
    };
    state.plugins[plugin] = record;
    await writeState(workspace, state);
    return record;
  }

  async setConfig(workspace: WorkspaceContext, plugin: string, config: JsonObject): Promise<PluginGovernanceRecord> {
    const state = readState(workspace);
    const now = new Date().toISOString();
    const record = {
      ...(state.plugins[plugin] ?? { name: plugin, enabled: true }),
      name: plugin,
      enabled: state.plugins[plugin]?.enabled !== false,
      config,
      updated_at: now
    };
    state.plugins[plugin] = record;
    await writeState(workspace, state);
    return record;
  }

  async recordFailure(workspace: WorkspaceContext, plugin: string, hook: string, error: unknown): Promise<void> {
    const state = readState(workspace);
    state.failures.push({
      plugin,
      hook,
      message: error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
      at: new Date().toISOString()
    });
    state.failures = state.failures.slice(-200);
    await writeState(workspace, state);
  }
}

function readState(workspace: WorkspaceContext): PluginGovernanceState {
  const file = statePath(workspace);
  if (!existsSync(file)) return emptyState();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<PluginGovernanceState>;
    return {
      version: 1,
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date(0).toISOString(),
      plugins: parsed.plugins && typeof parsed.plugins === "object" ? parsed.plugins as Record<string, PluginGovernanceRecord> : {},
      failures: Array.isArray(parsed.failures) ? parsed.failures.filter(isFailure) : []
    };
  } catch {
    return emptyState();
  }
}

async function writeState(workspace: WorkspaceContext, state: PluginGovernanceState): Promise<void> {
  state.updated_at = new Date().toISOString();
  const file = statePath(workspace);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2), "utf8");
}

function statePath(workspace: WorkspaceContext): string {
  return safeJoinWorkspace(workspace.root, ".evolution", "plugins.json");
}

function emptyState(): PluginGovernanceState {
  return { version: 1, updated_at: new Date(0).toISOString(), plugins: {}, failures: [] };
}

function isFailure(value: unknown): value is PluginFailure {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && typeof (value as { plugin?: unknown }).plugin === "string";
}
