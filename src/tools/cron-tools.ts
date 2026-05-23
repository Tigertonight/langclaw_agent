import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import { UserCronStore, type MissedWindowPolicy } from "../cron/user-cron-store.js";
import { AgentCronJobRunner } from "../cron/agent-job-runner.js";
import type { JsonObject, ToolDefinition, ToolMetadata, UserContext } from "../types/agent-contracts.js";

/**
 * cron.* 工具集 —— 用户/主 agent 通过这些工具管理 cron。
 *
 * 设计取舍：
 *   - 6 个工具：create / list / delete / update / resume / history。少而正交，避免一个胖 cron.manage。
 *   - risk_level：create/delete/update/resume 标 write（用户操作系统状态）；list/history 标 read。
 *   - 全部 expose_to_agentic=true，让主 agent 帮用户管 cron（"提醒我每天 8 点跑库存"这种自然请求能落地）。
 *   - workspace 来源：context.workspace > resolveUserWorkspace(user.id)；强制按 user 隔离。
 *   - user_id 校验：所有写操作传 callerUserId = context.user.id；store 内部验是否匹配 spec.user_id。
 */

export function createCronTools(
  { cronStore, runner }: { cronStore: UserCronStore; runner?: AgentCronJobRunner }
): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    createCronCreateTool(cronStore),
    createCronListTool(cronStore),
    createCronDeleteTool(cronStore),
    createCronUpdateTool(cronStore),
    createCronDisableTool(cronStore),
    createCronEnableTool(cronStore),
    createCronResumeTool(cronStore),
    createCronHistoryTool(cronStore)
  ];
  // run_now 需要 runner；没注入就不挂这个工具，主路径不会拿到一个会爆的 tool。
  if (runner) tools.push(createCronRunNowTool(cronStore, runner));
  return tools;
}

const READ_META: ToolMetadata = {
  required_permissions: [],
  risk_level: "read",
  expose_to_agentic: true,
  source: "cron"
};
const WRITE_META: ToolMetadata = {
  required_permissions: [],
  risk_level: "write",
  expose_to_agentic: true,
  source: "cron"
};

function resolveWorkspace(context: { user?: UserContext; workspace?: unknown } | undefined): { workspace: WorkspaceContext; userId: string } | { error: string } {
  const user = context?.user;
  if (!user?.id) return { error: "missing_user" };
  const workspace = (context?.workspace && typeof context.workspace === "object" && (context.workspace as WorkspaceContext).root)
    ? context.workspace as WorkspaceContext
    : resolveUserWorkspace(user.id);
  return { workspace, userId: user.id };
}

function createCronCreateTool(store: UserCronStore): ToolDefinition {
  return {
    name: "cron.create",
    description: "注册一条 cron 定时任务，到点自动 spawn 子 agent 执行。返回 spec_id。",
    schema: {
      type: "object",
      required: ["cron_expr", "task"],
      properties: {
        cron_expr: { type: "string", description: "5 字段标准 cron：分 时 日 月 周。例：'0 8 * * *' 每天 8 点。" },
        task: { type: "string", description: "子 agent 的目标，越具体越好。" },
        allowed_tools: { type: "array", items: { type: "string" }, description: "可选工具白名单（带命名空间）。不传走主 agent 全集。" },
        max_steps: { type: "number", description: "子 agent 最大循环步数，默认 5。" },
        total_timeout_ms: { type: "number", description: "总时长上限（毫秒），默认 60000。" },
        missed_window: { type: "string", description: "错过窗口策略：skip(默认) 或 catch_up。" }
      }
    },
    metadata: WRITE_META,
    async execute(args, context) {
      const resolved = resolveWorkspace(context);
      if ("error" in resolved) return { ok: false, error: resolved.error, message: "需要 user.id 才能注册 cron" };
      const a = (args ?? {}) as JsonObject;
      try {
        const spec = await store.create(resolved.workspace, {
          user_id: resolved.userId,
          cron_expr: String(a.cron_expr ?? ""),
          task: String(a.task ?? ""),
          allowed_tools: Array.isArray(a.allowed_tools) ? (a.allowed_tools as string[]).filter((s) => typeof s === "string") : undefined,
          max_steps: typeof a.max_steps === "number" ? a.max_steps : undefined,
          total_timeout_ms: typeof a.total_timeout_ms === "number" ? a.total_timeout_ms : undefined,
          missed_window: a.missed_window === "catch_up" ? "catch_up" : a.missed_window === "skip" ? "skip" : undefined
        });
        return {
          ok: true,
          tool: "cron.create",
          data: {
            spec_id: spec.id,
            cron_expr: spec.cron_expr,
            task: spec.task,
            missed_window: spec.missed_window
          }
        };
      } catch (err) {
        return {
          ok: false,
          tool: "cron.create",
          error: "invalid_spec",
          message: err instanceof Error ? err.message : String(err)
        };
      }
    }
  };
}

