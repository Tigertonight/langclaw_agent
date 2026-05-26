import type { JsonObject } from "../types/agent-contracts.js";
import { readableToolNameFromRegistry, getFieldLabelFromRegistry } from "../domains/runtime-registry.js";

/**
 * 通用字段标签（与任何业务域无关的系统级字段）。
 * 域特定字段标签（如 leave_type、customer_name）由各 DomainPack.fieldLabels 提供，
 * 通过 getFieldLabelFromRegistry() 动态获取。
 */
const GENERIC_FIELD_LABELS: Record<string, string> = {
  title: "标题",
  goal: "目标",
  priority: "优先级",
  status: "状态",
  id: "ID",
  reason: "原因",
  plugin: "插件",
  config: "配置",
  code: "代码",
  mode: "模式",
  input: "输入",
  timeout_ms: "超时时间(毫秒)",
  owner: "负责人",
  target_type: "目标类型",
  evidence: "证据",
  expires_at: "过期时间"
};

/** 兜底工具标签（registry 未初始化时使用） */
const FALLBACK_TOOL_LABELS: Record<string, string> = {
  "task.create": "创建任务",
  "task.update": "更新任务",
  "task.delete": "删除任务",
  "task.list": "查询任务",
  "safe_compute": "代码计算",
  "runtime.plugin.config": "配置插件",
  "query_business_data": "查询业务数据"
};

export function getFieldLabel(path: string): string {
  if (!path) return "字段";
  const head = path.split(".")[0] ?? path;
  // 优先从 registry 获取域特定标签，再查通用标签
  return getFieldLabelFromRegistry(head) ?? GENERIC_FIELD_LABELS[head] ?? path;
}

export function getToolLabel(toolName: string): string {
  return readableToolNameFromRegistry(toolName, FALLBACK_TOOL_LABELS[toolName]);
}

interface ZodIssueLike {
  code?: string;
  message?: string;
  path?: Array<string | number>;
  expected?: string;
  received?: string;
  minimum?: number;
  maximum?: number;
  type?: string;
  options?: ReadonlyArray<string | number>;
  values?: ReadonlyArray<string | number>;
  keys?: string[];
  validation?: string;
  origin?: string;
}

export function formatZodIssue(issue: ZodIssueLike): string {
  const path = (issue.path ?? []).join(".");
  const field = getFieldLabel(path);

  switch (issue.code) {
    case "invalid_type": {
      const message = issue.message ?? "";
      if (issue.received === "undefined" || issue.received === "null"
        || /received undefined|received null/.test(message)) {
        return `请填写"${field}"：必填项`;
      }
      const expected = issue.expected ?? "正确类型";
      return `"${field}" 类型不对：需要 ${humanType(expected)}`;
    }
    case "too_small": {
      const min = issue.minimum;
      if (issue.type === "string" || issue.origin === "string") {
        return min === 1
          ? `请填写"${field}"：必填项`
          : `"${field}" 至少需要 ${min} 个字符`;
      }
      if (issue.type === "array" || issue.origin === "array") {
        return `"${field}" 至少需要 ${min} 项`;
      }
      return `"${field}" 不能小于 ${min}`;
    }
    case "too_big": {
      const max = issue.maximum;
      if (issue.type === "string" || issue.origin === "string") {
        return `"${field}" 最多 ${max} 个字符`;
      }
      if (issue.type === "array" || issue.origin === "array") {
        return `"${field}" 最多 ${max} 项`;
      }
      return `"${field}" 不能大于 ${max}`;
    }
    case "invalid_value":
    case "invalid_enum_value": {
      const opts = [...(issue.values ?? []), ...(issue.options ?? [])].join(" / ");
      return opts ? `"${field}" 只能是：${opts}` : `"${field}" 取值不合法`;
    }
    case "invalid_format":
    case "invalid_string": {
      return `"${field}" 格式不对`;
    }
    case "unrecognized_keys": {
      const keys = (issue.keys ?? []).map((k) => `"${k}"`).join("、");
      return keys ? `不支持的字段：${keys}` : `存在不支持的字段`;
    }
    default:
      return path ? `"${field}"：${issue.message ?? "输入不合法"}` : (issue.message ?? "输入不合法");
  }
}

function humanType(zodType: string): string {
  const map: Record<string, string> = {
    string: "文本",
    number: "数字",
    boolean: "是/否",
    object: "对象",
    array: "数组",
    record: "键值对"
  };
  return map[zodType] ?? zodType;
}

export function formatInvalidInputMessage(toolName: string, issues: JsonObject[]): string {
  const tool = getToolLabel(toolName);
  const lines = issues.map((raw) => formatZodIssue(raw as ZodIssueLike));
  return `${tool}：${lines.join("；")}`;
}

export function formatUnknownTool(toolName: string): string {
  return `工具"${getToolLabel(toolName)}"不存在`;
}

export function formatToolUnavailable(toolName: string): string {
  return `工具"${getToolLabel(toolName)}"在当前场景下不可用`;
}

export function formatConfirmationRequired(toolName: string): string {
  return `操作"${getToolLabel(toolName)}"需要您确认后才会执行`;
}

export function formatExecuteFailed(toolName: string, errorMessage: string): string {
  return `执行"${getToolLabel(toolName)}"时出错：${errorMessage}`;
}
