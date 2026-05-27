import { safeJoinWorkspace, type WorkspaceContext } from "./workspace-context.js";
import { defaultJsonFileStore, type JsonFileStore } from "./store-adapter.js";
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
  private readonly store: JsonFileStore;

  constructor(store: JsonFileStore = defaultJsonFileStore()) {
    this.store = store;
  }

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
    await this.store.mutate<PendingAction[]>(this.filePath(workspace), [], (actions) => {
      actions.push(action);
      return actions;
    });
    return action;
  }

  async list(workspace: WorkspaceContext, { includeExpired = false }: { includeExpired?: boolean } = {}): Promise<PendingAction[]> {
    const raw = await this.store.read<unknown[]>(this.filePath(workspace), []);
    const actions = Array.isArray(raw) ? raw.map(normalizePendingAction).filter(Boolean) as PendingAction[] : [];
    return includeExpired ? actions : actions.filter((action) => !isExpired(action) && action.status === "pending");
  }

  async get(workspace: WorkspaceContext, id: string): Promise<PendingAction | null> {
    return (await this.list(workspace, { includeExpired: true })).find((action) => action.id === id) ?? null;
  }

  async mark(workspace: WorkspaceContext, id: string, status: PendingAction["status"]): Promise<PendingAction | null> {
    let updated: PendingAction | null = null;
    await this.store.mutate<PendingAction[]>(this.filePath(workspace), [], (actions) => {
      const action = actions.find((item) => item.id === id);
      if (!action) return actions;
      action.status = status;
      action.updated_at = new Date().toISOString();
      updated = action;
      return actions;
    });
    return updated;
  }

  filePath(workspace: WorkspaceContext): string {
    return safeJoinWorkspace(workspace.root, "runtime", "pending-actions.json");
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
