import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { safeJoinWorkspace, safeUserId, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject } from "../types/agent-contracts.js";

export type ConflictStatus = "open" | "needs_user_confirmation" | "resolved" | "ignored";

export interface MemoryConflict extends JsonObject {
  id: string;
  key: string;
  description: string;
  resolution?: string;
  status: ConflictStatus;
  source: string;
  created_at: string;
  updated_at: string;
}

export class ConflictStore {
  async upsert(workspace: WorkspaceContext, input: {
    key: string;
    description: string;
    resolution?: string;
    status?: ConflictStatus;
    source?: string;
  }): Promise<MemoryConflict> {
    const file = await this.loadFile(workspace);
    const id = safeUserId(input.key || `conflict_${Date.now()}`);
    const existing = file.conflicts.find((item) => item.id === id);
    const now = new Date().toISOString();
    const next: MemoryConflict = {
      id,
      key: input.key,
      description: input.description,
      resolution: input.resolution,
      status: input.status ?? existing?.status ?? "open",
      source: input.source ?? existing?.source ?? "unknown",
      created_at: existing?.created_at ?? now,
      updated_at: now
    };
    file.conflicts = file.conflicts.filter((item) => item.id !== id).concat(next);
    await this.saveFile(workspace, file);
    return next;
  }

  async list(workspace: WorkspaceContext, status?: ConflictStatus): Promise<MemoryConflict[]> {
    const file = await this.loadFile(workspace);
    return file.conflicts
      .filter((item) => !status || item.status === status)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  }

  async resolve(workspace: WorkspaceContext, id: string, status: ConflictStatus, resolution?: string): Promise<MemoryConflict | null> {
    const file = await this.loadFile(workspace);
    const existing = file.conflicts.find((item) => item.id === id || item.key === id);
    if (!existing) return null;
    existing.status = status;
    existing.resolution = resolution ?? existing.resolution;
    existing.updated_at = new Date().toISOString();
    await this.saveFile(workspace, file);
    return existing;
  }

  async confirm(workspace: WorkspaceContext, id: string, resolution: string): Promise<MemoryConflict | null> {
    return this.resolve(workspace, id, "resolved", resolution);
  }

  async ignore(workspace: WorkspaceContext, id: string, reason?: string): Promise<MemoryConflict | null> {
    return this.resolve(workspace, id, "ignored", reason ?? "ignored_by_user");
  }

  filePath(workspace: WorkspaceContext): string {
    return safeJoinWorkspace(workspace.root, "memory", "conflicts.json");
  }

  private async loadFile(workspace: WorkspaceContext): Promise<{ conflicts: MemoryConflict[] }> {
    const file = this.filePath(workspace);
    if (!existsSync(file)) return { conflicts: [] };
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as { conflicts?: unknown };
      return { conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts.filter(isConflict) : [] };
    } catch {
      return { conflicts: [] };
    }
  }

  private async saveFile(workspace: WorkspaceContext, file: { conflicts: MemoryConflict[] }): Promise<void> {
    await mkdir(path.dirname(this.filePath(workspace)), { recursive: true });
    await writeFile(this.filePath(workspace), JSON.stringify({ updated_at: new Date().toISOString(), conflicts: file.conflicts }, null, 2), "utf8");
  }
}

function isConflict(value: unknown): value is MemoryConflict {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as { id?: unknown }).id === "string"
    && typeof (value as { key?: unknown }).key === "string"
    && typeof (value as { description?: unknown }).description === "string";
}
