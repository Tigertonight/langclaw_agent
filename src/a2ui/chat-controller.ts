import { A2UIChatService } from "./chat-service.js";
import { parseA2UIActionRequest, parseA2UIChatRequest, type A2UIActionRequestDto, type A2UIChatRequestDto, type A2UISseEventDto } from "./dto.js";
import type { JsonObject } from "../types/agent-contracts.js";

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

export class A2UIChatController {
  constructor(
    private readonly queryEngine: QueryEngineLike,
    private readonly streamAgent: StreamAgentLike,
    private readonly chatService: A2UIChatService
  ) {}

  capabilities(): JsonObject {
    return this.chatService.capabilities();
  }

  async chat(body: Record<string, unknown>): Promise<JsonObject> {
    const dto = parseA2UIChatRequest(body);
    const result = await this.queryEngine.submitMessage(toQueryInput(dto));
    return await this.chatService.decorateChatResult(result) as JsonObject;
  }

  async action(body: Record<string, unknown>): Promise<JsonObject> {
    const dto = parseA2UIActionRequest(body);
    return await this.chatService.handleAction(toActionInput(dto));
  }

  async stream(body: Record<string, unknown>, emit: (event: A2UISseEventDto) => void | Promise<void>): Promise<void> {
    const dto = parseA2UIChatRequest(body);
    await this.streamAgent.runStream({
      ...toQueryInput(dto),
      onEvent: async (event) => {
        if (event.type === "done") {
          await emit(await this.chatService.decorateChatResult(event) as A2UISseEventDto);
          return;
        }
        await emit(event as A2UISseEventDto);
      }
    });
  }
}

function toQueryInput(dto: A2UIChatRequestDto) {
  return {
    userId: dto.user_id,
    userContext: dto.user_context,
    wecomUserId: dto.wecom_userid,
    message: dto.message,
    sessionId: dto.session_id,
    debug: dto.debug === true
  };
}

function toActionInput(dto: A2UIActionRequestDto) {
  return {
    userId: dto.user_id,
    sessionId: dto.session_id,
    action: dto.action
  };
}
