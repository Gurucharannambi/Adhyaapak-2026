import { ChatOpenAI } from "@langchain/openai";
import type { Logger } from "pino";
import type { z } from "zod";
import type { AppConfig } from "../../config";
import { AiError, aiError, classifyProviderError } from "./errors";
import type { LlmProvider, StructuredRequest, StructuredResult } from "./provider";
import { SlidingWindowLimiter } from "./rate-limiter";

export type ChatMessage =
  | [string, string]
  | { role: string; content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> };

/** The slice of a LangChain chat model this adapter needs. Lets tests supply a stand-in. */
export interface StructuredChat {
  withStructuredOutput<T>(schema: z.ZodType<T>, options: { name: string; method: "jsonSchema" }): {
    invoke(messages: ChatMessage[], options?: { signal?: AbortSignal }): Promise<T>;
  };
}

export interface MeshProviderOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  /** Model used for requests that carry images. Defaults to `model`. */
  visionModel?: string;
  timeoutMs: number;
  maxRetries: number;
  logger: Logger;
  /** Under Mesh's default 100 requests/minute per key, with headroom. */
  requestsPerMinute?: number;
  chatFactory?: (model: string) => StructuredChat;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  limiter?: SlidingWindowLimiter;
}

const sleepReal = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Mesh API through LangChain's OpenAI client (Mesh is OpenAI-compatible; verified in docs/DECISIONS.md).
 * Behaviour that matters:
 *  - temperature 0 and strict JSON-schema output, then our own Zod validation of whatever came back;
 *  - a hard timeout per attempt, and retries only for failures that can succeed later
 *    (timeouts, 429, 5xx, network), with exponential backoff and jitter;
 *  - bad output gets one extra try, then a clear error. Nothing unvalidated is ever returned;
 *  - provider messages never reach callers, and logs carry metadata only (no prompts, no key).
 */
export class MeshProvider implements LlmProvider {
  readonly available = true;
  readonly model: string;
  private readonly chat: StructuredChat;
  private visionChat: StructuredChat | undefined;
  private readonly limiter: SlidingWindowLimiter;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(private readonly opts: MeshProviderOptions) {
    this.model = opts.model;
    this.sleep = opts.sleep ?? sleepReal;
    this.random = opts.random ?? Math.random;
    this.limiter = opts.limiter ?? new SlidingWindowLimiter(opts.requestsPerMinute ?? 80, 60_000, Date.now, this.sleep);
    this.chat = this.makeChat(opts.model);
  }

  private makeChat(model: string): StructuredChat {
    return (
      this.opts.chatFactory?.(model) ??
      (new ChatOpenAI({
        model,
        apiKey: this.opts.apiKey,
        configuration: { baseURL: this.opts.baseUrl },
        temperature: 0,
        // We run our own bounded retries so that every attempt is counted and logged.
        maxRetries: 0,
        // Our own per-request abort is the real limit; this one is only a safety net, so it is generous.
        timeout: Math.max(this.opts.timeoutMs, 180_000),
      }) as unknown as StructuredChat)
    );
  }

  async generate<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const started = Date.now();
    const maxAttempts = this.opts.maxRetries + 1;
    let invalidOutputs = 0;
    let lastError: AiError | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!(await this.limiter.acquire())) {
        lastError = aiError("rate_limited");
        break;
      }
      try {
        const data = await this.callOnce(req);
        const durationMs = Date.now() - started;
        this.opts.logger.info({ workflow: req.workflow, promptVersion: req.promptVersion, model: this.model, durationMs, attempts: attempt }, "ai call ok");
        return { data, meta: { model: this.model, durationMs, attempts: attempt } };
      } catch (raw) {
        const err = classifyProviderError(raw);
        lastError = err;
        // Bad output: one extra try is enough; repeating forever would only burn credit.
        if (err.code === "invalid_output") {
          invalidOutputs++;
          if (invalidOutputs > 1) break;
        } else if (!err.retryable) break;
        this.opts.logger.warn({ workflow: req.workflow, model: this.model, attempt, code: err.code, status: err.status, providerRequestId: err.requestId }, "ai call failed, may retry");
        if (attempt < maxAttempts) await this.sleep(this.backoffMs(attempt, raw));
      }
    }

    const final = lastError ?? aiError("provider_error");
    this.opts.logger.error({ workflow: req.workflow, model: this.model, code: final.code, status: final.status, providerRequestId: final.requestId, durationMs: Date.now() - started }, "ai call gave up");
    throw Object.assign(final, { attempts: maxAttempts });
  }

  private async callOnce<T>(req: StructuredRequest<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? this.opts.timeoutMs);
    try {
      const withImages = !!req.images?.length;
      const chat = withImages ? (this.visionChat ??= this.makeChat(this.opts.visionModel ?? this.opts.model)) : this.chat;
      const structured = chat.withStructuredOutput(req.schema, { name: req.schemaName, method: "jsonSchema" });
      const messages: ChatMessage[] = [
        ["system", req.system],
        withImages
          ? { role: "user", content: [{ type: "text", text: req.user }, ...req.images!.map((i) => ({ type: "image_url" as const, image_url: { url: `data:${i.mimeType};base64,${i.base64}` } }))] }
          : ["human", req.user],
      ];
      const out = await structured.invoke(messages, { signal: controller.signal });
      // Do not trust the client library's parsing: validate against our own schema again.
      const parsed = req.schema.safeParse(out);
      if (!parsed.success) throw aiError("invalid_output", { retryable: true });
      return parsed.data;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Exponential backoff with jitter; a Retry-After header (seconds) from a 429 wins when present. */
  private backoffMs(attempt: number, raw: unknown): number {
    const headers = (raw as { headers?: Record<string, string> | { get?: (k: string) => string | null } })?.headers;
    const header = headers && typeof (headers as { get?: unknown }).get === "function" ? (headers as { get: (k: string) => string | null }).get("retry-after") : (headers as Record<string, string> | undefined)?.["retry-after"];
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 10_000);
    const base = Math.min(500 * 2 ** (attempt - 1), 4_000);
    return Math.round(base * (0.75 + this.random() * 0.5));
  }
}

/** Used when AI is switched off or no key is set. Calling it fails fast with a friendly message. */
export class UnavailableProvider implements LlmProvider {
  readonly available = false;
  readonly model = "none";
  async generate<T>(_req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    throw aiError("unavailable");
  }
}

export function createProvider(config: AppConfig, logger: Logger): LlmProvider {
  if (!config.AI_ENABLED || !config.MESH_API_KEY) return new UnavailableProvider();
  return new MeshProvider({
    baseUrl: config.MESH_API_BASE_URL,
    apiKey: config.MESH_API_KEY,
    model: config.MESH_API_MODEL,
    visionModel: config.MESH_API_VISION_MODEL,
    timeoutMs: config.MESH_API_TIMEOUT_MS,
    maxRetries: config.MESH_API_MAX_RETRIES,
    logger,
  });
}
