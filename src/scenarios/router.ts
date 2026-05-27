interface ScenarioSession {
  active_intent?: string | null;
}

interface Scenario {
  run(input: unknown): Promise<unknown>;
}

export class ScenarioRouter {
  private readonly scenarios = new Map<string, Scenario>();

  /**
   * 注册一个场景。
   * intent_code → Scenario 实例。
   */
  register(intentCode: string, scenario: Scenario): void {
    this.scenarios.set(intentCode, scenario);
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
