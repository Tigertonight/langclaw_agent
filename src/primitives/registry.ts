import type { JsonObject, ToolCall, ToolDefinition, ToolExecutionContext, ToolResult, UserContext } from "../types/agent-contracts.js";
import type { KnowledgeSearchOptions, KnowledgeSearchResult } from "../rag/local-knowledge-base.js";
import { getRuntimeRegistry } from "../domains/runtime-registry.js";
import { INTENTS } from "../agent/ports.js";

interface PrimitiveDefinition {
  name: string;
  description: string;
  schema: JsonObject;
  metadata: JsonObject;
}

interface PrimitiveDescription {
  name: string;
  description: string;
  schema: JsonObject;
  metadata: JsonObject;
}

interface PrimitiveRegistryOptions {
  toolRegistry: {
    execute(call: ToolCall, context?: ToolExecutionContext): Promise<ToolResult | unknown>;
  };
  knowledgeBase: {
    search(query: string, user: UserContext, options?: KnowledgeSearchOptions): Promise<KnowledgeSearchResult[]>;
  };
}

interface PrimitiveCall {
  name: string;
  args?: JsonObject;
}

export class PrimitiveRegistry {
  private readonly toolRegistry: PrimitiveRegistryOptions["toolRegistry"];
  private readonly knowledgeBase: PrimitiveRegistryOptions["knowledgeBase"];
  private readonly primitives: PrimitiveDefinition[];

  constructor({ toolRegistry, knowledgeBase }: PrimitiveRegistryOptions) {
    this.toolRegistry = toolRegistry;
    this.knowledgeBase = knowledgeBase;
    this.primitives = [
      defineQueryPrimitive(),
      defineRetrievePrimitive(),
      defineActPrimitive(),
      defineArtifactPrimitive()
    ];
  }

  list(context: ToolExecutionContext = {}): PrimitiveDescription[] {
    return this.primitives
      .filter((primitive) => isPrimitiveAvailable(primitive, context))
      .map(({ name, description, schema, metadata }) => ({
        name,
        description,
        schema,
        metadata
      }));
  }

  async execute(call: PrimitiveCall, context: ToolExecutionContext = {}): Promise<ToolResult | unknown> {
    if (call.name === "query") {
      return this.toolRegistry.execute({
        name: "query_business_data",
        args: call.args
      }, context);
    }

    if (call.name === "retrieve") {
      const docs = await this.knowledgeBase.search(String(call.args?.query ?? ""), context.user as UserContext, {
        topK: Number(call.args?.topK ?? 5)
      });
      return {
        ok: true,
        tool: "retrieve",
        data: {
          total: docs.length,
          docs
        }
      };
    }

    if (call.name === "act") {
      const mapped = mapActCall(call);
      if (!mapped) {
        return {
          ok: false,
          tool: "act",
          error: "unsupported_action",
          message: "当前 act primitive 还不支持这个资源或操作。"
        };
      }
      return this.toolRegistry.execute(mapped, context);
    }

    if (call.name === "artifact") {
      return {
        ok: true,
        tool: "artifact",
        data: buildArtifact(call.args)
      };
    }

    return {
      ok: false,
      tool: call.name,
      error: "unknown_primitive",
      message: `primitive ${call.name} 不存在。`
    };
  }
}

function defineQueryPrimitive(): PrimitiveDefinition {
  return {
    name: "query",
    description: "通用结构化数据查询 primitive，统一承接客户、订单、销售报表、组织和员工查询。",
    schema: {
      type: "object",
      properties: {
        resource: { type: "string" },
        operation: { type: "string" },
        filters: { type: "array" },
        metrics: { type: "array" },
        fields: { type: "array" },
        sort: { type: "array" },
        limit: { type: "number" }
      },
      required: ["resource", "operation"]
    },
    metadata: {
      primitive_type: "query",
      legacy_tool: "query_business_data"
    }
  };
}

function defineRetrievePrimitive(): PrimitiveDefinition {
  return {
    name: "retrieve",
    description: "通用知识和文档检索 primitive，面向制度、流程、知识库问答。",
    schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        topK: { type: "number" }
      },
      required: ["query"]
    },
    metadata: {
      primitive_type: "retrieve"
    }
  };
}

function defineActPrimitive(): PrimitiveDefinition {
  return {
    name: "act",
    description: "通用业务动作 primitive，统一承接创建、提交、审批等系统操作。",
    schema: {
      type: "object",
      properties: {
        resource: { type: "string" },
        operation: { type: "string" },
        payload: { type: "object" }
      },
      required: ["resource", "operation", "payload"]
    },
    metadata: {
      primitive_type: "act"
    }
  };
}

function defineArtifactPrimitive(): PrimitiveDefinition {
  return {
    name: "artifact",
    description: "通用结果产出 primitive，用于生成报告、摘要、卡片或表格。",
    schema: {
      type: "object",
      properties: {
        artifactType: { type: "string" },
        title: { type: "string" },
        sections: { type: "array" }
      },
      required: ["artifactType", "title"]
    },
    metadata: {
      primitive_type: "artifact"
    }
  };
}

function mapActCall(call: PrimitiveCall): ToolCall | null {
  const { resource, operation, payload } = call.args ?? {};
  if (["create", "submit"].includes(String(operation ?? ""))) {
    // 通过 registry 查找域工具：resource + operation → tool name
    const registry = getRuntimeRegistry();
    const toolLabels = registry?.allToolLabels ?? {};
    // 查找匹配 "submit_<resource_singular>" 或 "create_<resource_singular>" 模式的工具
    const resourceStr = String(resource ?? "");
    const singular = resourceStr.endsWith("s") ? resourceStr.slice(0, -1) : resourceStr;
    const candidateNames = [`submit_${singular}`, `create_${singular}`, `submit_${resourceStr}`, `create_${resourceStr}`];
    const toolName = candidateNames.find((name) => name in toolLabels);
    if (toolName) {
      return {
        name: toolName,
        args: isJsonObject(payload) ? payload : {}
      };
    }
  }
  return null;
}

function buildArtifact(args: JsonObject = {}): JsonObject {
  const sections = Array.isArray(args.sections) ? args.sections.map(String) : [];
  return {
    id: `artifact:${Date.now()}`,
    type: args.artifactType ?? "report",
    title: args.title ?? "未命名产物",
    format: "markdown",
    sections,
    preview: sections.join("\n\n").slice(0, 240)
  };
}

function isPrimitiveAvailable(primitive: PrimitiveDefinition, context: ToolExecutionContext): boolean {
  const route = isJsonObject(context.route) ? context.route : {};
  if (primitive.name === "act" && route.intent === INTENTS.KNOWLEDGE_QA) return false;
  return true;
}

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
