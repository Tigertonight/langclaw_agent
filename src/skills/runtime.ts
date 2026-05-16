import { SkillSelector, type SkillSelection } from "./selector.js";
import type { Route, SkillDefinition, UserContext } from "../types/agent-contracts.js";

interface SkillRuntimeSession {
  active_skill?: string | null;
}

interface SkillLoader {
  select(input: { route: Route; message?: string; user?: UserContext }): Promise<SkillDefinition[]>;
}

interface ScenarioRouter {
  hasScenario(intent?: string): boolean;
}

export interface SkillRuntimeSelection extends SkillSelection {
  skills: SkillDefinition[];
}

export class SkillRuntime {
  private readonly skillLoader: SkillLoader;
  private readonly scenarioRouter: ScenarioRouter;
  private readonly selector: SkillSelector;

  constructor({ skillLoader, scenarioRouter }: { skillLoader: SkillLoader; scenarioRouter: ScenarioRouter }) {
    this.skillLoader = skillLoader;
    this.scenarioRouter = scenarioRouter;
    this.selector = new SkillSelector();
  }

  async select({
    session,
    route,
    message,
    user
  }: {
    session?: SkillRuntimeSession;
    route: Route;
    message?: string;
    user?: UserContext;
  }): Promise<SkillRuntimeSelection> {
    const skills = await this.skillLoader.select({ route, message, user });
    const selection = this.selector.select({ session, route, message, skills });
    return {
      ...selection,
      skills
    };
  }

  shouldUseWorkflow({ route, selection }: { route: Route; selection?: SkillRuntimeSelection | null }): boolean {
    if (!selection?.selectedSkill) {
      return this.scenarioRouter.hasScenario(route.intent);
    }
    return selection.mode === "strict_workflow" && this.scenarioRouter.hasScenario(route.intent);
  }

  createSessionPatch(selection?: SkillRuntimeSelection | null): { active_skill: string | null } {
    if (!selection?.selectedSkill) {
      return { active_skill: null };
    }
    return {
      active_skill: selection.selectedSkill.id
    };
  }
}
