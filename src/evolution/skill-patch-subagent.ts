import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { applyPromptCache } from "../llm/prompt-cache.js";
import { resolveProjectPath } from "../data/load-json.js";
import { safeJoinWorkspace, safeUserId, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject } from "../types/agent-contracts.js";
import { SkillCurator } from "./skill-curator.js";

const DEFAULT_TIMEOUT_MS = 30000;

export class SkillPatchSubagent {
  private readonly curator = new SkillCurator();

  async generate(input: {
    workspace: WorkspaceContext;
    skillId: string;
    goal: string;
    evidence?: unknown;
    dryRun?: boolean;
  }): Promise<JsonObject> {
    const skillId = safeUserId(input.skillId);
    const goal = input.goal.trim();
    if (!skillId || !goal) return { ok: false, error: "missing_input" };
    const apiKey = process.env.EVOLUTION_LLM_API_KEY
      ?? process.env.LLM_DECISION_API_KEY
      ?? process.env.LLM_API_KEY
      ?? process.env.OPENAI_API_KEY;
    // Gap-6：无 LLM Key 时模板降级（Phase 6 完善）
    // 不再直接报错，而是生成一个基于原始 SKILL.md + goal 注释的模板 candidate，
    // 让用户可以在不配置 LLM 的情况下手动编辑后 approve + apply。
    if (!apiKey) {
      return this.generateFromTemplate(input.workspace, skillId, goal, input.evidence, input.dryRun);
    }

    const baseUrl = (process.env.EVOLUTION_LLM_BASE_URL
      ?? process.env.LLM_DECISION_BASE_URL
      ?? process.env.LLM_BASE_URL
      ?? process.env.OPENAI_BASE_URL
      ?? "https://api.minimaxi.com/v1").replace(/\/$/, "");
    const model = process.env.EVOLUTION_LLM_MODEL
      ?? process.env.LLM_DECISION_MODEL
      ?? process.env.LLM_MODEL
      ?? process.env.OPENAI_MODEL
      ?? "MiniMax-M2.7";
    const body = {
      model,
      messages: [
        { role: "system", content: PATCH_SUBAGENT_PROMPT },
        { role: "user", content: JSON.stringify(await this.createPayload(input.workspace, skillId, goal, input.evidence)) }
      ],
      temperature: 0,
      stream: false,
      response_format: { type: "json_object" }
    };
    applyPromptCache(body, { baseUrl, model, scope: "evolution.skill_patch" });

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(readPositiveNumberEnv("EVOLUTION_LLM_TIMEOUT_MS", DEFAULT_TIMEOUT_MS)),
      body: JSON.stringify(body)
    });
    if (!response.ok) return { ok: false, error: `patch_subagent_unavailable:http_${response.status}` };
    const json = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    const content = json.choices?.[0]?.message?.content;
    if (!content) return { ok: false, error: "patch_subagent_unavailable:empty_content" };
    const parsed = JSON.parse(content) as { skill_md?: unknown; reason?: unknown };
    if (typeof parsed.skill_md !== "string" || !parsed.skill_md.trim()) {
      return { ok: false, error: "invalid_patch", raw: content.slice(0, 1000) };
    }
    const validation = validateSkillPatch(parsed.skill_md);
    if (!validation.ok) {
      return {
        ok: false,
        error: "patch_policy_rejected",
        violations: validation.violations
      };
    }
    const dir = safeJoinWorkspace(input.workspace.root, ".evolution", "skills", skillId);
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, "SKILL.md");
    const candidate = path.join(dir, "candidate.SKILL.md");
    const patch = path.join(dir, "patch.md");
    await writeFile(input.dryRun === false ? target : candidate, parsed.skill_md.trim() + "\n", "utf8");
    await writeApproval(dir, {
      skill_id: skillId,
      status: input.dryRun === false ? "applied" : "pending",
      generated_at: new Date().toISOString(),
      goal,
      reason: typeof parsed.reason === "string" ? parsed.reason : "generated_by_skill_patch_subagent",
      test_commands: selectSkillPatchTests(skillId)
    });
    await writeFile(patch, createPatchReport({
      skillId,
      goal,
      reason: typeof parsed.reason === "string" ? parsed.reason : "generated_by_skill_patch_subagent",
      before: await readFirstExisting([target]),
      after: parsed.skill_md.trim()
    }), "utf8");
    await this.curator.recordUsage(input.workspace, skillId, "patched");
    return {
      ok: true,
      skill_id: skillId,
      dry_run: input.dryRun !== false,
      path: path.relative(input.workspace.root, input.dryRun === false ? target : candidate),
      patch_path: path.relative(input.workspace.root, patch),
      validation,
      test_commands: selectSkillPatchTests(skillId),
      reason: typeof parsed.reason === "string" ? parsed.reason : "generated_by_skill_patch_subagent"
    };
  }

  async apply(input: { workspace: WorkspaceContext; skillId: string; approvedBy?: string }): Promise<JsonObject> {
    const skillId = safeUserId(input.skillId);
    const dir = safeJoinWorkspace(input.workspace.root, ".evolution", "skills", skillId);
    const target = path.join(dir, "SKILL.md");
    const candidate = path.join(dir, "candidate.SKILL.md");
    if (!existsSync(candidate)) return { ok: false, error: "candidate_missing" };
    const approval = await readApproval(dir);
    if (approval?.status !== "approved") return { ok: false, error: "patch_not_approved", approval_status: typeof approval?.status === "string" ? approval.status : "missing" };
    const candidateText = await readFile(candidate, "utf8");
    const validation = validateSkillPatch(candidateText);
    if (!validation.ok) return { ok: false, error: "patch_policy_rejected", violations: validation.violations };
    if (existsSync(target)) {
      await copyFile(target, path.join(dir, `SKILL.${Date.now()}.bak.md`));
    }
    await rename(candidate, target);
    await writeApproval(dir, {
      ...approval,
      status: "applied",
      approved_by: input.approvedBy ?? approval.approved_by,
      applied_at: new Date().toISOString()
    });
    await this.curator.recordUsage(input.workspace, skillId, "patched");
    return {
      ok: true,
      skill_id: skillId,
      path: path.relative(input.workspace.root, target),
      validation
    };
  }

  /**
   * rollback() — 真正回滚 SKILL.md：从 bak 文件恢复旧版，并更新 approval 记录。
   *
   * apply() 时会把当前 SKILL.md 备份为 `SKILL.{timestamp}.bak.md`，
   * rollback() 找最新（或指定版本）的 bak 文件恢复，实现真正的文件级回滚。
   * 若不存在 bak 文件，则删除 evolution 覆盖（恢复为项目原始 SKILL.md）。
   */
  async rollback(input: { workspace: WorkspaceContext; skillId: string; version?: string; reason?: string }): Promise<JsonObject> {
    const skillId = safeUserId(input.skillId);
    const dir = safeJoinWorkspace(input.workspace.root, ".evolution", "skills", skillId);
    const target = path.join(dir, "SKILL.md");

    if (!existsSync(dir)) {
      return { ok: false, error: "no_evolution_dir", message: `skill ${skillId} 没有 evolution 目录，无需回滚` };
    }

    // 找所有 bak 文件（SKILL.{timestamp}.bak.md）
    const { readdir, unlink } = await import("node:fs/promises");
    const files = existsSync(dir) ? await readdir(dir) : [];
    const baks = files
      .filter((f) => /^SKILL\.\d+\.bak\.md$/.test(f))
      .sort()  // 字典序 = 时间戳升序
      .reverse();  // 最新在前

    let bakFile: string | null = null;
    if (input.version) {
      const matched = baks.find((f) => f.includes(input.version!));
      bakFile = matched ? path.join(dir, matched) : null;
    } else {
      bakFile = baks.length > 0 ? path.join(dir, baks[0]) : null;
    }

    if (!bakFile) {
      // 无 bak：删除 evolution SKILL.md，让系统回退到项目原始版本
      if (existsSync(target)) {
        await unlink(target);
      }
      const approval = await readApproval(dir);
      await writeApproval(dir, {
        ...(approval ?? {}),
        skill_id: skillId,
        status: "rolled_back",
        rolled_back_at: new Date().toISOString(),
        rolled_back_reason: input.reason ?? "no_bak_available_removed_evolution_override",
        from_bak: null
      });
      return {
        ok: true,
        skill_id: skillId,
        rolled_back_to: "project_original",
        message: "evolution override 已移除，系统将使用项目原始 SKILL.md"
      };
    }

    // 恢复 bak → SKILL.md
    await copyFile(bakFile, target);
    const approval = await readApproval(dir);
    await writeApproval(dir, {
      ...(approval ?? {}),
      skill_id: skillId,
      status: "rolled_back",
      rolled_back_at: new Date().toISOString(),
      rolled_back_reason: input.reason ?? "user_requested_rollback",
      from_bak: path.basename(bakFile)
    });
    return {
      ok: true,
      skill_id: skillId,
      rolled_back_to: path.basename(bakFile),
      path: path.relative(input.workspace.root, target)
    };
  }

  async approve(input: { workspace: WorkspaceContext; skillId: string; approvedBy?: string }): Promise<JsonObject> {
    const skillId = safeUserId(input.skillId);
    const dir = safeJoinWorkspace(input.workspace.root, ".evolution", "skills", skillId);
    const candidate = path.join(dir, "candidate.SKILL.md");
    if (!existsSync(candidate)) return { ok: false, error: "candidate_missing" };
    const validation = validateSkillPatch(await readFile(candidate, "utf8"));
    if (!validation.ok) return { ok: false, error: "patch_policy_rejected", violations: validation.violations };
    const approval = await readApproval(dir);
    const next = {
      ...(approval ?? {}),
      skill_id: skillId,
      status: "approved",
      approved_by: input.approvedBy ?? "user",
      approved_at: new Date().toISOString(),
      test_commands: selectSkillPatchTests(skillId)
    };
    await writeApproval(dir, next);
    await this.curator.recordUsage(input.workspace, skillId, "viewed");
    return { ok: true, skill_id: skillId, approval: next, validation };
  }

  /**
   * generateFromTemplate() —— 无 LLM Key 时的模板降级路径（Gap-6 / Phase 6 完善）。
   *
   * 行为：
   * 1. 读取当前 SKILL.md（优先 evolution override，其次 project 原始版）。
   * 2. 在文件头插入 `<!-- EVOLUTION_GOAL -->` 注释块，告知手动编辑者需要改什么。
   * 3. 把结果写入 `candidate.SKILL.md`（或 dry_run=false 时直接写 SKILL.md）。
   * 4. approval.json 状态标为 `"template_pending"`，提示用户需要手动编辑后再 approve。
   * 5. 返回带 `template_fallback: true` 标志的结果，调用方可据此提示用户。
   */
  private async generateFromTemplate(
    workspace: WorkspaceContext,
    skillId: string,
    goal: string,
    evidence: unknown,
    dryRun?: boolean
  ): Promise<JsonObject> {
    const dir = safeJoinWorkspace(workspace.root, ".evolution", "skills", skillId);
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, "SKILL.md");
    const candidate = path.join(dir, "candidate.SKILL.md");
    const patch = path.join(dir, "patch.md");

    // 读取现有 SKILL.md（evolution override 优先，否则 project 原始）
    const evolvedPath = target;
    const basePath = resolveProjectPath("skills", "agentic", skillId, "SKILL.md");
    const existing = await readFirstExisting([evolvedPath, basePath]);

    // 构造模板：在头部注入 evolution goal 注释，提示手动编辑
    const evidenceSummary = evidence
      ? `Evidence:\n${JSON.stringify(evidence, null, 2).slice(0, 1000)}`
      : "(no evidence provided)";
    const goalComment = [
      `<!-- EVOLUTION_GOAL`,
      `  Generated by: SkillPatchSubagent (template fallback — no LLM key configured)`,
      `  skill_id: ${skillId}`,
      `  goal: ${goal}`,
      `  generated_at: ${new Date().toISOString()}`,
      `  ${evidenceSummary.split("\n").join("\n  ")}`,
      ``,
      `  ACTION REQUIRED: Review and edit the SKILL.md below to achieve the goal above.`,
      `  Then run: evolution.skill_patch.approve skill_id=${skillId}`,
      `            evolution.skill_patch.apply    skill_id=${skillId}`,
      `-->`,
      ``
    ].join("\n");

    const templateMd = existing
      ? goalComment + existing
      : goalComment + buildMinimalSkillTemplate(skillId, goal);

    const writeDest = dryRun === false ? target : candidate;
    await writeFile(writeDest, templateMd, "utf8");

    const reason = "template_fallback_no_llm_key";
    await writeApproval(dir, {
      skill_id: skillId,
      status: "template_pending",
      generated_at: new Date().toISOString(),
      goal,
      reason,
      template_fallback: true,
      test_commands: selectSkillPatchTests(skillId),
      instructions: "Edit candidate.SKILL.md, then call evolution.skill_patch.approve + apply."
    });
    await writeFile(patch, createPatchReport({
      skillId,
      goal,
      reason,
      before: existing,
      after: templateMd
    }), "utf8");

    await this.curator.recordUsage(workspace, skillId, "patched");
    return {
      ok: true,
      skill_id: skillId,
      dry_run: dryRun !== false,
      template_fallback: true,
      path: path.relative(workspace.root, writeDest),
      patch_path: path.relative(workspace.root, patch),
      reason,
      message: [
        "LLM Key 未配置，已生成基于现有 SKILL.md 的模板 candidate。",
        "请手动编辑该文件完成目标：" + goal,
        "编辑完成后执行：evolution.skill_patch.approve → evolution.skill_patch.apply"
      ].join(" "),
      test_commands: selectSkillPatchTests(skillId)
    };
  }

  private async createPayload(workspace: WorkspaceContext, skillId: string, goal: string, evidence: unknown): Promise<JsonObject> {
    const evolved = safeJoinWorkspace(workspace.root, ".evolution", "skills", skillId, "SKILL.md");
    const base = resolveProjectPath("skills", "agentic", skillId, "SKILL.md");
    return {
      workspace_user_id: workspace.user_id,
      skill_id: skillId,
      goal,
      evidence: sanitizeEvidence(evidence),
      current_skill_md: await readFirstExisting([evolved, base]),
      output_contract: {
        reason: "short explanation",
        skill_md: "complete SKILL.md with frontmatter name and description"
      }
    };
  }
}

