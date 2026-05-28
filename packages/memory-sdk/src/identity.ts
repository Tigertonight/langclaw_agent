import { createHmac } from "node:crypto";

/**
 * Identity claims signed into the X-Memory-Identity header.
 * Mirrors the schema enforced server-side by services/memory-service.
 */
export interface Identity {
  business_id: string;
  user_id: string;
  agent_id?: string;
  issued_at: number;
  scope?: string[];
}

export interface IdentityProviderOptions {
  /** HMAC secret. Must match memory-service `SERVICE_TOKEN_SECRET`. */
  secret: string;
  /** Default agent_id to inject when callers don't pass one. */
  defaultAgentId?: string;
  /** Default scope claims. Server presently ignores scope content. */
  defaultScope?: string[];
}

/**
 * Mints short-lived (5 min) tokens. Caller is responsible for renewing
 * before expiry; we don't cache anything because tokens are cheap to produce.
 */
export class IdentityProvider {
  constructor(private readonly opts: IdentityProviderOptions) {
    if (!opts.secret) throw new Error("IdentityProvider requires a non-empty secret");
  }

  sign(input: { business_id: string; user_id: string; agent_id?: string; scope?: string[] }): string {
    const identity: Identity = {
      business_id: input.business_id,
      user_id: input.user_id,
      agent_id: input.agent_id ?? this.opts.defaultAgentId,
      issued_at: Math.floor(Date.now() / 1000),
      scope: input.scope ?? this.opts.defaultScope ?? []
    };
    const payload = Buffer.from(JSON.stringify(identity), "utf8").toString("base64url");
    const sig = createHmac("sha256", this.opts.secret).update(payload).digest("base64url");
    return `${payload}.${sig}`;
  }
}
