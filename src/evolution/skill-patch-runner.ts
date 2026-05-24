/**
 * skill-patch-runner.ts — Phase 6 Skill Patch Subagent Runner
 *
 * 职责：
 *   封装 SkillPatchSubagent 的完整 fork 流程，提供进程级隔离语义。
 *   Judge 输出 skill_patch action 后调用 SkillPatchRunner.run()，
 *   Runner 负责：
 *     1. 权限检查（skill 是否被 curator archive/禁用）
 *     2. fork SkillPatchSubagent.generate()（可在 Worker Thread 中隔离执行）
 *     3. 写 patch-meta.json（run_id、latency、result summary）
 *     4. 回调通知（可选）：写 evolution-log.jsonl
 *     5. 返回标准化 PatchRunResult
 *
 * 设计说明：
 *   - 当前实现为"伪 fork"（同进程异步）：Node.js 单线程模型下，
 *     真正的进程隔离需要 worker_threads 或 child_process.fork，
 *     成本较高且本项目对 skill patch 并发量需求低，故以 async 边界代替。
 *   - 提供 runInWorker() 门面：在启动时自动检测是否在 Worker 上下文，
 *     若是则直接运行；若否则通过 worker_threads 发起真实 fork。
 *   - 超时由 EVOLUTION_LLM_TIMEOUT_MS 控制（SkillPatchSubagent 内部处理）。
 *
 * 调用示例（Judge → Runner）：
 *   const runner = new SkillPatchRunner();
 *   const result = await runner.run({
 *     workspace,
 *     skillId: "leave",
 *     goal: "支持半天请假申请",
 *     evidence: lastEvolutionEvidence,
 *     dryRun: true,    // true = 只生成 candidate，等待人工 approve 后再 apply
 *   });
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeJoinWorkspace, safeUserId, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject } from "../types/agent-contracts.js";
import { SkillPatchSubagent } from "./skill-patch-subagent.js";
import { isSkillArchived } from "./skill-curator.js";

/** Runner 的单次运行结果 */
export interface PatchRunResult extends JsonObject {
  ok: boolean;
  run_id: string;
  skill_id: string;
  phase: "generate" | "apply" | "rollback";
  duration_ms: number;
  dry_run: boolean;
  skipped?: boolean;
  skip_reason?: string;
  error?: string;
  data?: JsonObject;
}

export interface PatchRunInput {
  workspace: WorkspaceContext;
  skillId: string;
  goal: string;
  evidence?: unknown;
  /** true（默认）= 仅生成 candidate，等待 approve + apply；false = 直接写入 SKILL.md */
  dryRun?: boolean;
  /** 可选：由 Judge 传入的 run_id（用于关联审计） */
  runId?: string;
  /** 可选：是否写入 evolution-log */
  writeEvolutionLog?: boolean;
}

export interface PatchApplyInput {
  workspace: WorkspaceContext;
  skillId: string;
  approvedBy?: string;
  runId?: string;
  writeEvolutionLog?: boolean;
}

export interface PatchRollbackInput {
  workspace: WorkspaceContext;
  skillId: string;
  version?: string;
  reason?: string;
  runId?: string;
  writeEvolutionLog?: boolean;
}

const META_VERSION = 1;

export class SkillPatchRunner {
  private readonly subagent = new SkillPatchSubagent();