function createCronListTool(store: UserCronStore): ToolDefinition {
  return {
    name: "cron.list",
    description: "列出当前用户的所有 cron spec（含运行状态：last_run_at / paused / consecutive_failures）。",
    schema: { type: "object", properties: {} },
    metadata: READ_META,
    async execute(_args, context) {
      const resolved = resolveWorkspace(context);
      if ("error" in resolved) return { ok: false, error: resolved.error, message: "需要 user.id" };
      const all = await store.list(resolved.workspace);
      // 只露出 user 自己的（同一 workspace 应该都是同一 user，但保险起见过滤）
      const mine = all.filter((s) => s.user_id === resolved.userId);
      return {
        ok: true,
        tool: "cron.list",
        data: {
          count: mine.length,
          specs: mine.map((s) => ({
            id: s.id,
            cron_expr: s.cron_expr,
            task: s.task,
            enabled: s.enabled,
            paused: s.state?.paused ?? false,
            last_run_at: s.state?.last_run_at ?? null,
            last_status: s.state?.last_status ?? null,
            consecutive_failures: s.state?.consecutive_failures ?? 0
          }))
        }
      };
    }
  };
}

function createCronDeleteTool(store: UserCronStore): ToolDefinition {
  return {
    name: "cron.delete",
    description: "删除一条 cron spec。只能删自己的。",
    schema: {
      type: "object",
      required: ["spec_id"],
      properties: { spec_id: { type: "string", description: "要删除的 spec.id" } }
    },
    metadata: WRITE_META,
    async execute(args, context) {
      const resolved = resolveWorkspace(context);
      if ("error" in resolved) return { ok: false, error: resolved.error };
      const id = String((args as JsonObject)?.spec_id ?? "");
      if (!id) return { ok: false, tool: "cron.delete", error: "missing_spec_id" };
      const result = await store.delete(resolved.workspace, id, resolved.userId);
      return result.ok
        ? { ok: true, tool: "cron.delete", data: { spec_id: id } }
        : { ok: false, tool: "cron.delete", error: result.reason ?? "delete_failed" };
    }
  };
}

function createCronUpdateTool(store: UserCronStore): ToolDefinition {
  return {
    name: "cron.update",
    description: "更新 cron spec 的可变字段：cron_expr / task / allowed_tools / max_steps / enabled / missed_window。只能改自己的。",
    schema: {
      type: "object",
      required: ["spec_id"],
      properties: {
        spec_id: { type: "string", description: "要更新的 spec.id" },
        cron_expr: { type: "string", description: "新的 cron 表达式" },
        task: { type: "string", description: "新的任务目标" },
        allowed_tools: { type: "array", items: { type: "string" } },
        max_steps: { type: "number" },
        total_timeout_ms: { type: "number" },
        enabled: { type: "boolean" },
        missed_window: { type: "string", description: "skip / catch_up" }
      }
    },
    metadata: WRITE_META,
    async execute(args, context) {
      const resolved = resolveWorkspace(context);
      if ("error" in resolved) return { ok: false, error: resolved.error };
      const a = (args ?? {}) as JsonObject;
      const id = String(a.spec_id ?? "");
      if (!id) return { ok: false, tool: "cron.update", error: "missing_spec_id" };
      const patch: Record<string, unknown> = {};
      if (typeof a.cron_expr === "string") patch.cron_expr = a.cron_expr;
      if (typeof a.task === "string") patch.task = a.task;
      if (Array.isArray(a.allowed_tools)) patch.allowed_tools = (a.allowed_tools as string[]).filter((s) => typeof s === "string");
      if (typeof a.max_steps === "number") patch.max_steps = a.max_steps;
      if (typeof a.total_timeout_ms === "number") patch.total_timeout_ms = a.total_timeout_ms;
      if (typeof a.enabled === "boolean") patch.enabled = a.enabled;
      if (a.missed_window === "skip" || a.missed_window === "catch_up") patch.missed_window = a.missed_window as MissedWindowPolicy;
      try {
        const result = await store.update(resolved.workspace, id, resolved.userId, patch);
        return result.ok
          ? { ok: true, tool: "cron.update", data: { spec_id: id } }
          : { ok: false, tool: "cron.update", error: result.reason ?? "update_failed" };
      } catch (err) {
        return {
          ok: false,
          tool: "cron.update",
          error: "invalid_patch",
          message: err instanceof Error ? err.message : String(err)
        };
      }
    }
  };
}

function createCronDisableTool(store: UserCronStore): ToolDefinition {
  return {
    name: "cron.disable",
    description: "停用一条 cron（enabled=false），不再触发。语义比 cron.update 更明确，方便用户和主 agent 直接说『停了它』。",
    schema: {
      type: "object",
      required: ["spec_id"],
      properties: { spec_id: { type: "string" } }
    },
    metadata: WRITE_META,
    async execute(args, context) {
      const resolved = resolveWorkspace(context);
      if ("error" in resolved) return { ok: false, error: resolved.error };
      const id = String((args as JsonObject)?.spec_id ?? "");
      if (!id) return { ok: false, tool: "cron.disable", error: "missing_spec_id" };
      const result = await store.update(resolved.workspace, id, resolved.userId, { enabled: false });
      return result.ok
        ? { ok: true, tool: "cron.disable", data: { spec_id: id, enabled: false } }
        : { ok: false, tool: "cron.disable", error: result.reason ?? "disable_failed" };
    }
  };
}

