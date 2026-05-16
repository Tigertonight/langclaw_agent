import type { Route, SkillDefinition } from "../types/agent-contracts.js";

type PlanningMode = "open_loop" | "guided" | "strict_workflow";

interface SkillSession {
  active_skill?: string | null;
}

interface SkillSelectInput {
  session?: SkillSession | null;
  route?: Partial<Route> | null;
  message?: string;
  skills?: SkillDefinition[];
}

export interface SkillSelection {
  selectedSkill: SkillDefinition | null;
  candidates: SkillDefinition[];
  mode: PlanningMode;
  reason: string;
}

export class SkillSelector {
  select({ session, route, message, skills = [] }: SkillSelectInput): SkillSelection {
    if (!skills.length) {
      return {
        selectedSkill: null,
        candidates: [],
        mode: "open_loop",
        reason: "未匹配到专用 skill，回退到通用 Agent Loop。"
      };
    }

    const activeSkill = findActiveSkill(session, skills);
    if (activeSkill) {
      return {
        selectedSkill: activeSkill,
        candidates: skills,
        mode: planningMode(activeSkill),
        reason: `当前会话存在进行中的 skill「${activeSkill.name}」，优先继续。`
      };
    }

    const selectedSkill = pickBestSkill({ route, message, skills });
    return {
      selectedSkill,
      candidates: skills,
      mode: planningMode(selectedSkill),
      reason: selectedSkill
        ? `根据任务类型和触发词，优先使用「${selectedSkill.name}」。`
        : "未匹配到专用 skill，回退到通用 Agent Loop。"
    };
  }
}

function findActiveSkill(session: SkillSession | null | undefined, skills: SkillDefinition[]): SkillDefinition | null {
  if (!session?.active_skill) return null;
  const skill = skills.find((item) => item.id === session.active_skill) ?? null;
  return planningMode(skill) === "strict_workflow" ? skill : null;
}

function pickBestSkill({ route, message, skills }: SkillSelectInput & { skills: SkillDefinition[] }): SkillDefinition | null {
  const scored = skills.map((skill) => ({
    skill,
    score: scoreSkill({ route, message, skill })
  }));
  scored.sort((left, right) => right.score - left.score);
  return scored[0]?.score > 0 ? scored[0].skill : skills[0] ?? null;
}

function scoreSkill({ route, message, skill }: { route?: Partial<Route> | null; message?: string; skill: SkillDefinition }): number {
  let score = 0;
  if (route?.intent && skill.intents.includes(route.intent)) score += 10;
  if (route?.intent_code && skill.intent_codes?.includes(route.intent_code)) score += 8;
  if (skill.id === "business-query" && /^(business|org)\./.test(String(route?.intent_code ?? ""))) score += 8;
  for (const trigger of skill.triggers ?? []) {
    if (String(message ?? "").includes(trigger)) score += 1;
  }
  if ((skill.metadata?.planning_style ?? "") === "strict_workflow") score += 1;
  return score;
}

function planningMode(skill: SkillDefinition | null): PlanningMode {
  if (!skill) return "open_loop";
  const style = skill.metadata?.planning_style ?? "";
  if (style === "strict_workflow") return "strict_workflow";
  if (style === "guided") return "guided";
  return "open_loop";
}
