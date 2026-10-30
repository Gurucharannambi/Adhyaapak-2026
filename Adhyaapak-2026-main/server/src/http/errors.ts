import type { ApiErrorCode } from "@adhyaapak/shared";

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  validation_error: 400,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  provider_error: 502,
  processing_failed: 422,
  rate_limited: 429,
  network_error: 503,
  offline: 503,
  internal_error: 500,
};

/** An error whose message is safe to show to the user. Anything else becomes a generic 500. */
export class AppError extends Error {
  readonly status: number;

  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = "AppError";
    this.status = STATUS_BY_CODE[code];
  }
}

export const unauthenticated = (message = "Please sign in to continue.") => new AppError("unauthenticated", message);
export const forbidden = (message = "You do not have access to this.") => new AppError("forbidden", message);
export const notFound = (message = "Not found.") => new AppError("not_found", message);
export const conflict = (message: string) => new AppError("conflict", message);
