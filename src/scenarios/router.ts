import { INTENTS } from "../agent/ports.js";
import { LeaveRequestScenario } from "./leave-request.js";
import type { ToolRegistry } from "../tools/registry.js";

interface ScenarioSession {
  active_intent?: string | null;
}

interface Scenario {
  run(input: unknown): Promise<unknown>;
}

export class ScenarioRouter {
  private readonly scenarios: Map<string, Scenario>;

  constructor({ toolRegistry }: { toolRegistry: ToolRegistry }) {
    this.scenarios = new Map([
      [INTENTS.LEAVE_REQUEST, new LeaveRequestScenario({ toolRegistry }) as Scenario]
    ]);
  }

  canResume(session: ScenarioSession): boolean {
    return Boolean(session.active_intent && this.scenarios.has(session.active_intent));
  }

  hasScenario(intent?: string): boolean {
    return Boolean(intent && this.scenarios.has(intent));
  }

  get(intent?: string | null): Scenario | undefined {
    return intent ? this.scenarios.get(intent) : undefined;
  }
}
