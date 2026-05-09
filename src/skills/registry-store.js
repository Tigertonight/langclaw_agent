import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { loadSkillDefinitionFromDir } from "./manifest.js";

export class SkillRegistryStore {
  constructor({ workspaceDir = "workspace/skills", builtinDir = "skills" } = {}) {
    this.workspaceDir = resolveProjectPath(workspaceDir);
    this.installedDir = path.join(this.workspaceDir, "installed");
    this.registryFile = path.join(this.workspaceDir, "registry.json");
    this.builtinDir = resolveProjectPath(builtinDir);
  }

  async listConfig() {
    if (!existsSync(this.registryFile)) {
      return { installed: [], overrides: {} };
    }
    try {
      return JSON.parse(await readFile(this.registryFile, "utf8"));
    } catch {
      return { installed: [], overrides: {} };
    }
  }

  async saveConfig(config) {
    await mkdir(this.workspaceDir, { recursive: true });
    await writeFile(this.registryFile, JSON.stringify(config, null, 2), "utf8");
  }

  async installFromLocalDir(sourcePath) {
    const resolvedSource = path.resolve(sourcePath);
    const definition = await loadSkillDefinitionFromDir(resolvedSource, {
      source: "local_directory",
      install_type: "installed"
    });
    const targetDir = path.join(this.installedDir, definition.id);

    await rm(targetDir, { recursive: true, force: true });
    await mkdir(this.installedDir, { recursive: true });
    await cp(resolvedSource, targetDir, { recursive: true });

    const copied = await loadSkillDefinitionFromDir(targetDir, {
      source: "local_directory",
      install_type: "installed"
    });
    const config = await this.listConfig();
    const nextEntry = {
      id: copied.id,
      name: copied.name,
      version: copied.version,
      enabled: copied.enabled,
      source_path: resolvedSource,
      local_path: targetDir,
      installed_at: new Date().toISOString()
    };
    const installed = config.installed.filter((entry) => entry.id !== copied.id).concat(nextEntry);
    await this.saveConfig({
      ...config,
      installed
    });
    return nextEntry;
  }

  async setEnabled(skillId, enabled) {
    const config = await this.listConfig();
    const installedIndex = config.installed.findIndex((entry) => entry.id === skillId);
    if (installedIndex >= 0) {
      config.installed[installedIndex] = {
        ...config.installed[installedIndex],
        enabled
      };
      await this.saveConfig(config);
      return { id: skillId, enabled, source: "installed" };
    }

    config.overrides ??= {};
    config.overrides[skillId] = {
      ...(config.overrides[skillId] ?? {}),
      enabled
    };
    await this.saveConfig(config);
    return { id: skillId, enabled, source: "builtin" };
  }

  async listInstalledEntries() {
    const config = await this.listConfig();
    return config.installed ?? [];
  }

  async applyOverrides(definition) {
    const config = await this.listConfig();
    const installed = (config.installed ?? []).find((entry) => entry.id === definition.id);
    const override = config.overrides?.[definition.id] ?? {};
    return {
      ...definition,
      version: installed?.version ?? override.version ?? definition.version,
      enabled: override.enabled ?? installed?.enabled ?? definition.enabled
    };
  }
}