export function selectSkillPatchTests(skillId: string): string[] {
  const tests = ["npm run typecheck", "npm run memory:evolution-stack"];
  if (skillId.includes("task")) tests.push("npm run task:smoke");
  if (skillId.includes("evolution") || skillId.includes("memory")) tests.push("npm run evolution:smoke");
  return Array.from(new Set(tests));
}

export function validateSkillPatch(skillMd: string): { ok: boolean; violations: string[] } {
  const violations: string[] = [];
  if (!/^---\n[\s\S]*?\n---/m.test(skillMd)) violations.push("missing_frontmatter");
  if (!/^name:\s*[-_a-zA-Z0-9]+/m.test(skillMd)) violations.push("missing_name");
  if (!/^description:\s*.+/m.test(skillMd)) violations.push("missing_description");
  const forbidden = [
    { id: "permission_bypass", pattern: /绕过权限|忽略权限|disable permission|bypass permission|ignore permission/i },
    { id: "admin_policy_override", pattern: /修改.*(系统|权限|策略|policy|admin)|override.*(system|policy|permission)/i },
    { id: "secret_collection", pattern: /记录.*(密码|密钥|token|secret|银行卡|身份证)|store.*(password|secret|token)/i },
    { id: "global_skill_mutation", pattern: /全局.*skill|global skill|修改全局/i }
  ];
  for (const item of forbidden) {
    if (item.pattern.test(skillMd)) violations.push(item.id);
  }
  return { ok: violations.length === 0, violations };
}

