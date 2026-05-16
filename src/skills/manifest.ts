import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { JsonObject, JsonValue, SkillDefinition } from "../types/agent-contracts.js";

interface SkillDefinitionDefaults extends Partial<SkillDefinition> {
  dirPath?: string;
  primitives?: string[] | string;
}

interface FrontmatterResult {
  metadata: JsonObject;
  body: string;
}

interface SkillMetadata extends JsonObject {
  id: string;
  name: string;
  description?: string;
  version?: string;
  enabled?: boolean;
  intents?: string[] | string;
  intent_codes?: string[] | string;
  triggers?: string[] | string;
  required_permissions?: string[] | string;
  required_primitives?: string[] | string;
  primitives?: string[] | string;
  output_modes?: string[] | string;
  planning_style?: string;
  source?: string;
  install_type?: string;
}

export async function loadSkillDefinitionFromDir(
  dirPath: string,
  defaults: SkillDefinitionDefaults = {}
): Promise<SkillDefinition> {
  const manifestPath = path.join(dirPath, "manifest.json");
  const skillPath = path.join(dirPath, "SKILL.md");

  if (!existsSync(skillPath)) {
    throw new Error(`SKILL.md 不存在：${dirPath}`);
  }

  const manifest = existsSync(manifestPath)
    ? JSON.parse(await readFile(manifestPath, "utf8")) as JsonObject
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

export function parseFrontmatter(raw: string): FrontmatterResult {
  if (!raw.startsWith("---")) return { metadata: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { metadata: {}, body: raw };
  const yaml = raw.slice(3, end).trim();
  const body = raw.slice(end + 4);
  const metadata: JsonObject = {};
  for (const line of yaml.split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);
    if (!match) continue;
    metadata[match[1]] = parseScalar(match[2]);
  }
  return { metadata, body };
}

export function toArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (!value) return [];
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

function mergeSkillMetadata(
  manifest: JsonObject,
  frontmatter: JsonObject,
  defaults: SkillDefinitionDefaults
): SkillMetadata {
  const id = String(manifest.id ?? defaults.id ?? frontmatter.name ?? path.basename(defaults.dirPath ?? defaults.id ?? "skill"));
  const merged = {
    ...frontmatter,
    ...manifest,
    ...defaults,
    id,
    name: manifest.name ?? frontmatter.name ?? defaults.name ?? id,
    description: manifest.description ?? frontmatter.description ?? defaults.description ?? "",
    version: manifest.version ?? defaults.version ?? "0.1.0",
    enabled: manifest.enabled ?? defaults.enabled ?? true
  } as SkillMetadata;
  return merged;
}

function parseScalar(value: string): JsonValue {
  const trimmed = value.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1).split(",").map((item) => item.trim()).filter(Boolean);
  }
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  return trimmed.replace(/^["']|["']$/g, "");
}
