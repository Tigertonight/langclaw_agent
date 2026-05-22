import type { JsonObject } from "../types/agent-contracts.js";

export interface A2UIPipeLogEntry extends JsonObject {
  id: string;
  stage: string;
  attempt: number;
  status: "ok" | "retry" | "failed";
  at: string;
  message?: string;
}

export class A2UIPipeLogService {
  private readonly entries: A2UIPipeLogEntry[] = [];

  async withRetry<T>(stage: string, fn: (attempt: number) => Promise<T> | T, retries = 2): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        const result = await fn(attempt);
        this.record(stage, attempt, "ok");
        return result;
      } catch (error) {
        lastError = error;
        this.record(stage, attempt, attempt < retries ? "retry" : "failed", error instanceof Error ? error.message : String(error));
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  recent(limit = 50): A2UIPipeLogEntry[] {
    return this.entries.slice(-limit);
  }

  private record(stage: string, attempt: number, status: A2UIPipeLogEntry["status"], message?: string): void {
    this.entries.push({
      id: `a2ui_pipe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      stage,
      attempt,
      status,
      at: new Date().toISOString(),
      message
    });
    if (this.entries.length > 500) this.entries.splice(0, this.entries.length - 500);
  }
}
