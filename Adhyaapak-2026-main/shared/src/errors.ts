import { z } from "zod";

/** Error categories from CLAUDE.md §15. The client branches on `code`, never on `message`. */
export const ApiErrorCode = z.enum([
  "validation_error",
  "unauthenticated",
  "forbidden",
  "not_found",
  "conflict",
  "provider_error",
  "processing_failed",
  "rate_limited",
  "network_error",
  "offline",
  "internal_error",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCode>;

export const ApiError = z.object({
  error: z.object({
    code: ApiErrorCode,
    /** Safe, user-facing text. Never a stack trace, SQL detail or raw provider error. */
    message: z.string(),
    details: z
      .array(z.object({ path: z.string(), message: z.string() }))
      .optional(),
  }),
  requestId: z.string(),
});
export type ApiError = z.infer<typeof ApiError>;
