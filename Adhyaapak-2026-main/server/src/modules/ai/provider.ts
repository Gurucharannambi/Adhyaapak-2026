import type { z } from "zod";

export interface StructuredRequest<T> {
  /** Stable name of the workflow, e.g. "question-draft". Used in logs and the run table. */
  workflow: string;
  /** Bump when the prompt changes, so results can be traced to the prompt that produced them. */
  promptVersion: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** Name sent to the provider with the JSON schema. */
  schemaName: string;
  /** Longer limit for big calls. Defaults to the provider's normal timeout. */
  timeoutMs?: number;
  /** Pictures sent with the user message (base64, no data: prefix). Handled only by providers that support vision. */
  images?: Array<{ mimeType: string; base64: string }>;
}

export interface StructuredResult<T> {
  data: T;
  meta: { model: string; durationMs: number; attempts: number; inputTokens?: number; outputTokens?: number };
}

/**
 * The only thing the rest of the app knows about AI. Provider details (Mesh, LangChain, request
 * shapes) stay behind this interface, so features can be tested with a fake and run with AI off.
 */
export interface LlmProvider {
  /** False when AI is switched off or not configured. Callers show a clear "unavailable" state. */
  readonly available: boolean;
  readonly model: string;
  generate<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
}
