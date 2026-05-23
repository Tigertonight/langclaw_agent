import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { ToolDefinition, ToolExecutionContext } from "../types/agent-contracts.js";
import { inspectEvolution, restoreEvolution, rollbackEvolution } from "./governance.js";
import { MemoryCompactor } from "./memory-compactor.js";
import type { EvolutionRuntime } from "./runtime.js";
import { SkillCurator, toPublicEntry } from "./skill-curator.js";
import { SkillPatchSubagent } from "./skill-patch-subagent.js";
import { EvolutionIterationLoop } from "./iteration-loop.js";
import { ConflictStore, type ConflictStatus } from "../memory/conflict-store.js";
import { defineTool, z, ToolResultBaseSchema } from "../tools/zod-helpers.js";

const ITERATION_TARGET_TYPES = ["skill", "memory", "task", "runtime"] as const;
const SKILL_STATUSES = ["active", "stale", "archived"] as const;
const CONFLICT_STATUSES = ["open", "needs_user_confirmation", "resolved", "ignored"] as const;

const idSchema = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.\-:/]+$/);

export function createEvolutionTools({ evolutionRuntime }: { evolutionRuntime: EvolutionRuntime }): ToolDefinition[] {
  const skillPatchSubagent = new SkillPatchSubagent();
  const memoryCompactor = new MemoryCompactor();
  const conflictStore = new ConflictStore();
  const skillCurator = new SkillCurator();
  const iterationLoop = new EvolutionIterationLoop({ patchSubagent: skillPatchSubagent });
  return [
    defineTool({
      name: "evolution.iteration.list",
      description: "List self-evolution iteration records and their lifecycle status.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      inputSchema: z.object({
        status: z.string().max(64).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        return { ok: true, tool: "evolution.iteration.list", data: { iterations: await iterationLoop.list(getWorkspace(context), args.status) } };
      }
    }),
    defineTool({
      name: "evolution.iteration.propose",
      description: "Create a managed self-evolution proposal. Skill targets can later generate dry-run patches, be approved/applied, observed, and rolled back.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({
        target_type: z.enum(ITERATION_TARGET_TYPES).describe("skill, memory, task, or runtime."),
        target_id: idSchema,
        goal: z.string().min(1).max(1000),
        evidence: z.record(z.string(), z.unknown()).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        return { ok: true, tool: "evolution.iteration.propose", data: { iteration: await iterationLoop.propose(getWorkspace(context), { targetType: args.target_type, targetId: args.target_id, goal: args.goal, evidence: args.evidence }) } };
      }
    }),
    defineTool({
      name: "evolution.iteration.dry_run",
      description: "Generate a dry-run patch for a managed self-evolution iteration.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({ id: idSchema }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        return { ok: true, tool: "evolution.iteration.dry_run", data: { iteration: await iterationLoop.dryRunPatch(getWorkspace(context), args.id) } };
      }
    }),
    defineTool({
      name: "evolution.iteration.run_tests",
      description: "Run selected regression tests for a self-evolution iteration and produce an approval recommendation.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({ id: idSchema }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        return { ok: true, tool: "evolution.iteration.run_tests", data: { iteration: await iterationLoop.runTests(getWorkspace(context), args.id) } };
      }
    }),
    defineTool({
      name: "evolution.iteration.approve_apply",
      description: "Approve and apply the generated patch for a self-evolution iteration.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({ id: idSchema }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        return { ok: true, tool: "evolution.iteration.approve_apply", data: { iteration: await iterationLoop.approveAndApply(getWorkspace(context), args.id, context.user?.id) } };
      }
    }),
    defineTool({
      name: "evolution.iteration.observe",
      description: "Record observation for an applied self-evolution iteration and optionally accept it.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({
        id: idSchema,
        outcome: z.string().min(1).max(1000),
        accepted: z.boolean().optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        return { ok: true, tool: "evolution.iteration.observe", data: { iteration: await iterationLoop.observe(getWorkspace(context), args.id, args.outcome, args.accepted === true) } };
      }
    }),
    defineTool({
      name: "evolution.iteration.rollback",
      description: "Rollback a self-evolution iteration by disabling its evolved target.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({
        id: idSchema,
        reason: z.string().max(1000).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        return { ok: true, tool: "evolution.iteration.rollback", data: { iteration: await iterationLoop.rollback(getWorkspace(context), args.id, args.reason) } };
      }
    }),
    defineTool({
      name: "skill.curator.list",
      description: "List user-scoped agentic skills by lifecycle status, pin state, usage, and patch counters.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      inputSchema: z.object({
        status: z.enum(SKILL_STATUSES).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const entries = skillCurator.list(workspace).filter((entry) => !args.status || entry.status === args.status);
        return {
          ok: true,
          tool: "skill.curator.list",
          data: {
            summary: skillCurator.snapshot(workspace),
            entries: entries.map(toPublicEntry)
          }
        };
      }
    }),
    defineTool({
      name: "skill.curator.pin",
      description: "Pin or unpin a user-scoped skill so TTL refresh keeps it high priority.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({
        skill_id: idSchema,
        pinned: z.boolean().optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        return {
          ok: true,
          tool: "skill.curator.pin",
          data: { entry: toPublicEntry(await skillCurator.pin(workspace, args.skill_id, args.pinned !== false)) }
        };
      }
    }),
    defineTool({
      name: "skill.curator.archive",
      description: "Archive a user-scoped skill so agentic skill listing and injection stop using it.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({
        skill_id: idSchema,
        reason: z.string().max(1000).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        return {
          ok: true,
          tool: "skill.curator.archive",
          data: { entry: toPublicEntry(await skillCurator.archive(workspace, args.skill_id, args.reason)) }
        };
      }
    }),
    defineTool({
      name: "skill.curator.restore",
      description: "Restore an archived skill back into active agentic skill listing.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({ skill_id: idSchema }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        return {
          ok: true,
          tool: "skill.curator.restore",
          data: { entry: toPublicEntry(await skillCurator.restore(workspace, args.skill_id)) }
        };
      }
    }),
    defineTool({
      name: "skill.curator.refresh",
      description: "Apply TTL lifecycle rules to skill curator state, demoting stale low-use skills and archiving expired ones.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({}).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(_args, context) {
        const workspace = getWorkspace(context);
        const result = await skillCurator.refresh(workspace);
        return {
          ok: true,
          tool: "skill.curator.refresh",
          data: {
            updated: result.updated.map(toPublicEntry),
            entries: result.entries.map(toPublicEntry)
          }
        };
      }
    }),
    defineTool({
      name: "evolve",
      description: "Manually trigger the LLM-based user-scoped evolution judge for the current workspace. It may update personal memory, task state, or skill preferences, but never admin policy or org memory.",
      metadata: { required_permissions: [], risk_level: "write", requires_confirmation: false, expose_to_agentic: true },
      inputSchema: z.object({
        reason: z.string().max(1000).optional().describe("Why the user wants to evolve the agent."),
        session_id: idSchema.optional().describe("Optional session id for audit context.")
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context = {}) {
        return executeEvolve(args, context, evolutionRuntime);
      }
    }),
    defineTool({
      name: "evolution.inspect",
      description: "Inspect recent user-scoped evolution log entries and disabled evolution artifacts.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        return {
          ok: true,
          tool: "evolution.inspect",
          data: await inspectEvolution(workspace, args.limit ?? 20)
        };
      }
    }),
    defineTool({
      name: "evolution.rollback",
      description: "Disable an evolution artifact by id/path/key so future runtime code can ignore it. This is a governance safety brake.",
      metadata: { required_permissions: [], risk_level: "write", requires_confirmation: false, expose_to_agentic: true },
      inputSchema: z.object({
        target: z.string().min(1).max(300).describe("Evolution target id, memory key, task id, or skill path to disable."),
        reason: z.string().max(1000).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        return {
          ok: true,
          tool: "evolution.rollback",
          data: await rollbackEvolution(workspace, { target: args.target, reason: args.reason })
        };
      }
    }),
    defineTool({
      name: "evolution.restore",
      description: "Restore a disabled evolution target so it can be injected or applied again.",
      metadata: { required_permissions: [], risk_level: "write", requires_confirmation: false, expose_to_agentic: true },
      inputSchema: z.object({
        target: z.string().min(1).max(300).describe("Disabled target id such as memory:key, task:id, or skill:id."),
        reason: z.string().max(1000).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        return {
          ok: true,
          tool: "evolution.restore",
          data: await restoreEvolution(workspace, { target: args.target, reason: args.reason })
        };
      }
    }),
    defineTool({
      name: "memory.conflict.list",
      description: "List memory contradictions detected by compaction or judge.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      inputSchema: z.object({
        status: z.enum(CONFLICT_STATUSES).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        return { ok: true, tool: "memory.conflict.list", data: { conflicts: await conflictStore.list(workspace, args.status as ConflictStatus | undefined) } };
      }
    }),
    defineTool({
      name: "memory.conflict.resolve",
      description: "Resolve or ignore a memory contradiction.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({
        id: idSchema,
        status: z.enum(CONFLICT_STATUSES),
        resolution: z.string().max(2000).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        return { ok: true, tool: "memory.conflict.resolve", data: { conflict: await conflictStore.resolve(workspace, args.id, args.status as ConflictStatus, args.resolution) } };
      }
    }),
    defineTool({
      name: "memory.conflict.confirm",
      description: "Confirm the desired resolution for a memory contradiction.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({
        id: idSchema,
        resolution: z.string().min(1).max(2000)
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        return { ok: true, tool: "memory.conflict.confirm", data: { conflict: await conflictStore.confirm(workspace, args.id, args.resolution) } };
      }
    }),
    defineTool({
      name: "memory.conflict.ignore",
      description: "Ignore a memory contradiction without changing memory.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      inputSchema: z.object({
        id: idSchema,
        reason: z.string().max(1000).optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        return { ok: true, tool: "memory.conflict.ignore", data: { conflict: await conflictStore.ignore(workspace, args.id, args.reason) } };
      }
    }),
    defineTool({
      name: "evolution.compact",
      description: "Run LLM-only memory compaction over user workspace memory, episodes, and active tasks.",
      metadata: { required_permissions: [], risk_level: "write", requires_confirmation: false, expose_to_agentic: true },
      inputSchema: z.object({
        episode_limit: z.number().int().min(1).max(300).optional(),
        dry_run: z.boolean().optional()
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        try {
          const result = await memoryCompactor.compact(workspace, {
            episodeLimit: args.episode_limit ?? 80,
            dryRun: args.dry_run === true
          });
          return { ok: result.ok, tool: "evolution.compact", data: result };
        } catch (error) {
          return {
            ok: false,
            tool: "evolution.compact",
            error: "compaction_failed",
            message: error instanceof Error ? error.message : String(error)
          };
        }
      }
    }),
    defineTool({
      name: "evolution.skill_patch",
      description: "Run the LLM Skill Patch Subagent to generate a user-scoped .evolution/skills/{skill}/SKILL.md override.",
      metadata: { required_permissions: [], risk_level: "write", requires_confirmation: false, expose_to_agentic: true },
      inputSchema: z.object({
        skill_id: idSchema.describe("Agentic skill id to patch."),
        goal: z.string().min(1).max(1000).describe("What behavior should improve."),
        evidence: z.record(z.string(), z.unknown()).optional(),
        dry_run: z.boolean().optional().describe("Default true. When true, only writes candidate.SKILL.md and patch.md.")
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const result = await skillPatchSubagent.generate({ workspace, skillId: args.skill_id, goal: args.goal, evidence: args.evidence, dryRun: args.dry_run !== false });
        return { ok: result.ok === true, tool: "evolution.skill_patch", data: result };
      }
    }),
    defineTool({
      name: "evolution.skill_patch.apply",
      description: "Apply a previously generated user-scoped skill patch candidate.",
      metadata: { required_permissions: [], risk_level: "write", requires_confirmation: false, expose_to_agentic: true },
      inputSchema: z.object({
        skill_id: idSchema.describe("Agentic skill id whose candidate should be applied.")
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const result = await skillPatchSubagent.apply({ workspace, skillId: args.skill_id, approvedBy: context.user?.id });
        return { ok: result.ok === true, tool: "evolution.skill_patch.apply", data: result };
      }
    }),
    defineTool({
      name: "evolution.skill_patch.approve",
      description: "Approve a generated user-scoped skill patch candidate before applying it.",
      metadata: { required_permissions: [], risk_level: "write", requires_confirmation: false, expose_to_agentic: true },
      inputSchema: z.object({
        skill_id: idSchema.describe("Agentic skill id whose candidate should be approved.")
      }).strict(),
      outputSchema: ToolResultBaseSchema,
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const result = await skillPatchSubagent.approve({ workspace, skillId: args.skill_id, approvedBy: context.user?.id });
        return { ok: result.ok === true, tool: "evolution.skill_patch.approve", data: result };
      }
    })
  ];
}

