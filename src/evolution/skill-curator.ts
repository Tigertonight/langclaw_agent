import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeJoinWorkspace, safeUserId, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject } from "../types/agent-contracts.js";

export type SkillLifecycleStatus = "active" | "stale" | "archived";
export type SkillLifecycleEvent = "used" | "viewed" | "patched" | "refreshed";

export interface SkillCuratorEntry extends JsonObject {
  skill_id: string;
  status: SkillLifecycleStatus;
  pinned: boolean;
  usage_count: number;
  patch_count: number;
  created_at: string;
  updated_at: string;
  last_used_at?: string;
  last_patched_at?: string;
  stale_after_days: number;
  archive_after_days: number;
  archive_reason?: string;
  notes?: string;
}

interface SkillCuratorState {
  version: 1;
  updated_at: string;
  entries: Record<string, SkillCuratorEntry>;
}

export interface SkillCuratorPolicy {
  staleAfterDays?: number;
  archiveAfterDays?: number;
}

const DEFAULT_POLICY = {
  staleAfterDays: 30,
  archiveAfterDays: 90
};

export class SkillCurator {
  list(workspace: WorkspaceContext): SkillCuratorEntry[] {
    return sortEntries(Object.values(readStateSync(workspace).entries));
  }

  get(workspace: WorkspaceContext, skillId: string): SkillCuratorEntry | null {
    return readStateSync(workspace).entries[normalizeSkillId(skillId)] ?? null;
  }

  async recordUsage(
    workspace: WorkspaceContext,
    skillId: string,
    event: SkillLifecycleEvent = "used",
    policy: SkillCuratorPolicy = {}
  ): Promise<SkillCuratorEntry> {
    const state = readStateSync(workspace);
    const id = normalizeSkillId(skillId);
    const now = new Date().toISOString();
    const entry = createOrUpdateEntry(state.entries[id], id, now, policy);
    entry.updated_at = now;
    if (event === "used" || event === "viewed") {
      entry.usage_count += 1;
      entry.last_used_at = now;
      if (entry.status === "stale" && !entry.archive_reason) entry.status = "active";
    }
    if (event === "patched") {
      entry.patch_count += 1;
      entry.last_patched_at = now;
      entry.status = "active";
    }
    if (event === "refreshed") {
      entry.updated_at = now;
    }
    state.entries[id] = entry;
    await writeState(workspace, state);
    return entry;
  }

  async pin(workspace: WorkspaceContext, skillId: string, pinned = true): Promise<SkillCuratorEntry> {
    const state = readStateSync(workspace);
    const id = normalizeSkillId(skillId);
    const now = new Date().toISOString();
    const entry = createOrUpdateEntry(state.entries[id], id, now);
    entry.pinned = pinned;
    entry.updated_at = now;
    if (pinned && entry.status !== "archived") entry.status = "active";
    state.entries[id] = entry;
    await writeState(workspace, state);
    return entry;
  }

  async archive(workspace: WorkspaceContext, skillId: string, reason?: string): Promise<SkillCuratorEntry> {
    const state = readStateSync(workspace);
    const id = normalizeSkillId(skillId);
    const now = new Date().toISOString();
    const entry = createOrUpdateEntry(state.entries[id], id, now);
    entry.status = "archived";
    entry.pinned = false;
    entry.archive_reason = reason ?? "manual_archive";
    entry.updated_at = now;
    state.entries[id] = entry;
    await writeState(workspace, state);
    return entry;
  }

  async restore(workspace: WorkspaceContext, skillId: string): Promise<SkillCuratorEntry> {
    const state = readStateSync(workspace);
    const id = normalizeSkillId(skillId);
    const now = new Date().toISOString();
    const entry = createOrUpdateEntry(state.entries[id], id, now);
    entry.status = "active";
    entry.archive_reason = undefined;
    entry.updated_at = now;
    state.entries[id] = entry;
    await writeState(workspace, state);
    return entry;
  }

  async refresh(workspace: WorkspaceContext, now = new Date()): Promise<{ updated: SkillCuratorEntry[]; entries: SkillCuratorEntry[] }> {
    const state = readStateSync(workspace);
    const updated: SkillCuratorEntry[] = [];
    for (const entry of Object.values(state.entries)) {
      const before = entry.status;
      applyTtl(entry, now);
      if (entry.status !== before) {
        entry.updated_at = now.toISOString();
        updated.push(entry);
      }
    }
    await writeState(workspace, state);
    return { updated, entries: sortEntries(Object.values(state.entries)) };
  }

  snapshot(workspace: WorkspaceContext): JsonObject {
    const entries = this.list(workspace);
    return {
      total: entries.length,
      active: entries.filter((item) => item.status === "active").length,
      stale: entries.filter((item) => item.status === "stale").length,
      archived: entries.filter((item) => item.status === "archived").length,
      pinned: entries.filter((item) => item.pinned).length,
      entries: entries.map(toPublicEntry)
    };
  }
}

export function readSkillCuratorStateSync(workspace: WorkspaceContext): Record<string, SkillCuratorEntry> {
  return readStateSync(workspace).entries;
}

export function isSkillArchived(workspace: WorkspaceContext, skillId: string): boolean {
  return readStateSync(workspace).entries[normalizeSkillId(skillId)]?.status === "archived";
}