function createCronEnableTool(store: UserCronStore): ToolDefinition {
  return {
    name: "cron.enable",
    description: "重新启用一条 cron（enabled=true）。用于把之前 disable 掉的恢复回来。",
    schema: {
      type: "object",
      required: ["spec_id"],
      properties: { spec_id: { type: "string" } }
    },
    metadata: WRITE_META,
    async execute(args, context) {
      const resolved = resolveWorkspace(context);
      if ("error" in resolved) return { ok: false, error: resolved.error };
      const id = String((args as JsonObject)?.spec_id ?? "");
      if (!id) return { ok: false, tool: "cron.enable", error: "missing_spec_id" };
      const result = await store.update(resolved.workspace, id, resolved.userId, { enabled: true });
      return result.ok
        ? { ok: true, tool: "cron.enable", data: { spec_id: id, enabled: true } }
        : { ok: false, tool: "cron.enable", error: result.reason ?? "enable_failed" };
    }
  };
}

function createCronRunNowTool(store: UserCronStore, runner: AgentCronJobRunner): ToolDefinition {
  return {
    name: "cron.run_now",
    description: "立即手动跑一次某条 cron（不等到点）。常用于调试或用户想『现在就执行』。会写 history，但不当作正常调度（不影响下一次自然触发）。",
    schema: {
      type: "object",
      required: ["spec_id"],
      properties: { spec_id: { type: "string" } }
    },
    metadata: WRITE_META,
    async execute(args, context) {
      const resolved = resolveWorkspace(context);
      if ("error" in resolved) return { ok: false, error: resolved.error };
      const id = String((args as JsonObject)?.spec_id ?? "");
      if (!id) return { ok: false, tool: "cron.run_now", error: "missing_spec_id" };
      const spec = await store.get(resolved.workspace, id);
      if (!spec) return { ok: false, tool: "cron.run_now", error: "not_found" };
      if (spec.user_id !== resolved.userId) return { ok: false, tool: "cron.run_now", error: "forbidden" };
      // 记下原 last_seen_window，跑完恢复——避免手动触发干扰下一次自然调度窗口的判定。
      const prevWindow = spec.state?.last_seen_window;
      const entry = await runner.runOne(resolved.workspace, spec);
      if (prevWindow !== undefined) {
        await store.mergeState(resolved.workspace, id, { last_seen_window: prevWindow });
      }
      return {
        ok: true,
        tool: "cron.run_now",
        data: {
          spec_id: id,
          status: entry.status,
          summary: entry.summary,
          duration_ms: entry.duration_ms,
          iterations: entry.iterations ?? 0,
          tool_calls_count: entry.tool_calls_count ?? 0
        }
      };
    }
  };
}

function createCronResumeTool(store: UserCronStore): ToolDefinition {
  return {
    name: "cron.resume",
    description: "手动恢复被自动暂停的 cron（连续失败 N 次后会自动 paused）。",
    schema: {
      type: "object",
      required: ["spec_id"],
      properties: { spec_id: { type: "string" } }
    },
    metadata: WRITE_META,
    async execute(args, context) {
      const resolved = resolveWorkspace(context);
      if ("error" in resolved) return { ok: false, error: resolved.error };
      const id = String((args as JsonObject)?.spec_id ?? "");
      if (!id) return { ok: false, tool: "cron.resume", error: "missing_spec_id" };
      const result = await store.resume(resolved.workspace, id, resolved.userId);
      return result.ok
        ? { ok: true, tool: "cron.resume", data: { spec_id: id } }
        : { ok: false, tool: "cron.resume", error: result.reason ?? "resume_failed" };
    }
  };
}

function createCronHistoryTool(store: UserCronStore): ToolDefinition {
  return {
    name: "cron.history",
    description: "读取某条 cron 的最近执行历史（默认最近 20 条）。",
    schema: {
      type: "object",
      required: ["spec_id"],
      properties: {
        spec_id: { type: "string" },
        limit: { type: "number", description: "默认 20，硬上限 100。" }
      }
    },
    metadata: READ_META,
    async execute(args, context) {
      const resolved = resolveWorkspace(context);
      if ("error" in resolved) return { ok: false, error: resolved.error };
      const a = (args ?? {}) as JsonObject;
      const id = String(a.spec_id ?? "");
      if (!id) return { ok: false, tool: "cron.history", error: "missing_spec_id" };
      // 校验 spec 归属
      const spec = await store.get(resolved.workspace, id);
      if (!spec) return { ok: false, tool: "cron.history", error: "not_found" };
      if (spec.user_id !== resolved.userId) return { ok: false, tool: "cron.history", error: "forbidden" };
      const limit = typeof a.limit === "number" ? Math.min(Math.max(1, Math.floor(a.limit)), 100) : 20;
      const entries = await store.readHistory(resolved.workspace, id, limit);
      return {
        ok: true,
        tool: "cron.history",
        data: {
          spec_id: id,
          count: entries.length,
          entries: entries.slice().reverse()
        }
      };
    }
  };
}
