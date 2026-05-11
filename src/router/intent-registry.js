import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

/**
 * IntentRegistry：扫描 data/intent-codes/*.json，加载 manifest。
 * 同步 IO（启动时一次性加载，PoC 范围内不需要热更新）。
 */
export class IntentRegistry {
  constructor({ dir = "data/intent-codes" } = {}) {
    this.dir = dir;
    this.codes = new Map();
    this.load();
  }

  load() {
    const absDir = resolve(process.cwd(), this.dir);
    let entries;
    try {
      entries = readdirSync(absDir);
    } catch (err) {
      console.warn(`[IntentRegistry] 读取目录失败：${absDir}（${err.message}），意图列表为空。`);
      return;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const fullPath = join(absDir, entry);
      try {
        const stat = statSync(fullPath);
        if (!stat.isFile()) continue;
        const raw = readFileSync(fullPath, "utf8");
        const manifest = JSON.parse(raw);
        this.validate(manifest, entry);
        this.codes.set(manifest.intent_code, manifest);
      } catch (err) {
        console.warn(`[IntentRegistry] 加载 ${entry} 失败：${err.message}`);
      }
    }
  }

  validate(manifest, fileName) {
    const missing = [];
    if (!manifest.intent_code) missing.push("intent_code");
    if (!manifest.handler_type) missing.push("handler_type");
    if (!manifest.params_schema) missing.push("params_schema");
    if (missing.length) {
      console.warn(`[IntentRegistry] manifest ${fileName} 缺字段：${missing.join(", ")}`);
    }
  }

  getCode(intent_code) {
    return this.codes.get(intent_code) ?? null;
  }

  listCodes() {
    return Array.from(this.codes.values());
  }

  getAllExamples() {
    const result = [];
    for (const manifest of this.codes.values()) {
      for (const example of manifest.examples ?? []) {
        result.push({ intent_code: manifest.intent_code, example });
      }
    }
    return result;
  }
}
