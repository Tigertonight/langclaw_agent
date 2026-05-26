import { createAgentStep } from "./agent-events.js";
import { detectSlotUpdateFromRegistry, getCancellationPhrases } from "../domains/runtime-registry.js";
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
    if (isScenarioContinueMessage(message)) return true;
    // 通用 slot update 检测：如果当前活跃意图有对应的 slot update 检测器，使用它
    if (activeIntent && looksLikeSlotUpdate(activeIntent, message)) return true;
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

const GENERIC_SCENARIO_CONTROL_PHRASES = [
  "确认", "提交", "确定", "是的", "可以",
  "不", "否", "先不", "不用", "不要",
  "修改", "取消", "退出", "算了", "停止",
  "不办了", "先不办了", "不用了"
];

function isScenarioControlMessage(message?: string): boolean {
  const text = String(message ?? "").trim();
  if (!text) return false;
  const phrases = [...GENERIC_SCENARIO_CONTROL_PHRASES, ...getCancellationPhrases()];
  const escaped = phrases.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`^(${escaped.join("|")})$`, "i");
  return pattern.test(text);
}

// 用户用自然语言表达"继续/接着/恢复"当前未完成流程，应优先续做不要清状态
function isScenarioContinueMessage(message?: string): boolean {
  const text = String(message ?? "").trim();
  if (!text) return false;
  return /^(继续|接着|续上|继续刚才|继续上次|刚才那个|上次那个|继续之前|接着上次|继续做|继续办|继续填)/.test(text)
      || /^(继续|接着).{0,8}(那个|刚才|上次|之前|未完成|流程|表单|申请)/.test(text);
}

/**
 * 通用 slot update 检测。
 * 通过 registry 的 slotUpdateDetectors 动态查找域特定的检测逻辑。
 */
function looksLikeSlotUpdate(activeIntent: string, message?: string): boolean {
  const text = String(message ?? "");
  return detectSlotUpdateFromRegistry(activeIntent, text);
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
