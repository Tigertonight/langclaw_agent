import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { JsonObject, ToolDefinition, ToolExecutionContext } from "../types/agent-contracts.js";
import { inspectEvolution, restoreEvolution, rollbackEvolution } from "./governance.js";
import { MemoryCompactor } from "./memory-compactor.js";
import type { EvolutionRuntime } from "./runtime.js";
import { SkillCurator, toPublicEntry } from "./skill-curator.js";
import { SkillPatchSubagent } from "./skill-patch-subagent.js";
import { EvolutionIterationLoop } from "./iteration-loop.js";
import { ConflictStore, type ConflictStatus } from "../memory/conflict-store.js";

interface EvolveArgs extends JsonObject {
  reason?: string;
  session_id?: string;
}

export function createEvolutionTools({ evolutionRuntime }: { evolutionRuntime: EvolutionRuntime }): ToolDefinition[] {
  const skillPatchSubagent = new SkillPatchSubagent();
  const memoryCompactor = new MemoryCompactor();
  const conflictStore = new ConflictStore();
  const skillCurator = new SkillCurator();
  const iterationLoop = new EvolutionIterationLoop({ patchSubagent: skillPatchSubagent });
  return [
    {
      name: "evolution.iteration.list",
      description: "List self-evolution iteration records and their lifecycle status.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      schema: { type: "object", properties: { status: { type: "string" } } },
      async execute(args, context) {
        return { ok: true, tool: "evolution.iteration.list", data: { iterations: await iterationLoop.list(getWorkspace(context), typeof args?.status === "string" ? args.status : undefined) } };
      }
    },
    {
      name: "evolution.iteration.propose",
      description: "Create a managed self-evolution proposal. Skill targets can later generate dry-run patches, be approved/applied, observed, and rolled back.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: {
        type: "object",
        properties: {
          target_type: { type: "string", description: "skill, memory, task, or runtime." },
          target_id: { type: "string" },
          goal: { type: "string" },
          evidence: { type: "object" }
        },
        required: ["target_type", "target_id", "goal"]
      },
      async execute(args, context) {
        const targetType = normalizeIterationTargetType(args?.target_type);
        const targetId = typeof args?.target_id === "string" ? args.target_id.trim() : "";
        const goal = typeof args?.goal === "string" ? args.goal.trim() : "";
        if (!targetType || !targetId || !goal) return { ok: false, tool: "evolution.iteration.propose", error: "missing_input" };
        return { ok: true, tool: "evolution.iteration.propose", data: { iteration: await iterationLoop.propose(getWorkspace(context), { targetType, targetId, goal, evidence: args?.evidence }) } };
      }
    },
    {
      name: "evolution.iteration.dry_run",
      description: "Generate a dry-run patch for a managed self-evolution iteration.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      async execute(args, context) {
        const id = typeof args?.id === "string" ? args.id : "";
        if (!id) return { ok: false, tool: "evolution.iteration.dry_run", error: "missing_id" };
        return { ok: true, tool: "evolution.iteration.dry_run", data: { iteration: await iterationLoop.dryRunPatch(getWorkspace(context), id) } };
      }
    },
    {
      name: "evolution.iteration.run_tests",
      description: "Run selected regression tests for a self-evolution iteration and produce an approval recommendation.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      async execute(args, context) {
        const id = typeof args?.id === "string" ? args.id : "";
        if (!id) return { ok: false, tool: "evolution.iteration.run_tests", error: "missing_id" };
        return { ok: true, tool: "evolution.iteration.run_tests", data: { iteration: await iterationLoop.runTests(getWorkspace(context), id) } };
      }
    },
    {
      name: "evolution.iteration.approve_apply",
      description: "Approve and apply the generated patch for a self-evolution iteration.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
      async execute(args, context) {
        const id = typeof args?.id === "string" ? args.id : "";
        if (!id) return { ok: false, tool: "evolution.iteration.approve_apply", error: "missing_id" };
        return { ok: true, tool: "evolution.iteration.approve_apply", data: { iteration: await iterationLoop.approveAndApply(getWorkspace(context), id, context.user?.id) } };
      }
    },
    {
      name: "evolution.iteration.observe",
      description: "Record observation for an applied self-evolution iteration and optionally accept it.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: { type: "object", properties: { id: { type: "string" }, outcome: { type: "string" }, accepted: { type: "boolean" } }, required: ["id", "outcome"] },
      async execute(args, context) {
        const id = typeof args?.id === "string" ? args.id : "";
        const outcome = typeof args?.outcome === "string" ? args.outcome : "";
        if (!id || !outcome) return { ok: false, tool: "evolution.iteration.observe", error: "missing_input" };
        return { ok: true, tool: "evolution.iteration.observe", data: { iteration: await iterationLoop.observe(getWorkspace(context), id, outcome, args?.accepted === true) } };
      }
    },
    {
      name: "evolution.iteration.rollback",
      description: "Rollback a self-evolution iteration by disabling its evolved target.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: { type: "object", properties: { id: { type: "string" }, reason: { type: "string" } }, required: ["id"] },
      async execute(args, context) {
        const id = typeof args?.id === "string" ? args.id : "";
        if (!id) return { ok: false, tool: "evolution.iteration.rollback", error: "missing_id" };
        return { ok: true, tool: "evolution.iteration.rollback", data: { iteration: await iterationLoop.rollback(getWorkspace(context), id, typeof args?.reason === "string" ? args.reason : undefined) } };
      }
    },
    {
      name: "skill.curator.list",
      description: "List user-scoped agentic skills by lifecycle status, pin state, usage, and patch counters.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      schema: {
        type: "object",
        properties: {
          status: { type: "string", description: "Optional status filter: active, stale, archived." }
        }
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const status = normalizeSkillStatus(args?.status);
        const entries = skillCurator.list(workspace).filter((entry) => !status || entry.status === status);
        return {
          ok: true,
          tool: "skill.curator.list",
          data: {
            summary: skillCurator.snapshot(workspace),
            entries: entries.map(toPublicEntry)
          }
        };
      }
    },
    {
      name: "skill.curator.pin",
      description: "Pin or unpin a user-scoped skill so TTL refresh keeps it high priority.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: {
        type: "object",
        properties: {
          skill_id: { type: "string" },
          pinned: { type: "boolean" }
        },
        required: ["skill_id"]
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const skillId = typeof args?.skill_id === "string" ? args.skill_id.trim() : "";
        if (!skillId) return { ok: false, tool: "skill.curator.pin", error: "missing_skill_id" };
        return {
          ok: true,
          tool: "skill.curator.pin",
          data: { entry: toPublicEntry(await skillCurator.pin(workspace, skillId, args?.pinned !== false)) }
        };
      }
    },
    {
      name: "skill.curator.archive",
      description: "Archive a user-scoped skill so agentic skill listing and injection stop using it.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: {
        type: "object",
        properties: {
          skill_id: { type: "string" },
          reason: { type: "string" }
        },
        required: ["skill_id"]
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const skillId = typeof args?.skill_id === "string" ? args.skill_id.trim() : "";
        if (!skillId) return { ok: false, tool: "skill.curator.archive", error: "missing_skill_id" };
        return {
          ok: true,
          tool: "skill.curator.archive",
          data: { entry: toPublicEntry(await skillCurator.archive(workspace, skillId, typeof args?.reason === "string" ? args.reason : undefined)) }
        };
      }
    },
    {
      name: "skill.curator.restore",
      description: "Restore an archived skill back into active agentic skill listing.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: {
        type: "object",
        properties: {
          skill_id: { type: "string" }
        },
        required: ["skill_id"]
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const skillId = typeof args?.skill_id === "string" ? args.skill_id.trim() : "";
        if (!skillId) return { ok: false, tool: "skill.curator.restore", error: "missing_skill_id" };
        return {
          ok: true,
          tool: "skill.curator.restore",
          data: { entry: toPublicEntry(await skillCurator.restore(workspace, skillId)) }
        };
      }
    },
    {
      name: "skill.curator.refresh",
      description: "Apply TTL lifecycle rules to skill curator state, demoting stale low-use skills and archiving expired ones.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: { type: "object", properties: {} },
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
    },
    {
      name: "evolve",
      description: "Manually trigger the LLM-based user-scoped evolution judge for the current workspace. It may update personal memory, task state, or skill preferences, but never admin policy or org memory.",
      metadata: {
        required_permissions: [],
        risk_level: "write",
        requires_confirmation: false,
        expose_to_agentic: true
      },
      schema: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "Why the user wants to evolve the agent."
          },
          session_id: {
            type: "string",
            description: "Optional session id for audit context."
          }
        }
      },
      async execute(args, context) {
        return executeEvolve(args as EvolveArgs | undefined, context, evolutionRuntime);
      }
    },
    {
      name: "evolution.inspect",
      description: "Inspect recent user-scoped evolution log entries and disabled evolution artifacts.",
      metadata: {
        required_permissions: [],
        risk_level: "read",
        expose_to_agentic: true
      },
      schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum recent log entries to return." }
        }
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const limit = Number(args?.limit);
        return {
          ok: true,
          tool: "evolution.inspect",
          data: await inspectEvolution(workspace, Number.isFinite(limit) && limit > 0 ? Math.min(limit, 100) : 20)
        };
      }
    },
    {
      name: "evolution.rollback",
      description: "Disable an evolution artifact by id/path/key so future runtime code can ignore it. This is a governance safety brake.",
      metadata: {
        required_permissions: [],
        risk_level: "write",
        requires_confirmation: false,
        expose_to_agentic: true
      },
      schema: {
        type: "object",
        properties: {
          target: { type: "string", description: "Evolution target id, memory key, task id, or skill path to disable." },
          reason: { type: "string", description: "Why this target should be rolled back." }
        },
        required: ["target"]
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const target = typeof args?.target === "string" ? args.target.trim() : "";
        if (!target) return { ok: false, tool: "evolution.rollback", error: "missing_target", message: "target is required." };
        return {
          ok: true,
          tool: "evolution.rollback",
          data: await rollbackEvolution(workspace, { target, reason: typeof args?.reason === "string" ? args.reason : undefined })
        };
      }
    },
    {
      name: "evolution.restore",
      description: "Restore a disabled evolution target so it can be injected or applied again.",
      metadata: {
        required_permissions: [],
        risk_level: "write",
        requires_confirmation: false,
        expose_to_agentic: true
      },
      schema: {
        type: "object",
        properties: {
          target: { type: "string", description: "Disabled target id such as memory:key, task:id, or skill:id." },
          reason: { type: "string", description: "Why this target should be restored." }
        },
        required: ["target"]
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const target = typeof args?.target === "string" ? args.target.trim() : "";
        if (!target) return { ok: false, tool: "evolution.restore", error: "missing_target", message: "target is required." };
        return {
          ok: true,
          tool: "evolution.restore",
          data: await restoreEvolution(workspace, { target, reason: typeof args?.reason === "string" ? args.reason : undefined })
        };
      }
    },
    {
      name: "memory.conflict.list",
      description: "List memory contradictions detected by compaction or judge.",
      metadata: { required_permissions: [], risk_level: "read", expose_to_agentic: true },
      schema: { type: "object", properties: { status: { type: "string" } } },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const status = normalizeConflictStatus(args?.status);
        return { ok: true, tool: "memory.conflict.list", data: { conflicts: await conflictStore.list(workspace, status) } };
      }
    },
    {
      name: "memory.conflict.resolve",
      description: "Resolve or ignore a memory contradiction.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string" },
          resolution: { type: "string" }
        },
        required: ["id", "status"]
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const id = typeof args?.id === "string" ? args.id : "";
        const status = normalizeConflictStatus(args?.status);
        if (!id || !status) return { ok: false, tool: "memory.conflict.resolve", error: "missing_input" };
        return { ok: true, tool: "memory.conflict.resolve", data: { conflict: await conflictStore.resolve(workspace, id, status, typeof args?.resolution === "string" ? args.resolution : undefined) } };
      }
    },
    {
      name: "memory.conflict.confirm",
      description: "Confirm the desired resolution for a memory contradiction.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          resolution: { type: "string" }
        },
        required: ["id", "resolution"]
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const id = typeof args?.id === "string" ? args.id : "";
        const resolution = typeof args?.resolution === "string" ? args.resolution : "";
        if (!id || !resolution) return { ok: false, tool: "memory.conflict.confirm", error: "missing_input" };
        return { ok: true, tool: "memory.conflict.confirm", data: { conflict: await conflictStore.confirm(workspace, id, resolution) } };
      }
    },
    {
      name: "memory.conflict.ignore",
      description: "Ignore a memory contradiction without changing memory.",
      metadata: { required_permissions: [], risk_level: "write", expose_to_agentic: true },
      schema: {
        type: "object",
        properties: {
          id: { type: "string" },
          reason: { type: "string" }
        },
        required: ["id"]
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const id = typeof args?.id === "string" ? args.id : "";
        if (!id) return { ok: false, tool: "memory.conflict.ignore", error: "missing_id" };
        return { ok: true, tool: "memory.conflict.ignore", data: { conflict: await conflictStore.ignore(workspace, id, typeof args?.reason === "string" ? args.reason : undefined) } };
      }
    },
    {
      name: "evolution.compact",
      description: "Run LLM-only memory compaction over user workspace memory, episodes, and active tasks.",
      metadata: {
        required_permissions: [],
        risk_level: "write",
        requires_confirmation: false,
        expose_to_agentic: true
      },
      schema: {
        type: "object",
        properties: {
          episode_limit: { type: "number", description: "Recent episodes to include." },
          dry_run: { type: "boolean", description: "Write a report without updating memory items." }
        }
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        try {
          const result = await memoryCompactor.compact(workspace, {
            episodeLimit: readLimit(args?.episode_limit, 80),
            dryRun: args?.dry_run === true
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
    },
    {
      name: "evolution.skill_patch",
      description: "Run the LLM Skill Patch Subagent to generate a user-scoped .evolution/skills/{skill}/SKILL.md override.",
      metadata: {
        required_permissions: [],
        risk_level: "write",
        requires_confirmation: false,
        expose_to_agentic: true
      },
      schema: {
        type: "object",
        properties: {
          skill_id: { type: "string", description: "Agentic skill id to patch." },
          goal: { type: "string", description: "What behavior should improve." },
          evidence: { type: "object", description: "Conversation/task evidence for the patch." },
          dry_run: { type: "boolean", description: "Default true. When true, only writes candidate.SKILL.md and patch.md." }
        },
        required: ["skill_id", "goal"]
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const skillId = typeof args?.skill_id === "string" ? args.skill_id.trim() : "";
        const goal = typeof args?.goal === "string" ? args.goal.trim() : "";
        if (!skillId || !goal) return { ok: false, tool: "evolution.skill_patch", error: "missing_input", message: "skill_id and goal are required." };
        const result = await skillPatchSubagent.generate({ workspace, skillId, goal, evidence: args?.evidence, dryRun: args?.dry_run !== false });
        return { ok: result.ok === true, tool: "evolution.skill_patch", data: result };
      }
    },
    {
      name: "evolution.skill_patch.apply",
      description: "Apply a previously generated user-scoped skill patch candidate.",
      metadata: { required_permissions: [], risk_level: "write", requires_confirmation: false, expose_to_agentic: true },
      schema: {
        type: "object",
        properties: {
          skill_id: { type: "string", description: "Agentic skill id whose candidate should be applied." }
        },
        required: ["skill_id"]
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const skillId = typeof args?.skill_id === "string" ? args.skill_id.trim() : "";
        if (!skillId) return { ok: false, tool: "evolution.skill_patch.apply", error: "missing_skill_id" };
        const result = await skillPatchSubagent.apply({ workspace, skillId, approvedBy: context.user?.id });
        return { ok: result.ok === true, tool: "evolution.skill_patch.apply", data: result };
      }
    },
    {
      name: "evolution.skill_patch.approve",
      description: "Approve a generated user-scoped skill patch candidate before applying it.",
      metadata: { required_permissions: [], risk_level: "write", requires_confirmation: false, expose_to_agentic: true },
      schema: {
        type: "object",
        properties: {
          skill_id: { type: "string", description: "Agentic skill id whose candidate should be approved." }
        },
        required: ["skill_id"]
      },
      async execute(args, context) {
        const workspace = getWorkspace(context);
        const skillId = typeof args?.skill_id === "string" ? args.skill_id.trim() : "";
        if (!skillId) return { ok: false, tool: "evolution.skill_patch.approve", error: "missing_skill_id" };
        const result = await skillPatchSubagent.approve({ workspace, skillId, approvedBy: context.user?.id });
        return { ok: result.ok === true, tool: "evolution.skill_patch.approve", data: result };
      }
    }
  ];
}

function normalizeConflictStatus(value: unknown): ConflictStatus | undefined {
  const text = String(value ?? "");
  return ["open", "needs_user_confirmation", "resolved", "ignored"].includes(text) ? text as ConflictStatus : undefined;
}

function normalizeSkillStatus(value: unknown): "active" | "stale" | "archived" | undefined {
  const text = String(value ?? "");
  return text === "active" || text === "stale" || text === "archived" ? text : undefined;
}

function normalizeIterationTargetType(value: unknown): "skill" | "memory" | "task" | "runtime" | undefined {
  const text = String(value ?? "");
  return text === "skill" || text === "memory" || text === "task" || text === "runtime" ? text : undefined;
}

function readLimit(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(number, 300) : fallback;
}

async function executeEvolve(args: EvolveArgs = {}, context: ToolExecutionContext = {}, evolutionRuntime: EvolutionRuntime) {
  const user = context.user;
  if (!user) {
    return { ok: false, tool: "evolve", error: "missing_user", message: "evolve requires user context." };
  }
  const workspace = getWorkspace(context);
  const result = await evolutionRuntime.reviewTurn({
    trigger: "manual",
    user,
    workspace,
    sessionId: typeof args.session_id === "string" ? args.session_id : `${user.id}:manual`,
    message: typeof args.reason === "string" ? args.reason : "用户手动触发 evolve。",
    answer: "Manual evolve trigger.",
    route: { intent_code: "tool.evolve" },
    toolPlan: { calls: [{ name: "evolve", args }] },
    toolResults: []
  });
  return {
    ok: result.status === "applied" || result.status === "skipped" || result.status === "rejected",
    tool: "evolve",
    data: result
  };
}

function getWorkspace(context: ToolExecutionContext): WorkspaceContext {
  const workspace = context.workspace;
  if (workspace && typeof workspace === "object" && !Array.isArray(workspace) && typeof (workspace as { root?: unknown }).root === "string") {
    return workspace as WorkspaceContext;
  }
  return resolveUserWorkspace(context.user?.id ?? "anonymous");
}
