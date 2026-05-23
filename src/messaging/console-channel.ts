import { mkdir, appendFile } from "node:fs/promises";
import path from "node:path";
import type { MessageChannel, MessageRequest, MessageDeliveryResult, ChannelSendContext } from "./types.js";

/**
 * Console channel —— 把消息写到 <workspace>/inbox/<user_id>.jsonl。
 *
 * 用途：
 *   - 默认开启：不需要 env / 网络，所有平台/CI 都能跑
 *   - smoke 测试 + 本地开发的"消息收件箱"
 *   - 真实 channel 都失败时也可作 last-resort fallback（让 user 起码能在工作区里翻到）
 *
 * 不做：
 *   - 不真发到 stdout（避免污染 CLI / 服务输出）
 *   - 不 broadcast。一封消息一行。
 */

export class ConsoleChannel implements MessageChannel {
  readonly name = "console";

  isAvailable(): boolean {
    return true;
  }

  async send(req: MessageRequest, ctx: ChannelSendContext): Promise<MessageDeliveryResult> {
    const startedAt = Date.now();
    const dir = path.join(ctx.workspace.root, "inbox");
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, `${sanitize(req.to.user_id)}.jsonl`);
    const at = new Date().toISOString();
    const line = JSON.stringify({
      at,
      channel: "console",
      user_id: req.to.user_id,
      subject: req.subject ?? null,
      body_type: req.body.type,
      content: req.body.content,
      source: req.source ?? null,
      ref: req.ref ?? null,
      dedupe_key: req.dedupe_key ?? null,
      metadata: req.metadata ?? null
    });
    await appendFile(file, `${line}\n`, "utf8");
    return {
      ok: true,
      channel: "console",
      external_id: `${at}-${Date.now()}`,
      duration_ms: Date.now() - startedAt,
      attempts: 1
    };
  }
}

function sanitize(id: string): string {
  return String(id ?? "anonymous").replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 80) || "anonymous";
}