function createPatchReport(input: { skillId: string; goal: string; reason: string; before: string; after: string }): string {
  return [
    `# Skill Patch Candidate`,
    ``,
    `- skill_id: ${input.skillId}`,
    `- goal: ${input.goal}`,
    `- reason: ${input.reason}`,
    `- generated_at: ${new Date().toISOString()}`,
    ``,
    `## Before`,
    "```md",
    input.before.slice(0, 6000),
    "```",
    ``,
    `## After`,
    "```md",
    input.after.slice(0, 6000),
    "```"
  ].join("\n");
}

async function writeApproval(dir: string, value: Record<string, unknown>): Promise<void> {
  await writeFile(path.join(dir, "approval.json"), JSON.stringify(value, null, 2), "utf8");
}

async function readApproval(dir: string): Promise<Record<string, unknown> | null> {
  const file = path.join(dir, "approval.json");
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readFirstExisting(files: string[]): Promise<string> {
  for (const file of files) {
    if (existsSync(file)) return (await readFile(file, "utf8")).slice(0, 12000);
  }
  return "";
}

function sanitizeEvidence(value: unknown): JsonObject {
  if (!value) return {};
  try {
    return JSON.parse(JSON.stringify(value).slice(0, 12000)) as JsonObject;
  } catch {
    return { value: String(value).slice(0, 12000) };
  }
}

function readPositiveNumberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 当 skill 没有任何现有 SKILL.md 时生成最小骨架模板 */
function buildMinimalSkillTemplate(skillId: string, goal: string): string {
  return [
    `---`,
    `name: ${skillId}`,
    `description: [TODO] ${goal}`,
    `version: 0.1.0-template`,
    `---`,
    ``,
    `# ${skillId}`,
    ``,
    `> **NOTE**: This is a minimal template generated by SkillPatchSubagent (no-LLM fallback).`,
    `> Edit this file to implement the evolution goal described in the comment above.`,
    ``,
    `## Overview`,
    ``,
    `[TODO] Describe the skill behavior and scope.`,
    ``,
    `## Instructions`,
    ``,
    `[TODO] Write the skill instructions / prompt here.`,
    ``,
    `## Examples`,
    ``,
    `[TODO] Add at least 2 input→output examples.`,
    ``
  ].join("\n");
}

const PATCH_SUBAGENT_PROMPT = [
  "You are a user-scoped Skill Patch Subagent.",
  "Generate a complete replacement SKILL.md for one agentic skill based on the user's evolution goal and evidence.",
  "Only produce user-scoped skill behavior. Never grant permissions, modify admin policy, bypass tools, or reference global system changes.",
  "Keep the frontmatter valid and include name plus description. Preserve useful existing behavior unless the evidence clearly calls for a change.",
  "Return only JSON with keys reason and skill_md."
].join("\n");