export function sortSkillsByCurator<T extends { id: string }>(workspace: WorkspaceContext, skills: T[]): T[] {
  const entries = readStateSync(workspace).entries;
  return [...skills].sort((a, b) => scoreSkill(entries[b.id]) - scoreSkill(entries[a.id]) || a.id.localeCompare(b.id));
}

export function toPublicEntry(entry: SkillCuratorEntry): JsonObject {
  return {
    skill_id: entry.skill_id,
    status: entry.status,
    pinned: entry.pinned,
    usage_count: entry.usage_count,
    patch_count: entry.patch_count,
    created_at: entry.created_at,
    updated_at: entry.updated_at,
    last_used_at: entry.last_used_at,
    last_patched_at: entry.last_patched_at,
    stale_after_days: entry.stale_after_days,
    archive_after_days: entry.archive_after_days,
    archive_reason: entry.archive_reason,
    notes: entry.notes
  };
}

function createOrUpdateEntry(entry: SkillCuratorEntry | undefined, id: string, now: string, policy: SkillCuratorPolicy = {}): SkillCuratorEntry {
  if (entry) {
    entry.stale_after_days = readPositive(policy.staleAfterDays, entry.stale_after_days);
    entry.archive_after_days = readPositive(policy.archiveAfterDays, entry.archive_after_days);
    return entry;
  }
  return {
    skill_id: id,
    status: "active",
    pinned: false,
    usage_count: 0,
    patch_count: 0,
    created_at: now,
    updated_at: now,
    stale_after_days: readPositive(policy.staleAfterDays, DEFAULT_POLICY.staleAfterDays),
    archive_after_days: readPositive(policy.archiveAfterDays, DEFAULT_POLICY.archiveAfterDays)
  };
}

function applyTtl(entry: SkillCuratorEntry, now: Date): void {
  if (entry.pinned || entry.status === "archived") return;
  const anchor = Date.parse(entry.last_used_at ?? entry.last_patched_at ?? entry.created_at);
  if (!Number.isFinite(anchor)) return;
  const ageDays = Math.floor((now.getTime() - anchor) / 86400000);
  if (ageDays >= entry.archive_after_days) {
    entry.status = "archived";
    entry.archive_reason = "ttl_expired";
    return;
  }
  if (ageDays >= entry.stale_after_days) {
    entry.status = "stale";
  }
}

function scoreSkill(entry: SkillCuratorEntry | undefined): number {
  if (!entry) return 1000;
  if (entry.status === "archived") return -100000;
  const pinScore = entry.pinned ? 100000 : 0;
  const statusScore = entry.status === "active" ? 1000 : 0;
  const usageScore = Math.min(entry.usage_count, 100);
  const lastUsed = Date.parse(entry.last_used_at ?? entry.last_patched_at ?? entry.created_at);
  const recencyScore = Number.isFinite(lastUsed) ? Math.max(0, 100 - Math.floor((Date.now() - lastUsed) / 86400000)) : 0;
  return pinScore + statusScore + usageScore + recencyScore;
}

function sortEntries(entries: SkillCuratorEntry[]): SkillCuratorEntry[] {
  return [...entries].sort((a, b) => scoreSkill(b) - scoreSkill(a) || a.skill_id.localeCompare(b.skill_id));
}

function readStateSync(workspace: WorkspaceContext): SkillCuratorState {
  const file = statePath(workspace);
  if (!existsSync(file)) return createEmptyState();
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<SkillCuratorState>;
    const entries = parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {};
    return {
      version: 1,
      updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date(0).toISOString(),
      entries: Object.fromEntries(Object.entries(entries).map(([key, value]) => [normalizeSkillId(key), normalizeEntry(normalizeSkillId(key), value)]))
    };
  } catch {
    return createEmptyState();
  }
}

async function writeState(workspace: WorkspaceContext, state: SkillCuratorState): Promise<void> {
  state.updated_at = new Date().toISOString();
  const file = statePath(workspace);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(state, null, 2), "utf8");
}

function normalizeEntry(id: string, value: unknown): SkillCuratorEntry {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const now = new Date().toISOString();
  const statusText = String(record.status ?? "active");
  return {
    skill_id: normalizeSkillId(record.skill_id ?? id),
    status: statusText === "stale" || statusText === "archived" ? statusText : "active",
    pinned: record.pinned === true,
    usage_count: readPositive(record.usage_count, 0),
    patch_count: readPositive(record.patch_count, 0),
    created_at: typeof record.created_at === "string" ? record.created_at : now,
    updated_at: typeof record.updated_at === "string" ? record.updated_at : now,
    last_used_at: typeof record.last_used_at === "string" ? record.last_used_at : undefined,
    last_patched_at: typeof record.last_patched_at === "string" ? record.last_patched_at : undefined,
    stale_after_days: readPositive(record.stale_after_days, DEFAULT_POLICY.staleAfterDays),
    archive_after_days: readPositive(record.archive_after_days, DEFAULT_POLICY.archiveAfterDays),
    archive_reason: typeof record.archive_reason === "string" ? record.archive_reason : undefined,
    notes: typeof record.notes === "string" ? record.notes : undefined
  };
}

function createEmptyState(): SkillCuratorState {
  return { version: 1, updated_at: new Date(0).toISOString(), entries: {} };
}

function statePath(workspace: WorkspaceContext): string {
  return safeJoinWorkspace(workspace.root, ".evolution", "skills", "curator.json");
}

function normalizeSkillId(value: unknown): string {
  return safeUserId(String(value ?? "unknown"));
}

function readPositive(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : fallback;
}
