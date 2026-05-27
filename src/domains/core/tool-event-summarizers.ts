/**
 * Core 域贡献的 Tool Result Summarizer / Observation Sanitizer。
 *
 * 用于 runtime/agent-events 把 query_business_data 的结果转为 step 文案与
 * 结构化 observation。从 runtime/agent-events 抽出，避免引擎硬编码业务工具名。
 */

import type { ToolResultSummarizerDefinition, ToolObservationSanitizerDefinition } from "../types.js";
import type { JsonObject } from "../../types/agent-contracts.js";
import { readableResourceNameFromRegistry } from "../runtime-registry.js";

export const CORE_TOOL_RESULT_SUMMARIZERS: ToolResultSummarizerDefinition[] = [
  {
    toolName: "query_business_data",
    summarize(result) {
      const data = (result.data ?? {}) as JsonObject;
      const metrics = Array.isArray(data.metrics) ? data.metrics : [];
      const operation = data.operation;
      if (operation === "aggregate") {
        return `得到 ${metrics.length} 个统计指标，匹配 ${data.total ?? 0} 条记录`;
      }
      const rows = Array.isArray(data.rows) ? data.rows : [];
      return `返回 ${rows.length} 条${readableResourceNameFromRegistry(data.resource, "记录")}`;
    },
  },
];

export const CORE_TOOL_OBSERVATION_SANITIZERS: ToolObservationSanitizerDefinition[] = [
  {
    toolName: "query_business_data",
    sanitize(result) {
      const data = (result.data ?? {}) as JsonObject;
      const rows = Array.isArray(data.rows) ? data.rows : null;
      return {
        ok: true,
        resource: data.resource,
        operation: data.operation,
        total: data.total,
        metrics: data.metrics,
        row_count: rows?.length,
      };
    },
  },
];
