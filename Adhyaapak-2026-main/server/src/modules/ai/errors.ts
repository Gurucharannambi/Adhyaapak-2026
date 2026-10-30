import { AppError } from "../../http/errors";

export type AiErrorCode = "unavailable" | "timeout" | "rate_limited" | "provider_error" | "invalid_output" | "account";

/**
 * Failure of an AI call. `code` says what kind; `userMessage` is the only text that may reach a
 * browser. The provider's own message (which may echo prompts or internals) is never exposed.
 */
export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    readonly userMessage: string,
    /** Retrying the identical request might succeed. */
    readonly retryable = false,
    readonly status?: number,
    /** Provider request id, safe to log, handy for support (Mesh error envelope `request_id`). */
    readonly requestId?: string,
  ) {
    super(`${code}${status ? ` (${status})` : ""}`);
    this.name = "AiError";
  }
}

const MESSAGES: Record<AiErrorCode, string> = {
  unavailable: "AI drafting is turned off or not set up. Everything else in Adhyaapak still works.",
  timeout: "The AI took too long to answer. Please try again in a moment.",
  rate_limited: "The AI service is busy right now. Please wait a minute and try again.",
  provider_error: "The AI service had a problem. Please try again in a moment.",
  invalid_output: "The AI gave an answer we could not use, so nothing was saved. Please try again.",
  account: "The AI service is not available for this project right now. Please tell whoever set up Adhyaapak.",
};

export const aiError = (code: AiErrorCode, extra: { retryable?: boolean; status?: number; requestId?: string } = {}) =>
  new AiError(code, MESSAGES[code], extra.retryable ?? false, extra.status, extra.requestId);

/** Converts an AI failure into the app's standard safe error. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AiError) return new AppError(err.code === "rate_limited" ? "rate_limited" : "provider_error", err.userMessage);
  return new AppError("provider_error", MESSAGES.provider_error);
}

/** Maps whatever the HTTP client threw (status, code, message) onto an AiError. Pure, so it is easy to test. */
export function classifyProviderError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  const e = err as { status?: number; code?: string; name?: string; message?: string; headers?: Record<string, string>; requestID?: string; error?: { request_id?: string } } | null;
  const status = typeof e?.status === "number" ? e.status : undefined;
  const requestId = e?.requestID ?? e?.error?.request_id;
  const text = `${e?.name ?? ""} ${e?.code ?? ""} ${e?.message ?? ""}`.toLowerCase();

  if (/timeout|timed out|abort/.test(text) || status === 408 || status === 504) return aiError("timeout", { retryable: true, ...(status ? { status } : {}), ...(requestId ? { requestId } : {}) });
  if (status === 429) return aiError("rate_limited", { retryable: true, status, ...(requestId ? { requestId } : {}) });
  // Bad key, no credit or spend cap hit: retrying never helps and a person must fix it.
  if (status === 401 || status === 402 || status === 403) return aiError("account", { status, ...(requestId ? { requestId } : {}) });
  if (status !== undefined && status >= 500) return aiError("provider_error", { retryable: true, status, ...(requestId ? { requestId } : {}) });
  // 400 / 422: our request was wrong; the same request will fail the same way.
  if (status !== undefined && status >= 400) return aiError("provider_error", { status, ...(requestId ? { requestId } : {}) });
  // No status at all: a network failure (reset, DNS, offline).
  if (/fetch failed|econnreset|econnrefused|enotfound|network|socket|eai_again/.test(text)) return aiError("provider_error", { retryable: true });
  // Output that did not parse against the schema.
  if (/outputparser|parse|schema|json|validation/.test(text)) return aiError("invalid_output", { retryable: true });
  return aiError("provider_error");
}
