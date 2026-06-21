/**
 * DomainPack 自动发现。
 *
 * 扫描 src/domains/ 下所有子目录中的 domain-pack.ts，
 * 动态导入并收集所有 DomainPack 实例。
 *
 * 约定：
 * 1. 每个域目录下必须有 domain-pack.ts（或 domain-pack.js）
 * 2. 该文件必须导出一个符合 DomainPack 接口的对象（任意导出名）
 * 3. core 域始终排在第一位（通过 id === "core" 判断）
 *
 * 新增业务域只需在 src/domains/ 下创建目录并添加 domain-pack.ts，
 * 无需修改任何其他文件。
 */

import type { DomainPack } from "./types.js";
import { readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 同步扫描 src/domains/ 下所有包含 domain-pack 的子目录 */
function findDomainPackDirs(): string[] {
  const dirs: string[] = [];
  const skipDirs = new Set(["shared"]);
  for (const entry of readdirSync(__dirname)) {
    if (skipDirs.has(entry)) continue;
    const fullPath = join(__dirname, entry);
    try {
      if (!statSync(fullPath).isDirectory()) continue;
    } catch { continue; }
    // 检查是否存在 domain-pack.ts 或 domain-pack.js
    const hasPack = existsSync(join(fullPath, "domain-pack.ts"))
      || existsSync(join(fullPath, "domain-pack.js"));
    if (hasPack) dirs.push(entry);
  }
  return dirs;
}

/**
 * 异步发现并加载所有 DomainPack。
 * core 域始终排在第一位，其余按目录名字母序排列。
 */
export async function discoverDomainPacks(): Promise<DomainPack[]> {
  const dirs = findDomainPackDirs();
  const packs: DomainPack[] = [];

  for (const dir of dirs) {
    try {
      const mod = await import(`./${dir}/domain-pack.js`);
      // 查找模块中第一个符合 DomainPack 接口的导出（有 id 和 name 字段）
      for (const key of Object.keys(mod)) {
        const candidate = mod[key];
        if (candidate && typeof candidate === "object" && typeof candidate.id === "string" && typeof candidate.name === "string") {
          packs.push(candidate as DomainPack);
          break;
        }
      }
    } catch (err) {
      console.warn(`[DomainPack] 加载 ${dir}/domain-pack 失败:`, err);
    }
  }

  // core 排第一，其余按 id 字母序
  packs.sort((a, b) => {
    if (a.id === "core") return -1;
    if (b.id === "core") return 1;
    return a.id.localeCompare(b.id);
  });

  return packs;
}

/**
 * @deprecated 使用 discoverDomainPacks() 替代。
 * 保留静态列表作为 fallback，确保向后兼容。
 */
import { corePack } from "./core/domain-pack.js";
import { dealerPack } from "./dealer/domain-pack.js";
import { attendancePack } from "./attendance/domain-pack.js";
import { retailDemoPack } from "./retail-demo/domain-pack.js";
import { cloudCommodityPack } from "./cloud-commodity/domain-pack.js";

export const AVAILABLE_PACKS: DomainPack[] = [
  corePack,
  cloudCommodityPack,
  dealerPack,
  attendancePack,
  retailDemoPack,
];
