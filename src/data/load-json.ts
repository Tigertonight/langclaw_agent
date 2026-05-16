import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { JsonValue } from "../types/agent-contracts.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
type LoadedJsonDefault = Record<string, string> & Array<Record<string, string>>;

export function resolveProjectPath(...segments: string[]): string {
  return path.join(projectRoot, ...segments);
}

export async function loadJson<T = LoadedJsonDefault>(relativePath: string): Promise<T> {
  const raw = await readFile(resolveProjectPath(relativePath), "utf8");
  return JSON.parse(raw) as T;
}

export async function saveJson(relativePath: string, value: JsonValue): Promise<void> {
  const target = resolveProjectPath(relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
