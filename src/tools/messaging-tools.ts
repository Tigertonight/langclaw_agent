import { resolveUserWorkspace, type WorkspaceContext } from "../runtime/workspace-context.js";
import type { MessageGateway } from "../messaging/message-gateway.js";
import type { MessageBodyType } from "../messaging/types.js";
import type { JsonObject, ToolDefinition, UserContext } from "../types/agent-contracts.js";

/**
 * messaging.* 工具集：
 *   - messaging.send：给用户主动发消息
 *   - messaging.list_channels：查可用 channel
 *
 * 关键约束：
 *   - to.user_id 必填；agent 不能伪造（写工具时会强制 fallback 到当前用户，但我们允许跨用户发，
 *     因为后续工作流场景里需要"经理 agent 通知销售"）
 *   - 默认 risk_level=write + expose_to_agentic=true，但不挂 spawn_agent 子集（cron / 主 agent 都可调）
 *   - subject + body 都过 1 个 schema field（避免 LLM 漏填 type 时拼错；默认 text）
 */

export function createMessagingTools(opts: { gateway: MessageGateway }): ToolDefinition[] {
  const { gateway } = opts;
  return [
    {
      name: "messaging.send",
      description: [
        "给用户主动发消息。channel 不传走用户偏好，第一个通的 channel 就用第一个。",
        "全部 channel 都失败时会落到 <workspace>/messaging/outbox.jsonl 等离线 drain。",
        "body.type 支持 text / markdown；subject 可选，console/email 用作主题。"
      ].join(" "),
      schema: {
        type: "object",
        required: ["to_user_id", "content"],
        properties: {
          to_user_id: { type: "string", description: "接收方用户 ID（业务层 ID，不是 wecom_userid）" },
          channel: { type: "string", description: "可选：显式指定 channel（console/wecom/...）。不传走偏好。" },
          subject: { type: "string", description: "可选：短主题，console/email 用。" },
          content: { type: "string", description: "消息正文。markdown 支持企微 markdown 语法。" },
          body_type: { type: "string", enum: ["text", "markdown"], description: "默认 text。" },
          source: { type: "string", description: "调用来源标记。例：cron / agent / spawn_agent" },
          ref_kind: { type: "string", description: "可选：关联实体类别（例 cron_spec / task）" },
          ref_id: { type: "string", description: "可选：关联实体 id" }
        }
      },
      metadata: {
        required_permissions: [],
        risk_level: "write",
        expose_to_agentic: true,
        source: "messaging"
      },
      async execute(args, context) {
        const a = (args ?? {}) as JsonObject;
        const toUserId = String(a.to_user_id ?? "");
        const content = String(a.content ?? "");
        if (!toUserId) return { ok: false, tool: "messaging.send", error: "missing_to_user_id" };
        if (!content) return { ok: false, tool: "messaging.send", error: "missing_content" };
        const ws = resolveWorkspaceFromContext(context);
        const bodyType: MessageBodyType = a.body_type === "markdown" ? "markdown" : "text";
        const ref = (typeof a.ref_kind === "string" && typeof a.ref_id === "string")
          ? { kind: a.ref_kind, id: a.ref_id }
          : undefined;
        const result = await gateway.send(
          {
            to: { user_id: toUserId },
            channel: typeof a.channel === "string" ? a.channel : undefined,
            subject: typeof a.subject === "string" ? a.subject : undefined,
            body: { type: bodyType, content },
            source: typeof a.source === "string" ? a.source : "agent",
            ref
          },
          { workspace: ws }
        );
        if (result.ok) {
          return {
            ok: true,
            tool: "messaging.send",
            data: {
              channel: result.channel,
              attempts: result.attempts,
              duration_ms: result.duration_ms
            }
          };
        }
        return {
          ok: false,
          tool: "messaging.send",
          error: "all_channels_failed",
          message: result.attempts.map((a) => `${a.channel}:${a.error ?? "ok=false"}`).join(" | "),
          data: {
            outbox_id: result.outbox_id ?? null,
            attempts: result.attempts,
            duration_ms: result.duration_ms
          }
        };
      }
    },
    {
      name: "messaging.list_channels",
      description: "列出当前网关已注册可用的 channel（缺凭证的 channel 不会出现在列表里）。",
      schema: { type: "object", properties: {} },
      metadata: {
        required_permissions: [],
        risk_level: "read",
        expose_to_agentic: true,
        source: "messaging"
      },
      async execute() {
        return {
          ok: true,
          tool: "messaging.list_channels",
          data: { channels: gateway.listChannels() }
        };
      }
    }
  ];
}

function resolveWorkspaceFromContext(context: { user?: UserContext; workspace?: unknown } | undefined): WorkspaceContext {
  const ws = context?.workspace as Partial<WorkspaceContext> | undefined;
  if (ws && typeof ws.root === "string" && typeof ws.logs_dir === "string") return ws as WorkspaceContext;
  return resolveUserWorkspace(context?.user?.id ?? "anonymous");
}
