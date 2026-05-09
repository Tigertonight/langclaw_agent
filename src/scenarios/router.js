import { INTENTS } from "../agent/ports.js";
import { LeaveRequestScenario } from "./leave-request.js";

export class ScenarioRouter {
  constructor({ toolRegistry }) {
    this.scenarios = new Map([
      [INTENTS.LEAVE_REQUEST, new LeaveRequestScenario({ toolRegistry })]
    ]);
  }

  canResume(session) {
    return Boolean(session.active_intent && this.scenarios.has(session.active_intent));
  }

  hasScenario(intent) {
    return this.scenarios.has(intent);
  }

  get(intent) {
    return this.scenarios.get(intent);
  }
}
