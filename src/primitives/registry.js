export class PrimitiveRegistry {
  constructor({ toolRegistry, knowledgeBase }) {
    this.toolRegistry = toolRegistry;
    this.knowledgeBase = knowledgeBase;
    this.primitives = [
      defineQueryPrimitive(),
      defineRetrievePrimitive(),
      defineActPrimitive(),
      defineArtifactPrimitive()
    ];
  }

  list(context = {}) {
    return this.primitives
      .filter((primitive) => isPrimitiveAvailable(primitive, context))
      .map(({ name, description, schema, metadata }) => ({
        name,
        description,
        schema,
        metadata
      }));
  }

  async execute(call, context = {}) {
    if (call.name === "query") {
      return this.toolRegistry.execute({
        name: "query_business_data",
        args: call.args
      }, context);
    }

    if (call.name === "retrieve") {
      const docs = await this.knowledgeBase.search(call.args.query, context.user, {
        topK: call.args.topK ?? 5
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

function defineQueryPrimitive() {
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

function defineRetrievePrimitive() {
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

function defineActPrimitive() {
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

function defineArtifactPrimitive() {
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

function mapActCall(call) {
  const { resource, operation, payload } = call.args ?? {};
  if (resource === "leave_requests" && ["create", "submit"].includes(operation)) {
    return {
      name: "submit_leave_request",
      args: payload
    };
  }
  return null;
}

function buildArtifact(args = {}) {
  return {
    id: `artifact:${Date.now()}`,
    type: args.artifactType ?? "report",
    title: args.title ?? "未命名产物",
    format: "markdown",
    sections: Array.isArray(args.sections) ? args.sections : [],
    preview: Array.isArray(args.sections) ? args.sections.join("\n\n").slice(0, 240) : ""
  };
}

function isPrimitiveAvailable(primitive, context) {
  if (primitive.name === "act" && context.route?.intent === "knowledge_qa") return false;
  return true;
}
