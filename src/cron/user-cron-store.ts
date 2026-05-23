import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { safeJoinWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import { parseCronExpression, nextOccurrence } from "./cron-expression.js";
import type { JsonObject } from "../types/agent-contracts.js";

/**
 * UserCronStore —— 用户级 cron spec 持久化。
 *
 * 数据布局（按 workspace 隔离）：
 *   <workspace.root>/.cron/jobs.json        —— spec 列表 + 每个 spec 的 runtime state
 *   <workspace.root>/.cron/history/<id>.jsonl —— 每次 cron 触发的执行历史（append-only）
 *
 * spec 字段说明：
 *   - id           : 用户/agent 自动生成，cron_<rand>，全局保证唯一
 *   - user_id      : 创建者；删除/更新校验；运行时构造 ToolExecutionContext 的 user
 *   - cron_expr    : 5 字段 cron（分时日月周）
 *   - task         : 子 agent 的目标（自然语言）
 *   - allowed_tools: 工具白名单（可选，不传走全集）
 *   - max_steps    : 子 agent 步数上限（可选）
 *   - missed_window: "skip" | "catch_up"（默认 skip：错过的窗口不补跑）
 *
 * runtime state 字段：
 *   - last_run_at / last_status / last_summary
 *   - consecutive_failures（连续失败计数；succeeded 时清零）
 *   - paused（连续失败 >= PAUSE_THRESHOLD 自动 true；手动 resume 改 false）
 *   - running（防并发：上轮没跑完不重叠触发）
 */

export const PAUSE_THRESHOLD = 3;

export type MissedWindowPolicy = "skip" | "catch_up";

export interface UserCronSpec extends JsonObject {
  id: string;
  user_id: string;
  cron_expr: string;
  task: string;
  allowed_tools?: string[];
  max_steps?: number;
  total_timeout_ms?: number;
  missed_window?: MissedWindowPolicy;
  created_at: string;
  updated_at: string;
  enabled: boolean;
  /** runtime state；不让用户直接传，由 runner 维护 */
  state?: UserCronState;
}

export interface UserCronState extends JsonObject {
  last_run_at?: string;
  last_status?: "ok" | "failed" | "skipped_overlap";
  last_summary?: string;
  consecutive_failures?: number;
  paused?: boolean;
  running?: boolean;
  /** 用于 catch_up：spec 创建后或上次 runner 看到的最远 due 时间，重启时从这里往后扫 */
  last_seen_window?: string;
}

export interface CronHistoryEntry extends JsonObject {
  spec_id: string;
  started_at: string;
  finished_at: string;
  status: "ok" | "failed" | "skipped_overlap";
  duration_ms: number;
  iterations?: number;
  tool_calls_count?: number;
  summary: string;
  error?: string;
}

interface CronStoreFile {
  version: 1;
  updated_at: string;
  specs: UserCronSpec[];
}

export class UserCronStore {
  /** 列出某 workspace 下所有 spec（含 runtime state） */
  async list(workspace: WorkspaceContext): Promise<UserCronSpec[]> {
    const file = await this.readFile(workspace);
    return file.specs.slice();
  }

  async get(workspace: WorkspaceContext, id: string): Promise<UserCronSpec | null> {
    const file = await this.readFile(workspace);
    return file.specs.find((s) => s.id === id) ?? null;
  }

  /**
   * 创建新 spec。校验 cron 表达式合法、必填字段。
   * 返回的 spec.id 由 store 生成，调用方不能指定 id。
   */
  async create(workspace: WorkspaceContext, input: {
    user_id: string;
    cron_expr: string;
    task: string;
    allowed_tools?: string[];
    max_steps?: number;
    total_timeout_ms?: number;
    missed_window?: MissedWindowPolicy;
  }): Promise<UserCronSpec> {
    parseCronExpression(input.cron_expr); // 校验，抛错即拒
    if (!input.task || !input.task.trim()) throw new Error("task is required");
    if (!input.user_id) throw new Error("user_id is required");
    const file = await this.readFile(workspace);
    const now = new Date().toISOString();
    const spec: UserCronSpec = {
      id: `cron_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
      user_id: input.user_id,
      cron_expr: input.cron_expr.trim(),
      task: input.task.trim(),
      allowed_tools: input.allowed_tools,
      max_steps: input.max_steps,
      total_timeout_ms: input.total_timeout_ms,
      missed_window: input.missed_window ?? "skip",
      created_at: now,
      updated_at: now,
      enabled: true,
      state: { last_seen_window: now }
    };
    file.specs.push(spec);
    await this.writeFile(workspace, file);
    return spec;
  }

  /**
   * 删除 spec。校验调用者 user_id 必须匹配 spec.user_id（防越权）。
   * 返回 ok/forbidden/not_found。
   */
  async delete(workspace: WorkspaceContext, id: string, callerUserId: string): Promise<{ ok: boolean; reason?: string }> {
    const file = await this.readFile(workspace);
    const idx = file.specs.findIndex((s) => s.id === id);
    if (idx < 0) return { ok: false, reason: "not_found" };
    if (file.specs[idx].user_id !== callerUserId) return { ok: false, reason: "forbidden" };
    file.specs.splice(idx, 1);
    await this.writeFile(workspace, file);
    return { ok: true };
  }

  /** 用 patch 更新 spec 的可变字段（cron_expr / task / allowed_tools / enabled / max_steps）。校验 user_id 同 delete。 */
  async update(workspace: WorkspaceContext, id: string, callerUserId: string, patch: Partial<Pick<UserCronSpec, "cron_expr" | "task" | "allowed_tools" | "max_steps" | "total_timeout_ms" | "missed_window" | "enabled">>): Promise<{ ok: boolean; reason?: string; spec?: UserCronSpec }> {
    const file = await this.readFile(workspace);
    const spec = file.specs.find((s) => s.id === id);
    if (!spec) return { ok: false, reason: "not_found" };
    if (spec.user_id !== callerUserId) return { ok: false, reason: "forbidden" };
    if (patch.cron_expr !== undefined) {
      parseCronExpression(patch.cron_expr);
      spec.cron_expr = patch.cron_expr.trim();
    }
    if (patch.task !== undefined) spec.task = patch.task.trim();
    if (patch.allowed_tools !== undefined) spec.allowed_tools = patch.allowed_tools;
    if (patch.max_steps !== undefined) spec.max_steps = patch.max_steps;
    if (patch.total_timeout_ms !== undefined) spec.total_timeout_ms = patch.total_timeout_ms;
    if (patch.missed_window !== undefined) spec.missed_window = patch.missed_window;
    if (patch.enabled !== undefined) spec.enabled = patch.enabled;
    spec.updated_at = new Date().toISOString();
    await this.writeFile(workspace, file);
    return { ok: true, spec };
  }

  /**
   * 内部 API：runner 在跑前/跑后调用，写 runtime state。
   * mergeState 不暴露给用户工具——用户工具用 update。
   */
  async mergeState(workspace: WorkspaceContext, id: string, patch: Partial<UserCronState>): Promise<UserCronSpec | null> {
    const file = await this.readFile(workspace);
    const spec = file.specs.find((s) => s.id === id);
    if (!spec) return null;
    spec.state = { ...(spec.state ?? {}), ...patch };
    await this.writeFile(workspace, file);
    return spec;
  }

  /** 手动恢复被自动暂停的 cron。校验 user_id。 */
  async resume(workspace: WorkspaceContext, id: string, callerUserId: string): Promise<{ ok: boolean; reason?: string }> {
    const file = await this.readFile(workspace);
    const spec = file.specs.find((s) => s.id === id);
    if (!spec) return { ok: false, reason: "not_found" };
    if (spec.user_id !== callerUserId) return { ok: false, reason: "forbidden" };
    spec.state = { ...(spec.state ?? {}), paused: false, consecutive_failures: 0 };
    spec.updated_at = new Date().toISOString();
    await this.writeFile(workspace, file);
    return { ok: true };
  }

  /** 追加一条执行历史。spec 不存在也写——便于 debug。 */
  async appendHistory(workspace: WorkspaceContext, entry: CronHistoryEntry): Promise<void> {
    const dir = safeJoinWorkspace(workspace.root, ".cron", "history");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${entry.spec_id}.jsonl`);
    await appendFile(file, JSON.stringify(entry) + "\n", "utf8");
  }

  /** 读取最近 N 条历史；spec_id 不存在返回 [] */
  async readHistory(workspace: WorkspaceContext, specId: string, limit = 20): Promise<CronHistoryEntry[]> {
    const file = path.join(workspace.root, ".cron", "history", `${specId}.jsonl`);
    if (!existsSync(file)) return [];
    const raw = await readFile(file, "utf8");
    const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
    const tail = lines.slice(-Math.max(1, limit));
    const entries: CronHistoryEntry[] = [];
    for (const line of tail) {
      try {
        entries.push(JSON.parse(line) as CronHistoryEntry);
      } catch {
        // 损坏行跳过
      }
    }
    return entries;
  }

  /**
   * 根据 spec 的 cron_expr 和 last_run_at（或 last_seen_window）判断是否应在 now 触发。
   * 返回 due 时刻（如果应该跑）或 null（不该跑）。
   * 同时考虑 missed_window 策略。
   */
  computeDue(spec: UserCronSpec, now: Date): { due: boolean; dueAt?: Date; reason?: string } {
    if (!spec.enabled) return { due: false, reason: "disabled" };
    if (spec.state?.paused) return { due: false, reason: "paused" };
    if (spec.state?.running) return { due: false, reason: "running" };
    const expr = parseCronExpression(spec.cron_expr);
    const anchorIso = spec.state?.last_run_at ?? spec.state?.last_seen_window ?? spec.created_at;
    const anchor = new Date(Date.parse(anchorIso));
    if (!Number.isFinite(anchor.getTime())) return { due: false, reason: "invalid_anchor" };
    const next = nextOccurrence(expr, anchor);
    if (!next) return { due: false, reason: "no_future_match" };
    if (next.getTime() > now.getTime()) return { due: false, reason: "not_yet" };
    // 错过窗口（next 已经过去了），按策略：
    //   skip      —— 直接以 now 为新 anchor，下一轮再算（本次不跑）
    //   catch_up  —— 跑一次，dueAt=next
    if (spec.missed_window === "catch_up") {
      return { due: true, dueAt: next };
    }
    return { due: true, dueAt: next };
  }

  private async readFile(workspace: WorkspaceContext): Promise<CronStoreFile> {
    const file = filePath(workspace);
    if (!existsSync(file)) return { version: 1, updated_at: new Date(0).toISOString(), specs: [] };
    try {
      const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<CronStoreFile>;
      return {
        version: 1,
        updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date(0).toISOString(),
        specs: Array.isArray(parsed.specs) ? parsed.specs.filter(isValidSpec) : []
      };
    } catch {
      return { version: 1, updated_at: new Date(0).toISOString(), specs: [] };
    }
  }

  private async writeFile(workspace: WorkspaceContext, file: CronStoreFile): Promise<void> {
    file.updated_at = new Date().toISOString();
    const out = filePath(workspace);
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, JSON.stringify(file, null, 2), "utf8");
  }
}

function filePath(workspace: WorkspaceContext): string {
  return safeJoinWorkspace(workspace.root, ".cron", "jobs.json");
}

function isValidSpec(value: unknown): value is UserCronSpec {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<UserCronSpec>;
  return typeof r.id === "string" && typeof r.user_id === "string" && typeof r.cron_expr === "string" && typeof r.task === "string";
}