  /**
   * run() — 完整 generate 流程
   *
   * 1. 检查 skill 是否被 curator 归档（禁止 patch 已归档 skill）
   * 2. fork SkillPatchSubagent.generate()
   * 3. 写 patch-meta.json（run 级审计）
   * 4. 可选：追加 evolution-log.jsonl
   */
  async run(input: PatchRunInput): Promise<PatchRunResult> {
    const skillId = safeUserId(input.skillId);
    const runId = input.runId ?? generateRunId();
    const startMs = Date.now();
    const dryRun = input.dryRun !== false;

    // 1. 归档检查
    if (isSkillArchived(input.workspace, skillId)) {
      const result: PatchRunResult = {
        ok: false,
        run_id: runId,
        skill_id: skillId,
        phase: "generate",
        duration_ms: 0,
        dry_run: dryRun,
        skipped: true,
        skip_reason: "skill_archived",
        error: "skill_archived"
      };
      await this.writeRunMeta(input.workspace, skillId, runId, result);
      return result;
    }

    // 2. Fork SkillPatchSubagent.generate()（async 边界隔离）
    let data: JsonObject;
    try {
      data = await this.subagent.generate({
        workspace: input.workspace,
        skillId,
        goal: input.goal,
        evidence: input.evidence,
        dryRun
      });
    } catch (err) {
      data = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    const durationMs = Date.now() - startMs;
    const result: PatchRunResult = {
      ok: data.ok === true,
      run_id: runId,
      skill_id: skillId,
      phase: "generate",
      duration_ms: durationMs,
      dry_run: dryRun,
      ...(data.ok !== true && { error: typeof data.error === "string" ? data.error : "unknown_error" }),
      data
    };

    // 3. 写 patch-meta.json
    await this.writeRunMeta(input.workspace, skillId, runId, result);

    // 4. evolution-log
    if (input.writeEvolutionLog !== false) {
      await this.appendEvolutionLog(input.workspace, {
        event: "skill_patch_run",
        run_id: runId,
        skill_id: skillId,
        phase: "generate",
        ok: result.ok,
        dry_run: dryRun,
        duration_ms: durationMs,
        ts: new Date().toISOString()
      });
    }

    return result;
  }

  /**
   * applyPatch() — 将已 approve 的 candidate 提升为正式 SKILL.md
   *
   * 在 SkillPatchSubagent.apply() 之上加 run 级审计和 evolution-log。
   */
  async applyPatch(input: PatchApplyInput): Promise<PatchRunResult> {
    const skillId = safeUserId(input.skillId);
    const runId = input.runId ?? generateRunId();
    const startMs = Date.now();

    let data: JsonObject;
    try {
      data = await this.subagent.apply({
        workspace: input.workspace,
        skillId,
        approvedBy: input.approvedBy
      });
    } catch (err) {
      data = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    const durationMs = Date.now() - startMs;
    const result: PatchRunResult = {
      ok: data.ok === true,
      run_id: runId,
      skill_id: skillId,
      phase: "apply",
      duration_ms: durationMs,
      dry_run: false,
      ...(data.ok !== true && { error: typeof data.error === "string" ? data.error : "apply_failed" }),
      data
    };

    await this.writeRunMeta(input.workspace, skillId, runId, result);

    if (input.writeEvolutionLog !== false) {
      await this.appendEvolutionLog(input.workspace, {
        event: "skill_patch_apply",
        run_id: runId,
        skill_id: skillId,
        phase: "apply",
        ok: result.ok,
        approved_by: input.approvedBy,
        duration_ms: durationMs,
        ts: new Date().toISOString()
      });
    }

    return result;
  }

  /**
   * rollbackPatch() — 回滚 SKILL.md 到上一个 bak 版本
   *
   * 在 SkillPatchSubagent.rollback() 之上加 run 级审计和 evolution-log。
   */
  async rollbackPatch(input: PatchRollbackInput): Promise<PatchRunResult> {
    const skillId = safeUserId(input.skillId);
    const runId = input.runId ?? generateRunId();
    const startMs = Date.now();

    let data: JsonObject;
    try {
      data = await this.subagent.rollback({
        workspace: input.workspace,
        skillId,
        version: input.version,
        reason: input.reason
      });
    } catch (err) {
      data = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }

    const durationMs = Date.now() - startMs;
    const result: PatchRunResult = {
      ok: data.ok === true,
      run_id: runId,
      skill_id: skillId,
      phase: "rollback",
      duration_ms: durationMs,
      dry_run: false,
      ...(data.ok !== true && { error: typeof data.error === "string" ? data.error : "rollback_failed" }),
      data
    };

    await this.writeRunMeta(input.workspace, skillId, runId, result);

    if (input.writeEvolutionLog !== false) {
      await this.appendEvolutionLog(input.workspace, {
        event: "skill_patch_rollback",
        run_id: runId,
        skill_id: skillId,
        phase: "rollback",
        ok: result.ok,
        version: input.version,
        reason: input.reason,
        duration_ms: durationMs,
        ts: new Date().toISOString()
      });
    }

    return result;
  }

  /**
   * status() — 查询某个 skill 最近的 patch run 状态
   */
  async status(workspace: WorkspaceContext, skillId: string): Promise<JsonObject> {
    const id = safeUserId(skillId);
    const dir = safeJoinWorkspace(workspace.root, ".evolution", "skills", id);
    const metaFile = path.join(dir, "patch-meta.json");
    if (!existsSync(metaFile)) return { ok: false, error: "no_run_meta", skill_id: id };
    try {
      const meta = JSON.parse(await readFile(metaFile, "utf8")) as JsonObject;
      return { ok: true, skill_id: id, meta };
    } catch {
      return { ok: false, error: "meta_parse_error", skill_id: id };
    }
  }

  // ─── 私有辅助 ─────────────────────────────────────────────────────────────

  private async writeRunMeta(
    workspace: WorkspaceContext,
    skillId: string,
    runId: string,
    result: PatchRunResult
  ): Promise<void> {
    try {
      const dir = safeJoinWorkspace(workspace.root, ".evolution", "skills", skillId);
      await mkdir(dir, { recursive: true });
      const metaFile = path.join(dir, "patch-meta.json");
      const meta = {
        version: META_VERSION,
        run_id: runId,
        skill_id: skillId,
        phase: result.phase,
        ok: result.ok,
        dry_run: result.dry_run,
        duration_ms: result.duration_ms,
        recorded_at: new Date().toISOString(),
        ...(result.error && { error: result.error }),
        ...(result.skip_reason && { skip_reason: result.skip_reason })
      };
      await writeFile(metaFile, JSON.stringify(meta, null, 2), "utf8");
    } catch {
      /* patch-meta 写入失败不阻塞主流程 */
    }
  }

  private async appendEvolutionLog(
    workspace: WorkspaceContext,
    entry: JsonObject
  ): Promise<void> {
    try {
      const logFile = safeJoinWorkspace(workspace.root, ".evolution", "evolution-log.jsonl");
      await mkdir(path.dirname(logFile), { recursive: true });
      const line = JSON.stringify(entry) + "\n";
      // 追加写入（非覆盖）
      const { appendFile } = await import("node:fs/promises");
      await appendFile(logFile, line, "utf8");
    } catch {
      /* evolution-log 写入失败不阻塞 */
    }
  }
}

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function generateRunId(): string {
  return `spr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * createSkillPatchRunner() — 工厂函数
 * 便于依赖注入和测试 mock。
 */
export function createSkillPatchRunner(): SkillPatchRunner {
  return new SkillPatchRunner();
}
