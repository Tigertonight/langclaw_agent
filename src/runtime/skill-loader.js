import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { resolveProjectPath } from "../data/load-json.js";
import { loadSkillDefinitionFromDir } from "../skills/manifest.js";

export class FileSystemSkillLoader {
  constructor({ dir = "skills", registryStore } = {}) {
    this.dir = resolveProjectPath(dir);
    this.registryStore = registryStore;
    this.cache = null;
  }

  async list() {
    if (this.cache) return this.cache;
    const builtinSkills = await this.loadBuiltins();
    const installedSkills = await this.loadInstalled();
    const merged = dedupeSkills(builtinSkills.concat(installedSkills));
    const withOverrides = [];
    for (const skill of merged) {
      const next = this.registryStore ? await this.registryStore.applyOverrides(skill) : skill;
      withOverrides.push(next);
    }
    this.cache = withOverrides;
    return this.cache;
  }

  async select({ route, message, user }) {
    const skills = await this.list();
    return skills.filter((skill) => matchesSkill(skill, { route, message, user }));
  }

  invalidate() {
    this.cache = null;
  }

  async loadBuiltins() {
    if (!existsSync(this.dir)) return [];
    const entries = await readdir(this.dir, { withFileTypes: true });
    const skills = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dirPath = path.join(this.dir, entry.name);
      const skillPath = path.join(dirPath, "SKILL.md");
      if (!existsSync(skillPath)) continue;
      skills.push(await loadSkillDefinitionFromDir(dirPath, {
        id: entry.name,
        source: "workspace",
        install_type: "builtin",
        path: path.relative(resolveProjectPath(), skillPath)
      }));
    }
    return skills.map(withRelativePaths);
  }

  async loadInstalled() {
    if (!this.registryStore) return [];
    const entries = await this.registryStore.listInstalledEntries();
    const skills = [];
    for (const entry of entries) {
      if (!entry.local_path || !existsSync(entry.local_path)) continue;
      const definition = await loadSkillDefinitionFromDir(entry.local_path, {
        id: entry.id,
        version: entry.version,
        enabled: entry.enabled,
        source: "local_directory",
        install_type: "installed"
      });
      skills.push(withRelativePaths(definition));
    }
    return skills;
  }
}

function withRelativePaths(skill) {
  return {
    ...skill,
    path: path.relative(resolveProjectPath(), skill.skill_path)
  };
}

function dedupeSkills(skills) {
  const map = new Map();
  for (const skill of skills) {
    map.set(skill.id, skill);
  }
  return Array.from(map.values());
}

function matchesSkill(skill, { route, message, user }) {
  if (skill.enabled === false) return false;
  if (skill.required_permissions?.length) {
    const permissionSet = new Set(user?.permissions ?? []);
    if (!skill.required_permissions.every((permission) => permissionSet.has(permission))) {
      return false;
    }
  }
  if (skill.intents.length > 0) return skill.intents.includes(route.intent);
  return skill.triggers.some((trigger) => message.includes(trigger));
}
