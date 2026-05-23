import { fetchJson, FetchJsonError } from "../integrations/http.js";
import { TokenCache } from "../integrations/token-cache.js";
import type { JsonObject } from "../types/agent-contracts.js";
import type { MessageChannel, MessageRequest, MessageDeliveryResult, ChannelSendContext } from "./types.js";

/**
 * WeCom message channel —— 调企微 /cgi-bin/message/send。
 *
 * 凭证体系：
 *   - corpId + agentSecret + agentId（应用级，不是 contact secret —— 那个用来读通讯录）
 *   - access_token 自己缓存 7000s
 *
 * 地址映射：
 *   优先用 ctx.resolved_address（gateway 已经从用户偏好里取出的 wecom_userid）。
 *   如果没有，fallback 用 req.to.user_id —— 适用于 user_id 本身就是 wecom_userid 的部署
 *   （MockWeComDirectory 就是这种）。
 *
 * 第一版只发 text/markdown；不做卡片 / 文件。
 */

export interface WeComChannelOptions {
  corpId: string;
  agentSecret: string;
  agentId: string | number;
  baseUrl?: string;
  /** 失败 401 / 40014 时清 token。可注入便于测试。 */
  tokenCache?: TokenCache;
}

interface WeComSendResponse extends JsonObject {
  errcode?: number;
  errmsg?: string;
  invaliduser?: string;
  msgid?: string;
}

interface WeComTokenPayload extends JsonObject {
  errcode?: number;
  errmsg?: string;
  access_token?: string;
  expires_in?: number;
}

export class WeComChannel implements MessageChannel {
  readonly name = "wecom";
  private readonly corpId: string;
  private readonly agentSecret: string;
  private readonly agentId: string;
  private readonly baseUrl: string;
  private readonly tokenCache: TokenCache;

  constructor(opts: WeComChannelOptions) {
    this.corpId = opts.corpId;
    this.agentSecret = opts.agentSecret;
    this.agentId = String(opts.agentId);
    this.baseUrl = (opts.baseUrl ?? "https://qyapi.weixin.qq.com").replace(/\/$/, "");
    this.tokenCache = opts.tokenCache ?? new TokenCache();
  }

  isAvailable(): boolean {
    return Boolean(this.corpId && this.agentSecret && this.agentId);
  }

  async send(req: MessageRequest, ctx: ChannelSendContext): Promise<MessageDeliveryResult> {
    const startedAt = Date.now();
    const wecomUser = ctx.resolved_address || req.to.user_id;
    if (!wecomUser) {
      throw new Error("wecom: missing recipient address");
    }
    const token = await this.getAccessToken();
    const url = `${this.baseUrl}/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`;
    const payload = this.buildPayload(req, wecomUser);
    let response: WeComSendResponse;
    try {
      response = await fetchJson<WeComSendResponse>(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
    } catch (err) {
      // 401 / token 失效：清 cache 让下次重新拿
      if (err instanceof FetchJsonError && err.status === 401) this.tokenCache.delete("wecom_app_access_token");
      throw err;
    }
    if (response.errcode && response.errcode !== 0) {
      // 42001 access_token expired / 40014 invalid token —— 清 cache 让上层 retry 时拿到新的
      if (response.errcode === 42001 || response.errcode === 40014) {
        this.tokenCache.delete("wecom_app_access_token");
      }
      const err = new Error(`wecom send failed: errcode=${response.errcode} errmsg=${response.errmsg ?? ""}`) as Error & { detail?: JsonObject };
      err.detail = response;
      throw err;
    }
    return {
      ok: true,
      channel: "wecom",
      external_id: response.msgid,
      duration_ms: Date.now() - startedAt,
      attempts: 1,
      detail: response.invaliduser ? { invaliduser: response.invaliduser } : undefined
    };
  }

  private buildPayload(req: MessageRequest, touser: string): JsonObject {
    const base: JsonObject = {
      touser,
      agentid: Number(this.agentId) || this.agentId,
      safe: 0
    };
    if (req.body.type === "markdown") {
      return {
        ...base,
        msgtype: "markdown",
        markdown: { content: clamp(req.body.content, 4096) }
      };
    }
    // 默认 text；subject 拼到首行更醒目
    const text = req.subject
      ? `【${req.subject}】\n${req.body.content}`
      : req.body.content;
    return {
      ...base,
      msgtype: "text",
      text: { content: clamp(text, 2048) }
    };
  }

  private async getAccessToken(): Promise<string> {
    const cached = this.tokenCache.get("wecom_app_access_token");
    if (cached) return cached;
    const url = `${this.baseUrl}/cgi-bin/gettoken?corpid=${encodeURIComponent(this.corpId)}&corpsecret=${encodeURIComponent(this.agentSecret)}`;
    const payload = await fetchJson<WeComTokenPayload>(url);
    if (!payload.access_token || (payload.errcode && payload.errcode !== 0)) {
      throw new Error(`wecom gettoken failed: ${payload.errmsg ?? payload.errcode ?? "no access_token"}`);
    }
    this.tokenCache.set("wecom_app_access_token", payload.access_token, payload.expires_in ?? 7200);
    return payload.access_token;
  }
}

function clamp(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}
