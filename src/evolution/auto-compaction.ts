import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeJoinWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import { MemoryLearner } from "./memory-learner.js";
import { MemoryCompactor } from "./memory-compactor.js";

/**
 * 自动 compaction 触发器：每个 evolution 回合结束（reviewTurn finish 钩子里）调用一次。
 * 决策：满足任一条件就跑一次 MemoryCompactor.compact —
 *   1) memory.items 超过 itemThreshold（默认 60）
 *   2) 距上次 compaction 已过 cooldownMs（默认 7 天）
 *
 * 状态持久化到 <workspace>/memory/compaction.state.json：last_run_at + last_item_count + last_status。
 * 既能避免 idle 闲忙时重复触发，也方便 smoke / 监控读取。
 *
 * 失败不抛——把 reviewTurn 流程切干净，写日志由 memory-compactor 自己负责。
 */

interface CompactionState {
  last_run_at?: string;
  last_item_count?: number;
  last_status?: "applied" | "rejected" | "unavailable" | "skipped" | "error";
  last_reason?: string;
  last_mode?: "llm" | "local_strategy";
}

interface AutoCompactionOptions {
  itemThreshold?: number;
  cooldownMs?: number;
  memoryLearner?: MemoryLearner;
  memoryCompactor?: MemoryCompactor;
  now?: () => number;
}

const DEFAULT_ITEM_THRESHOLD = 60;
const DEFAULT_COOLDOWN_MS = 7 * 86400 * 1000;

export class AutoCompactionTrigger {
  private readonly itemThreshold: number;
  private readonly cooldownMs: number;
  private readonly memoryLearner: MemoryLearner;
  private readonly memoryCompactor: MemoryCompactor;
  private readonly now: () => number;

  constructor(options: AutoCompactionOptions = {}) {
    this.itemThreshold = pickPositive(options.itemThreshold, readEnvNumber("EVOLUTION_AUTO_COMPACT_ITEM_THRESHOLD"), DEFAULT_ITEM_THRESHOLD);
    this.cooldownMs = pickPositive(options.cooldownMs, readEnvNumber("EVOLUTION_AUTO_COMPACT_COOLDOWN_MS"), DEFAULT_COOLDOWN_MS);
    this.memoryLearner = options.memoryLearner ?? new MemoryLearner();
    this.memoryCompactor = options.memoryCompactor ?? new MemoryCompactor();
    this.now = options.now ?? (() => Date.now());
  }

  /**
   * 决策 + 跑：返回触发结果，永不抛。
   * action="ran" 表示真触发了 compaction；"skipped" 表示阈值不到/冷却中；"disabled" 表示 env 关掉。
   */
  async maybeRun(workspace: WorkspaceContext): Promise<{
    action: "ran" | "skipped" | "disabled";
    reason?: string;
    item_count?: number;
    state?: CompactionState;
  }> {
    if (process.env.EVOLUTION_AUTO_COMPACT_ENABLED === "0" || process.env.EVOLUTION_AUTO_COMPACT_ENABLED === "false") {
      return { action: "disabled", reason: "auto_compact_disabled_env" };
    }
    const state = await this.readState(workspace);
    const itemCount = await this.countMemoryItems(workspace);
    const lastRunMs = state.last_run_at ? Date.parse(state.last_run_at) : 0;
    const elapsed = Number.isFinite(lastRunMs) && lastRunMs > 0 ? this.now() - lastRunMs : Infinity;
    const overItemThreshold = itemCount >= this.itemThreshold;
    const overCooldown = elapsed >= this.cooldownMs;
    if (!overItemThreshold && !overCooldown) {
      return { action: "skipped", reason: `under_threshold(items=${itemCount}/${this.itemThreshold},cooldown=${formatDuration(elapsed)}/${formatDuration(this.cooldownMs)})`, item_count: itemCount, state };
    }
    try {
      const result = await this.memoryCompactor.compact(workspace);
      const nextState: CompactionState = {
        last_run_at: new Date(this.now()).toISOString(),
        last_item_count: result.memory_items_written ?? itemCount,
        last_status: (result.status as CompactionState["last_status"]) ?? (result.ok ? "applied" : "rejected"),
        last_reason: result.reason,
        last_mode: result.mode
      };
      await this.writeState(workspace, nextState);
      return {
        action: "ran",
        reason: overItemThreshold ? `items_over_threshold(${itemCount}>=${this.itemThreshold})` : `cooldown_elapsed(${formatDuration(elapsed)}>=${formatDuration(this.cooldownMs)})`,
        item_count: itemCount,
        state: nextState
      };
    } catch (error) {
      const nextState: CompactionState = {
        last_run_at: new Date(this.now()).toISOString(),
        last_item_count: itemCount,
        last_status: "error",
        last_reason: error instanceof Error ? error.message : String(error)
      };
      await this.writeState(workspace, nextState);
      return { action: "ran", reason: "errored", item_count: itemCount, state: nextState };
    }
  }

  async readState(workspace: WorkspaceContext): Promise<CompactionState> {
    const file = this.statePath(workspace);
    if (!existsSync(file)) return {};
    try {
      return JSON.parse(await readFile(file, "utf8")) as CompactionState;
    } catch {
      return {};
    }
  }

  private async writeState(workspace: WorkspaceContext, state: CompactionState): Promise<void> {
    const file = this.statePath(workspace);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(state, null, 2), "utf8");
  }

  private statePath(workspace: WorkspaceContext): string {
    return safeJoinWorkspace(workspace.root, "memory", "compaction.state.json");
  }

  private async countMemoryItems(workspace: WorkspaceContext): Promise<number> {
    const memory = await this.memoryLearner.load(workspace);
    return Array.isArray(memory.items) ? memory.items.length : 0;
  }
}

function readEnvNumber(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function pickPositive(...candidates: Array<number | undefined>): number {
  for (const candidate of candidates) {
    if (typeof candidate === "number" && Number.isFinite(candidate) && candidate > 0) return candidate;
  }
  return 1;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms)) return "∞";
  const seconds = Math.round(ms / 1000);
  if (seconds < 120) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
