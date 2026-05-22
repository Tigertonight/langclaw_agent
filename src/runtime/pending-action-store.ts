import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { safeJoinWorkspace, type WorkspaceContext } from "./workspace-context.js";
import type { JsonObject, ToolCall } from "../types/agent-contracts.js";

export interface PendingAction extends JsonObject {
  id: string;
  status: "pending" | "approved" | "rejected" | "expired";
  user_id: string;
  session_id?: string;
  tool: string;
  call: JsonObject & { name: string };
  risk_level: string;
  reason: string;
  created_at: string;
  updated_at: string;
  expires_at: string;
}

export class PendingActionStore {
  async create(workspace: WorkspaceContext, input: {
    userId: string;
    sessionId?: string;
    call: ToolCall;
    riskLevel?: string;
    reason?: string;
    ttlMs?: number;
  }): Promise<PendingAction> {
    const now = new Date();
    const action: PendingAction = {
      id: `pa_${now.getTime()}_${Math.random().toString(36).slice(2, 8)}`,
      status: "pending",
      user_id: input.userId,
      session_id: input.sessionId,
      tool: input.call.name,
      call: JSON.parse(JSON.stringify(input.call)) as JsonObject & { name: string },
      risk_level: input.riskLevel ?? "write",
      reason: input.reason ?? "tool requires confirmation",
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
      expires_at: new Date(now.getTime() + (input.ttlMs ?? 15 * 60 * 1000)).toISOString()
    };
    const actions = await this.list(workspace, { includeExpired: true });
    actions.push(action);
    await this.writeAll(workspace, actions);
    return action;
  }

  async list(workspace: WorkspaceContext, { includeExpired = false }: { includeExpired?: boolean } = {}): Promise<PendingAction[]> {
    const file = this.filePath(workspace);
    if (!existsSync(file)) return [];
    try {
      const parsed = JSON.parse(await readFile(file, "utf8"));
      const actions = Array.isArray(parsed) ? parsed.map(normalizePendingAction).filter(Boolean) as PendingAction[] : [];
      return includeExpired ? actions : actions.filter((action) => !isExpired(action) && action.status === "pending");
    } catch {
      return [];
    }
  }

  async get(workspace: WorkspaceContext, id: string): Promise<PendingAction | null> {
    return (await this.list(workspace, { includeExpired: true })).find((action) => action.id === id) ?? null;
  }

  async mark(workspace: WorkspaceContext, id: string, status: PendingAction["status"]): Promise<PendingAction | null> {
    const actions = await this.list(workspace, { includeExpired: true });
    const action = actions.find((item) => item.id === id);
    if (!action) return null;
    action.status = status;
    action.updated_at = new Date().toISOString();
    await this.writeAll(workspace, actions);
    return action;
  }

  filePath(workspace: WorkspaceContext): string {
    return safeJoinWorkspace(workspace.root, "runtime", "pending-actions.json");
  }

  private async writeAll(workspace: WorkspaceContext, actions: PendingAction[]): Promise<void> {
    const file = this.filePath(workspace);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(actions, null, 2), "utf8");
  }
}

function normalizePendingAction(value: unknown): PendingAction | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.tool !== "string") return null;
  return record as PendingAction;
}

function isExpired(action: PendingAction): boolean {
  return Date.parse(action.expires_at) <= Date.now();
}
