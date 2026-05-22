import { A2UIChatController } from "./chat-controller.js";
import { A2UIChatService } from "./chat-service.js";
import type { JsonObject, ToolExecutionContext, UserContext } from "../types/agent-contracts.js";

interface QueryEngineLike {
  submitMessage(input: {
    userId: string;
    userContext?: JsonObject;
    wecomUserId?: string;
    message: string;
    sessionId?: string;
    debug?: boolean;
  }): Promise<Record<string, unknown>>;
}

interface StreamAgentLike {
  runStream(input: {
    userId: string;
    userContext?: JsonObject;
    wecomUserId?: string;
    message: string;
    sessionId?: string;
    debug?: boolean;
    onEvent?: (event: JsonObject) => Promise<void> | void;
  }): Promise<unknown>;
}

interface ToolRegistryLike {
  execute(call: { name: string; args?: JsonObject }, context?: ToolExecutionContext): Promise<unknown>;
}

interface UserContextResolverLike {
  resolve(input: { userId?: string; userContext?: Record<string, unknown>; wecomUserId?: string }): Promise<UserContext>;
}

export interface A2UIModule {
  chatService: A2UIChatService;
  chatController: A2UIChatController;
}

export function createA2UIModule({
  queryEngine,
  streamAgent,
  toolRegistry,
  userContextResolver
}: {
  queryEngine: QueryEngineLike;
  streamAgent: StreamAgentLike;
  toolRegistry: ToolRegistryLike;
  userContextResolver: UserContextResolverLike;
}): A2UIModule {
  const chatService = new A2UIChatService(toolRegistry, userContextResolver);
  return {
    chatService,
    chatController: new A2UIChatController(queryEngine, streamAgent, chatService)
  };
}
