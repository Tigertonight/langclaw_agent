import { z } from "zod";

export const MessageRoleSchema = z.enum(["system", "user", "assistant", "tool"]);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

export const MessageItemSchema = z.object({
  session_id: z.string().min(1).max(120),
  turn_index: z.number().int().min(0),
  role: MessageRoleSchema,
  content: z.string().nullable().optional(),
  tool_call: z.record(z.unknown()).nullable().optional(),
  tool_result: z.record(z.unknown()).nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
  agent_id: z.string().min(1).max(120).optional()
}).strict().refine(
  (m) => m.content !== undefined || m.tool_call !== undefined || m.tool_result !== undefined,
  { message: "message must have content, tool_call, or tool_result" }
);

export type MessageItem = z.infer<typeof MessageItemSchema>;

export const MessageBatchSchema = z.object({
  items: z.array(MessageItemSchema).min(1).max(500)
}).strict();

export type MessageBatchInput = z.infer<typeof MessageBatchSchema>;

export const MessageListQuerySchema = z.object({
  session_id: z.string().min(1).max(120).optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().optional()
}).strict();

export type MessageListQuery = z.infer<typeof MessageListQuerySchema>;

export interface MessageDto {
  id: string;
  session_id: string;
  turn_index: number;
  role: MessageRole;
  content: string | null;
  tool_call: Record<string, unknown> | null;
  tool_result: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  created_at: string;
}
