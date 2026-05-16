import type { JsonValue } from "../types/agent-contracts.js";

export class FetchJsonError extends Error {
  status: number;
  payload: JsonValue;

  constructor(url: string, status: number, payload: JsonValue) {
    super(`HTTP ${status} for ${url}`);
    this.name = "FetchJsonError";
    this.status = status;
    this.payload = payload;
  }
}

export async function fetchJson<T = JsonValue>(url: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, options);
  const text = await response.text();
  const payload = parseResponsePayload(text);

  if (!response.ok) {
    throw new FetchJsonError(url, response.status, payload);
  }

  return payload as T;
}

function parseResponsePayload(text: string): JsonValue {
  try {
    return text ? JSON.parse(text) as JsonValue : {};
  } catch {
    return { raw: text };
  }
}
