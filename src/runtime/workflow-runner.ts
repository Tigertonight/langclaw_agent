import { createAgentStep } from "./agent-events.js";
import type { JsonObject, Route, UserContext } from "../types/agent-contracts.js";

interface WorkflowSession {
  active_intent?: string | null;
  active_skill?: string | null;
  scenario?: string | null;
  status?: string;
  state?: JsonObject;
  [key: string]: unknown;
}

interface ScenarioResult {
  sessionPatch: Partial<WorkflowSession>;
  [key: string]: unknown;
}

interface Scenario {
  run(input: { user?: UserContext; message?: string; session: WorkflowSession }): Promise<ScenarioResult>;
}

interface ScenarioRouter {
  canResume(session: WorkflowSession): boolean;
  hasScenario(intent?: string): boolean;
  get(intent?: string | null): Scenario;
}

interface AgentStep {
  phase: string;
  title: string;
  detail: string;
  status?: string;
  at?: string;
  [key: string]: unknown;
}

type ApplySessionPatch = (session: WorkflowSession, patch: Partial<WorkflowSession>) => Promise<void>;

export class WorkflowRunner {
  private readonly scenarioRouter: ScenarioRouter;
  private readonly applySessionPatch: ApplySessionPatch;

  constructor({ scenarioRouter, applySessionPatch }: { scenarioRouter: ScenarioRouter; applySessionPatch: ApplySessionPatch }) {
    this.scenarioRouter = scenarioRouter;
    this.applySessionPatch = applySessionPatch;
  }

  canResume(session: WorkflowSession): boolean {
    return this.scenarioRouter.canResume(session);
  }

  hasWorkflow(intent?: string): boolean {
    return this.scenarioRouter.hasScenario(intent);
  }

  shouldContinueActive({ activeIntent, route, message }: { activeIntent?: string | null; route: Route; message?: string }): boolean {
    if (route.intent === activeIntent) return true;
    if (isScenarioControlMessage(message)) return true;
    if (activeIntent === "leave_request" && looksLikeLeaveSlotUpdate(message)) return true;
    return false;
  }

  async reset(session: WorkflowSession): Promise<void> {
    await this.applySessionPatch(session, resetScenarioSessionPatch());
  }

  async runActive({ user, message, session }: { user?: UserContext; message?: string; session: WorkflowSession }): Promise<ScenarioResult> {
    const scenario = this.scenarioRouter.get(session.active_intent);
    const scenarioResult = await scenario.run({ user, message, session });
    await this.applySessionPatch(session, scenarioResult.sessionPatch);
    return scenarioResult;
  }

  async runNew({ route, user, message, session }: { route: Route; user?: UserContext; message?: string; session: WorkflowSession }): Promise<ScenarioResult> {
    const scenario = this.scenarioRouter.get(route.intent);
    const scenarioResult = await scenario.run({ user, message, session });
    await this.applySessionPatch(session, scenarioResult.sessionPatch);
    return scenarioResult;
  }

  createResumeStep(): AgentStep {
    return createAgentStep("resume_workflow", "继续受控流程", "检测到当前会话有未完成的业务流程，优先继续处理。");
  }

  createSwitchStep(): AgentStep {
    return createAgentStep("switch_task", "切换任务", "检测到你在询问新的问题，已退出上一段未完成的业务流程。");
  }

  createEnterStep(): AgentStep {
    return createAgentStep("run_workflow", "进入受控流程", "该请求需要按业务流程继续收集信息、确认或提交。");
  }
}

function isScenarioControlMessage(message?: string): boolean {
  return /^(确认|提交|确定|是的|可以|不|否|先不|不用|不要|修改|取消|退出|算了|停止|不办了|先不办了|不用了)$/i.test(String(message ?? "").trim());
}

function looksLikeLeaveSlotUpdate(message?: string): boolean {
  const text = String(message ?? "");
  if (/(怎么|如何|制度|政策|流程|规则|标准|说明|问下|了解)/.test(text)) return false;
  return /(年假|病假|事假|调休|前天|昨天|明天|后天|今天|上午|下午|晚上|\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[./月]\d{1,2}(?:日|号)?|半天|一天|两天|三天|四天|五天|小时|因为|原因是|事由是|家里有事|身体不舒服|去医院|去看了医生|去看医生|看医生)/.test(text);
}

function resetScenarioSessionPatch(): Partial<WorkflowSession> {
  return {
    active_intent: null,
    active_skill: null,
    scenario: null,
    status: "idle",
    state: {}
  };
}
