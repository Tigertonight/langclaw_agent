import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function loadSkillDefinitionFromDir(dirPath, defaults = {}) {
  const manifestPath = path.join(dirPath, "manifest.json");
  const skillPath = path.join(dirPath, "SKILL.md");

  if (!existsSync(skillPath)) {
    throw new Error(`SKILL.md 不存在：${dirPath}`);
  }

  const manifest = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, "utf8"))
    : {};
  const raw = await readFile(skillPath, "utf8");
  const { metadata, body } = parseFrontmatter(raw);
  const merged = mergeSkillMetadata(manifest, metadata, defaults);

  return {
    id: merged.id,
    name: merged.name,
    description: merged.description ?? "",
    version: merged.version ?? "0.1.0",
    enabled: merged.enabled !== false,
    intents: toArray(merged.intents),
    intent_codes: toArray(merged.intent_codes),
    triggers: toArray(merged.triggers),
    required_permissions: toArray(merged.required_permissions),
    required_primitives: toArray(merged.primitives ?? merged.required_primitives),
    output_modes: toArray(merged.output_modes),
    planning_style: merged.planning_style ?? "guided",
    source: merged.source ?? "workspace",
    install_type: merged.install_type ?? "builtin",
    dir: dirPath,
    manifest_path: existsSync(manifestPath) ? manifestPath : null,
    skill_path: skillPath,
    instructions: body.trim(),
    metadata: merged
  };
}

export function parseFrontmatter(raw) {
  if (!raw.startsWith("---")) return { metadata: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { metadata: {}, body: raw };
  const yaml = raw.slice(3, end).trim();
  const body = raw.slice(end + 4);
  const metadata = {};
  for (const line of yaml.split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    metadata[match[1]] = parseScalar(match[2]);
  }
  return { metadata, body };
}

export function toArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function mergeSkillMetadata(manifest, frontmatter, defaults) {
  const id = manifest.id ?? defaults.id ?? frontmatter.name ?? path.basename(defaults.dirPath ?? defaults.id ?? "skill");
  return {
    ...frontmatter,
    ...manifest,
    ...defaults,
    id,
    name: manifest.name ?? frontmatter.name ?? defaults.name ?? id,
    description: manifest.description ?? frontmatter.description ?? defaults.description ?? "",
    version: manifest.version ?? defaults.version ?? "0.1.0",
    enabled: manifest.enabled ?? defaults.enabled ?? true
  };
}

function parseScalar(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed.replace(/^["']|["']$/g, "");
}
