import { SkillSelector } from "./selector.js";

export class SkillRuntime {
  constructor({ skillLoader, scenarioRouter }) {
    this.skillLoader = skillLoader;
    this.scenarioRouter = scenarioRouter;
    this.selector = new SkillSelector();
  }

  async select({ session, route, message, user }) {
    const skills = await this.skillLoader.select({ route, message, user });
    const selection = this.selector.select({ session, route, message, skills });
    return {
      ...selection,
      skills
    };
  }

  shouldUseWorkflow({ route, selection }) {
    if (!selection?.selectedSkill) {
      return this.scenarioRouter.hasScenario(route.intent);
    }
    return selection.mode === "strict_workflow" && this.scenarioRouter.hasScenario(route.intent);
  }

  createSessionPatch(selection) {
    if (!selection?.selectedSkill) {
      return { active_skill: null };
    }
    return {
      active_skill: selection.selectedSkill.id
    };
  }
}
