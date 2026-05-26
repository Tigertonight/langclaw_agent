import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { IntentManifest, IntentRegistry as IntentRegistryContract } from "../types/agent-contracts.js";

export interface IntentRegistryOptions {
  dir?: string;
}

export interface IntentExample {
  intent_code: string;
  example: string;
}

export class IntentRegistry implements IntentRegistryContract {
  private readonly dir: string;
  private readonly codes = new Map<string, IntentManifest>();

  constructor({ dir = "data/intent-codes" }: IntentRegistryOptions = {}) {
    this.dir = dir;
    this.load();
  }

  load(): void {
    const absDir = resolve(process.cwd(), this.dir);
    let entries: string[];
    try {
      entries = readdirSync(absDir);
    } catch (err) {
      console.warn(`[IntentRegistry] 读取目录失败：${absDir}（${getErrorMessage(err)}），意图列表为空。`);
      return;
    }
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const fullPath = join(absDir, entry);
      try {
        const stat = statSync(fullPath);
        if (!stat.isFile()) continue;
        const raw = readFileSync(fullPath, "utf8");
        const manifest = JSON.parse(raw) as IntentManifest;
        this.validate(manifest, entry);
        this.codes.set(manifest.intent_code, manifest);
      } catch (err) {
        console.warn(`[IntentRegistry] 加载 ${entry} 失败：${getErrorMessage(err)}`);
      }
    }
  }

  validate(manifest: Partial<IntentManifest>, fileName: string): void {
    const missing: string[] = [];
    if (!manifest.intent_code) missing.push("intent_code");
    if (!manifest.handler_type) missing.push("handler_type");
    if (!manifest.params_schema) missing.push("params_schema");
    if (missing.length) {
      console.warn(`[IntentRegistry] manifest ${fileName} 缺字段：${missing.join(", ")}`);
    }
  }

  getCode(intentCode: string): IntentManifest | null {
    return this.codes.get(intentCode) ?? null;
  }

  listCodes(): IntentManifest[] {
    return Array.from(this.codes.values());
  }

  getAllExamples(): IntentExample[] {
    const result: IntentExample[] = [];
    for (const manifest of this.codes.values()) {
      const examples = Array.isArray(manifest.examples) ? manifest.examples : [];
      for (const example of examples) {
        result.push({ intent_code: manifest.intent_code, example: String(example) });
      }
    }
    return result;
  }

  // ── 动态注册（Milestone 3：供 DomainPack.intentManifests 注入） ──────

  /**
   * 动态注册单个 IntentManifest。
   * 重复 intent_code 会覆盖已有的（后注册优先）。
   */
  register(manifest: IntentManifest): void {
    this.validate(manifest, `dynamic:${manifest.intent_code}`);
    this.codes.set(manifest.intent_code, manifest);
  }

  /**
   * 批量动态注册 IntentManifest。
   */
  registerMany(manifests: IntentManifest[]): void {
    for (const manifest of manifests) this.register(manifest);
  }
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
