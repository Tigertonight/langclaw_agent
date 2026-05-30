import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { JsonValue } from "../types/agent-contracts.js";

// projectRoot 必须指向实际仓库根目录（含 data/、users/、package.json）。
// 编译产物在 dist/ 下时，naive 的 "../.." 会指向 dist/ 而不是仓库根。
// 解决：从当前文件向上找包含 package.json 的最近目录；找不到回落到 cwd。
function findProjectRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 10; i++) {
    // 仓库根的标志：同时有 package.json + data/ 目录
    if (existsSync(path.join(dir, "package.json")) && existsSync(path.join(dir, "data"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const projectRoot = findProjectRoot();
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
