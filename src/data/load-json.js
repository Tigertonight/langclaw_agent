import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export function resolveProjectPath(...segments) {
  return path.join(projectRoot, ...segments);
}

export async function loadJson(relativePath) {
  const raw = await readFile(resolveProjectPath(relativePath), "utf8");
  return JSON.parse(raw);
}

export async function saveJson(relativePath, value) {
  const target = resolveProjectPath(relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
