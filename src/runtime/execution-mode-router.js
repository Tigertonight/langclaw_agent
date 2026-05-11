import { INTENTS } from "../agent/ports.js";
import { inferTaskMode } from "./agent-state.js";

export function chooseExecutionMode({ message, route, selectedSkill } = {}) {
  if (selectedSkill?.metadata?.planning_style === "strict_workflow") {
    return {
      mode: "strict_workflow",
      reason: "该 skill 需要受控业务流程执行。",
      budget: { max_iterations: 0, max_latency_ms: 0 }
    };
  }

  if (route?.intent === INTENTS.SMALLTALK || route?.intent === INTENTS.UNSUPPORTED) {
    return {
      mode: "fast_grounded",
      reason: "问候、闲聊或不支持请求不需要进入长任务循环。",
      budget: { max_iterations: 0, max_latency_ms: 2000 }
    };
  }

  if (route?.intent === INTENTS.MIXED) {
    return agentic("混合问题需要动态组合知识库和业务数据。", 4, 45000);
  }

  if (String(route?.intent_code ?? "").startsWith("dealer.") && route?.intent_code === "dealer.analysis_query") {
    return agentic("经销商经营分析需要多资源观察和补证。", 5, 60000);
  }

  const taskMode = inferTaskMode(message, route);
  if (["analysis", "report", "dashboard", "action_plan"].includes(taskMode)) {
    return agentic(`任务模式为 ${taskMode}，需要模型持续观察和规划。`, taskMode === "analysis" ? 3 : 4, 45000);
  }

  return {
    mode: "fast_grounded",
    reason: "该请求是明确的查询/知识问答，使用确定性工具链更快更稳。",
    budget: { max_iterations: 1, max_latency_ms: 3000 }
  };
}

function agentic(reason, maxIterations, maxLatencyMs) {
  return {
    mode: "agentic_task",
    reason,
    budget: {
      max_iterations: maxIterations,
      max_latency_ms: maxLatencyMs
    }
  };
}
