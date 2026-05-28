import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import { loadConfig } from "../config/env.js";
import { HttpError } from "./errors.js";

const cfg = loadConfig();

export const IdentitySchema = z.object({
  business_id: z.string().min(1).max(120),
  user_id: z.string().min(1).max(120),
  agent_id: z.string().min(1).max(120).optional(),
  issued_at: z.number().int().positive(),
  scope: z.array(z.string()).default([])
});

export type Identity = z.infer<typeof IdentitySchema>;

const IDENTITY_TTL_SECONDS = 5 * 60;

export function signIdentity(identity: Identity): string {
  const payload = Buffer.from(JSON.stringify(identity), "utf8").toString("base64url");
  const sig = createHmac("sha256", cfg.SERVICE_TOKEN_SECRET).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyIdentity(token: string | undefined): Identity {
  if (!token) throw HttpError.unauthorized("missing identity header");
  const dot = token.indexOf(".");
  if (dot <= 0) throw HttpError.unauthorized("malformed identity token");

  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = createHmac("sha256", cfg.SERVICE_TOKEN_SECRET).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw HttpError.unauthorized("identity signature mismatch");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    throw HttpError.unauthorized("identity payload is not valid JSON");
  }
  const result = IdentitySchema.safeParse(parsed);
  if (!result.success) throw HttpError.unauthorized("identity payload schema invalid");

  const ageSec = Math.abs(Date.now() / 1000 - result.data.issued_at);
  if (ageSec > IDENTITY_TTL_SECONDS) {
    throw HttpError.unauthorized("identity token expired");
  }
  return result.data;
}

declare module "fastify" {
  interface FastifyRequest {
    identity: Identity;
  }
}

export function requireIdentity(request: FastifyRequest): Identity {
  const headerName = cfg.SERVICE_TOKEN_HEADER.toLowerCase();
  const raw = request.headers[headerName];
  const token = Array.isArray(raw) ? raw[0] : raw;
  return verifyIdentity(token);
}
