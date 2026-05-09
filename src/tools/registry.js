export class ToolRegistry {
  constructor(tools) {
    this.tools = new Map(tools.map((tool) => [tool.name, tool]));
  }

  list(context = {}) {
    return Array.from(this.tools.values())
      .filter((tool) => isToolAvailable(tool, context))
      .map(({ name, description, schema, metadata }) => ({
      name,
      description,
      schema,
      metadata
    }));
  }

  get(name) {
    return this.tools.get(name);
  }

  describe(name) {
    const tool = this.get(name);
    if (!tool) return null;
    const { description, schema, metadata } = tool;
    return { name, description, schema, metadata };
  }

  async execute(call, context) {
    const tool = this.get(call.name);
    if (!tool) {
      return {
        ok: false,
        tool: call.name,
        error: "unknown_tool",
        message: `工具 ${call.name} 不存在。`
      };
    }
    return tool.execute(call.args, context);
  }
}

export function isToolAvailable(tool, context = {}) {
  const metadata = tool.metadata ?? {};
  const user = context.user;
  const intent = context.intent;
  const scenario = context.scenario;
  const step = context.step;

  if (metadata.required_permissions?.length && user) {
    const userPermissions = new Set(user.permissions ?? []);
    if (!metadata.required_permissions.every((permission) => userPermissions.has(permission))) {
      return false;
    }
  }

  if (metadata.intents?.length && intent && !metadata.intents.includes(intent)) {
    return false;
  }

  if (metadata.scenarios?.length && scenario && !metadata.scenarios.includes(scenario)) {
    return false;
  }

  if (metadata.steps?.length && step && !metadata.steps.includes(step)) {
    return false;
  }

  if (metadata.scenarios?.length && !scenario) {
    return false;
  }

  return true;
}