interface EvolveArgs {
  reason?: string;
  session_id?: string;
}

async function executeEvolve(args: EvolveArgs, context: ToolExecutionContext, evolutionRuntime: EvolutionRuntime) {
  const user = context.user;
  if (!user) {
    return { ok: false, tool: "evolve", error: "missing_user", message: "evolve requires user context." };
  }
  const workspace = getWorkspace(context);
  const result = await evolutionRuntime.reviewTurn({
    trigger: "manual",
    user,
    workspace,
    sessionId: args.session_id ?? `${user.id}:manual`,
    message: args.reason ?? "用户手动触发 evolve。",
    answer: "Manual evolve trigger.",
    route: { intent_code: "tool.evolve" },
    toolPlan: { calls: [{ name: "evolve", args: JSON.parse(JSON.stringify(args)) }] },
    toolResults: []
  });
  return {
    ok: result.status === "applied" || result.status === "skipped" || result.status === "rejected",
    tool: "evolve",
    data: result
  };
}

function getWorkspace(context: ToolExecutionContext = {}): WorkspaceContext {
  const workspace = context.workspace;
  if (workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof (workspace as { root?: unknown }).root === "string") {
    return workspace as WorkspaceContext;
  }
  return resolveUserWorkspace(context.user?.id ?? "anonymous");
}
