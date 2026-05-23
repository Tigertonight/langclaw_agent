import { z, type ZodTypeAny } from "zod";
import type { JsonObject } from "../types/agent-contracts.js";
import type { ToolDefinition } from "../types/agent-contracts.js";

export interface ZodToolInit<TIn extends ZodTypeAny, TOut extends ZodTypeAny> {
  name: string;
  description: string;
  inputSchema: TIn;
  outputSchema: TOut;
  metadata?: ToolDefinition["metadata"];
  execute: (args: z.infer<TIn>, context: Parameters<ToolDefinition["execute"]>[1]) => Promise<z.infer<TOut>> | z.infer<TOut>;
}

/**
 * 用 zod 定义 tool。
 *
 * - input：LLM/上游传入的 args，会被 ToolRegistry 在执行前 safeParse；失败 emit metric + log，并返回 invalid_input ToolResult。
 * - output：tool 执行结果，会被出口 safeParse；失败 emit metric + log，但**不阻断** —— 仍把结果透传出去（避免破坏现有调用方）。
 * - schema：自动 zod-to-json-schema 给 LLM tool calling 用，老消费方继续工作。
 *
 * 这样：
 *   - LLM 看到的是严格的 JSON Schema（带 enum/required/additionalProperties）
 *   - runtime 执行时参数不合法直接拒
 *   - tool 实现内部拿到的是 z.infer<TIn> 强类型
 *   - tool 返回值不符合 outputSchema 时立刻被发现
 */
export function defineTool<TIn extends ZodTypeAny, TOut extends ZodTypeAny>(init: ZodToolInit<TIn, TOut>): ZodTool<TIn, TOut> {
  const jsonSchema = z.toJSONSchema(init.inputSchema, { target: "draft-7" }) as JsonObject;
  return {
    name: init.name,
    description: init.description,
    schema: jsonSchema,
    metadata: init.metadata,
    inputSchema: init.inputSchema,
    outputSchema: init.outputSchema,
    execute: init.execute as ToolDefinition["execute"]
  };
}

export interface ZodTool<TIn extends ZodTypeAny = ZodTypeAny, TOut extends ZodTypeAny = ZodTypeAny> extends ToolDefinition {
  inputSchema: TIn;
  outputSchema: TOut;
}

export function isZodTool(tool: ToolDefinition): tool is ZodTool {
  return Boolean((tool as ZodTool).inputSchema && (tool as ZodTool).outputSchema);
}

/** 通用的 tool 执行结果 schema：每个 tool 可以 extend 它来约束自己的 data 字段 */
export const ToolResultBaseSchema = z.object({
  ok: z.boolean().optional(),
  tool: z.string().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  message: z.string().optional(),
  data: z.unknown().optional()
}).passthrough();

export { z };
