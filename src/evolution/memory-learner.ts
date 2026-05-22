import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject } from "../types/agent-contracts.js";
import type { MemoryAction } from "./types.js";
import { loadDisabledEvolutionTargets } from "./governance.js";

interface MemoryFile extends JsonObject {
  owner_user_id: string;
  scope: "user";
  readonly_for_users: boolean;
  items: MemoryItem[];
  updated_at?: string;
}

interface MemoryItem extends JsonObject {
  key: string;
  type: string;
  value: string;
  confidence?: number;
  source?: string;
  created_at?: string;
  updated_at?: string;
}

export class MemoryLearner {
  async apply({ workspace, actions }: { workspace: WorkspaceContext; actions?: MemoryAction[] }): Promise<number> {
    const normalized = Array.isArray(actions) ? actions : [];
    if (!normalized.length) return 0;
    const disabled = await loadDisabledEvolutionTargets(workspace);
    const memory = await this.load(workspace);
    let changed = 0;

    for (const action of normalized) {
      const key = action.key.trim();
      if (disabled.has(key) || disabled.has(`memory:${key}`)) continue;
      if (action.op === "remove") {
        const before = memory.items.length;
        memory.items = memory.items.filter((item) => item.key !== key);
        if (memory.items.length !== before) changed += 1;
        continue;
      }
      if (typeof action.value !== "string" || !action.value.trim()) continue;
      const now = new Date().toISOString();
      const existing = memory.items.find((item) => item.key === key);
      if (existing) {
        existing.type = action.type;
        existing.value = action.value.trim();
        existing.confidence = action.confidence;
        existing.source = action.source ?? "evolution";
        existing.updated_at = now;
      } else {
        memory.items.push({
          key,
          type: action.type,
          value: action.value.trim(),
          confidence: action.confidence,
          source: action.source ?? "evolution",
          created_at: now,
          updated_at: now
        });
      }
      changed += 1;
    }

    if (changed) {
      memory.items = compactMemoryItems(memory.items).slice(-100);
      memory.updated_at = new Date().toISOString();
      await this.save(workspace, memory);
    }
    return changed;
  }

  async load(workspace: WorkspaceContext): Promise<MemoryFile> {
    const file = this.filePath(workspace);
    if (!existsSync(file)) return createMemoryFile(workspace.user_id);
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<MemoryFile>;
      return {
        owner_user_id: typeof parsed.owner_user_id === "string" ? parsed.owner_user_id : workspace.user_id,
        scope: "user",
        readonly_for_users: false,
        items: Array.isArray(parsed.items) ? parsed.items.filter(isMemoryItem) : [],
        updated_at: parsed.updated_at
      };
    } catch {
      return createMemoryFile(workspace.user_id);
    }
  }

  async save(workspace: WorkspaceContext, memory: MemoryFile): Promise<void> {
    await mkdir(workspace.memory_dir, { recursive: true });
    await writeFile(this.filePath(workspace), JSON.stringify(memory, null, 2), "utf8");
  }

  filePath(workspace: WorkspaceContext): string {
    return path.join(workspace.memory_dir, "memory.json");
  }
}

function compactMemoryItems(items: MemoryItem[]): MemoryItem[] {
  const byKey = new Map<string, MemoryItem>();
  for (const item of items) {
    const existing = byKey.get(item.key);
    if (!existing || String(item.updated_at ?? item.created_at ?? "").localeCompare(String(existing.updated_at ?? existing.created_at ?? "")) >= 0) {
      byKey.set(item.key, {
        ...item,
        confidence: decayConfidence(item.confidence, item.updated_at ?? item.created_at)
      });
    }
  }
  const byValue = new Map<string, MemoryItem>();
  for (const item of byKey.values()) {
    const signature = `${item.type}:${item.value.trim().toLowerCase()}`;
    const existing = byValue.get(signature);
    if (!existing || Number(item.confidence ?? 0) >= Number(existing.confidence ?? 0)) {
      byValue.set(signature, item);
    }
  }
  return Array.from(byValue.values()).sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
}

function decayConfidence(confidence: unknown, lastSeen: unknown): number | undefined {
  if (typeof confidence !== "number") return undefined;
  const ts = Date.parse(String(lastSeen ?? ""));
  if (!Number.isFinite(ts)) return confidence;
  const ageDays = (Date.now() - ts) / (24 * 60 * 60 * 1000);
  if (ageDays <= 30) return confidence;
  return Math.max(0.2, Number((confidence * Math.pow(0.98, Math.floor(ageDays / 30))).toFixed(3)));
}

function createMemoryFile(userId: string): MemoryFile {
  return {
    owner_user_id: userId,
    scope: "user",
    readonly_for_users: false,
    items: []
  };
}

function isMemoryItem(value: unknown): value is MemoryItem {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as { key?: unknown }).key === "string"
    && typeof (value as { value?: unknown }).value === "string";
}
