export type ErrorCode =
  | "invalid_request"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "upstream_unavailable"
  | "internal_error";

export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "HttpError";
  }

  static badRequest(message: string, details?: Record<string, unknown>): HttpError {
    return new HttpError(400, "invalid_request", message, details);
  }
  static unauthorized(message = "missing or invalid identity"): HttpError {
    return new HttpError(401, "unauthorized", message);
  }
  static forbidden(message = "tenant mismatch"): HttpError {
    return new HttpError(403, "forbidden", message);
  }
  static notFound(message = "resource not found"): HttpError {
    return new HttpError(404, "not_found", message);
  }
  static conflict(message: string, details?: Record<string, unknown>): HttpError {
    return new HttpError(409, "conflict", message, details);
  }
  static rateLimited(message = "rate limit exceeded"): HttpError {
    return new HttpError(429, "rate_limited", message);
  }
  static upstream(message: string): HttpError {
    return new HttpError(502, "upstream_unavailable", message);
  }
}
