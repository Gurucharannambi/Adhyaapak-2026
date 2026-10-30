import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { AppConfig } from "../../config";
import { AiError, classifyProviderError, toAppError } from "./errors";
import { MeshProvider, UnavailableProvider, createProvider, type StructuredChat } from "./mesh-provider";
import { SlidingWindowLimiter } from "./rate-limiter";

const Schema = z.object({ answer: z.string().min(1) });
const request = { workflow: "test", promptVersion: "v1", system: "SYSTEM PROMPT TEXT", user: "USER PROMPT TEXT", schema: Schema, schemaName: "test" };

type Step = unknown | ((signal?: AbortSignal) => Promise<unknown>);
/** A chat stand-in that plays back scripted outcomes: values are returned, Error instances are thrown. */
function chatWith(steps: Step[]) {
  let calls = 0;
  const chat: StructuredChat = {
    withStructuredOutput: () => ({
      invoke: async (_m, opts) => {
        const step = steps[Math.min(calls++, steps.length - 1)];
        if (typeof step === "function") return (await (step as (s?: AbortSignal) => Promise<unknown>)(opts?.signal)) as never;
        if (step instanceof Error) throw step;
        return step as never;
      },
    }),
  };
  return { chat, calls: () => calls };
}

function logs() {
  const lines: unknown[] = [];
  const logger = { info: (o: unknown) => lines.push(o), warn: (o: unknown) => lines.push(o), error: (o: unknown) => lines.push(o) } as never;
  return { logger, lines };
}

const httpError = (status: number, extra: Record<string, unknown> = {}) => Object.assign(new Error(`HTTP ${status} PROVIDER SECRET DETAIL sk-live-123`), { status, ...extra });

function provider(steps: Step[], over: Partial<ConstructorParameters<typeof MeshProvider>[0]> = {}) {
  const { chat, calls } = chatWith(steps);
  const sleeps: number[] = [];
  const log = logs();
  const p = new MeshProvider({
    baseUrl: "https://example.test/v1", apiKey: "sk-live-123", model: "test/model", timeoutMs: 1000, maxRetries: 2, logger: log.logger,
    chatFactory: () => chat, sleep: async (ms) => void sleeps.push(ms), random: () => 0.5, ...over,
  });
  return { p, calls, sleeps, log };
}

describe("MeshProvider", () => {
  it("sends pictures to the vision model as image parts, and never logs them", async () => {
    const seen: Array<{ model: string; messages: unknown[] }> = [];
    const factory = (model: string): StructuredChat => ({
      withStructuredOutput: () => ({ invoke: async (messages) => (seen.push({ model, messages }), { answer: "seen" } as never) }),
    });
    const log = logs();
    const p = new MeshProvider({ baseUrl: "https://example.test/v1", apiKey: "k", model: "text/model", visionModel: "vision/model", timeoutMs: 1000, maxRetries: 0, logger: log.logger, chatFactory: factory });
    await p.generate(request);
    await p.generate({ ...request, images: [{ mimeType: "image/png", base64: "QUJD" }] });
    expect(seen[0]!.model).toBe("text/model");
    expect(seen[1]!.model).toBe("vision/model");
    expect(seen[1]!.messages[1]).toEqual({
      role: "user",
      content: [{ type: "text", text: "USER PROMPT TEXT" }, { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } }],
    });
    expect(JSON.stringify(log.lines)).not.toContain("QUJD");
  });

  it("returns validated data with metadata, and logs only metadata (no prompts, no key)", async () => {
    const { p, log } = provider([{ answer: "hello" }]);
    const r = await p.generate(request);
    expect(r.data).toEqual({ answer: "hello" });
    expect(r.meta).toMatchObject({ model: "test/model", attempts: 1 });
    const text = JSON.stringify(log.lines);
    expect(text).toContain("test"); // workflow name is logged
    for (const secret of ["SYSTEM PROMPT", "USER PROMPT", "sk-live-123"]) expect(text).not.toContain(secret);
  });

  it("retries a transient server error with backoff, then succeeds", async () => {
    const { p, calls, sleeps } = provider([httpError(503), { answer: "ok" }]);
    const r = await p.generate(request);
    expect(r.meta.attempts).toBe(2);
    expect(calls()).toBe(2);
    expect(sleeps).toEqual([500]); // base delay with neutral jitter
  });

  it("backs off exponentially across attempts", async () => {
    const { p, sleeps } = provider([httpError(500), httpError(502), { answer: "ok" }]);
    await p.generate(request);
    expect(sleeps).toEqual([500, 1000]);
  });

  it("obeys Retry-After on a 429", async () => {
    const { p, sleeps } = provider([httpError(429, { headers: { "retry-after": "3" } }), { answer: "ok" }]);
    await p.generate(request);
    expect(sleeps).toEqual([3000]);
  });

  it("retries network failures", async () => {
    const { p, calls } = provider([new Error("fetch failed ECONNRESET"), { answer: "ok" }]);
    await p.generate(request);
    expect(calls()).toBe(2);
  });

  it.each([
    [400, "provider_error"],
    [401, "account"],
    [402, "account"],
    [403, "account"],
    [422, "provider_error"],
  ])("does not retry a %i (the same request would fail the same way)", async (status, code) => {
    const { p, calls, sleeps } = provider([httpError(status)]);
    await expect(p.generate(request)).rejects.toMatchObject({ code });
    expect(calls()).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it("gives up after the configured number of retries and says the AI service had a problem", async () => {
    const { p, calls } = provider([httpError(503)], { maxRetries: 2 });
    const err = (await p.generate(request).catch((e: unknown) => e)) as AiError;
    expect(err).toBeInstanceOf(AiError);
    expect(err.code).toBe("provider_error");
    expect(calls()).toBe(3);
  });

  it("never exposes the provider's message to callers or logs", async () => {
    const { p, log } = provider([httpError(500)], { maxRetries: 0 });
    const err = (await p.generate(request).catch((e) => e)) as AiError;
    for (const text of [err.message, err.userMessage, toAppError(err).message, JSON.stringify(log.lines)]) {
      expect(text).not.toMatch(/SECRET DETAIL|sk-live/);
    }
  });

  it("maps a request that takes too long to a timeout error, and retries it", async () => {
    const hang = (signal?: AbortSignal) => new Promise((_, reject) => signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    const { p, calls } = provider([hang], { timeoutMs: 20, maxRetries: 1 });
    await expect(p.generate(request)).rejects.toMatchObject({ code: "timeout" });
    expect(calls()).toBe(2);
  });

  it("allows only one extra try for unusable output, however many retries are configured", async () => {
    const { p, calls } = provider([{ nope: true }], { maxRetries: 5 });
    await expect(p.generate(request)).rejects.toMatchObject({ code: "invalid_output" });
    expect(calls()).toBe(2);
  });

  it("recovers if the second try produces valid output", async () => {
    const { p } = provider([{ answer: "" }, { answer: "fine" }]);
    expect((await p.generate(request)).data).toEqual({ answer: "fine" });
  });

  it("fails fast with rate_limited, without calling the provider, when our own budget is spent", async () => {
    const limiter = { acquire: async () => false } as unknown as SlidingWindowLimiter;
    const { p, calls } = provider([{ answer: "x" }], { limiter });
    await expect(p.generate(request)).rejects.toMatchObject({ code: "rate_limited" });
    expect(calls()).toBe(0);
  });
});

describe("availability", () => {
  const base = { AI_ENABLED: true, MESH_API_KEY: "k", MESH_API_BASE_URL: "https://x.test/v1", MESH_API_MODEL: "m", MESH_API_TIMEOUT_MS: 1000, MESH_API_MAX_RETRIES: 1 } as AppConfig;
  const { logger } = logs();

  it("is unavailable when AI is switched off or there is no key, and fails with a friendly message", async () => {
    for (const cfg of [{ ...base, AI_ENABLED: false }, { ...base, MESH_API_KEY: undefined }]) {
      const p = createProvider(cfg, logger);
      expect(p.available).toBe(false);
      await expect(p.generate(request)).rejects.toMatchObject({ code: "unavailable" });
    }
    expect(await new UnavailableProvider().generate(request).catch((e: AiError) => e.userMessage)).toMatch(/turned off or not set up/);
  });

  it("is available with a key", () => {
    expect(createProvider(base, logger).available).toBe(true);
  });
});

describe("classifyProviderError", () => {
  it.each([
    [{ status: 429 }, "rate_limited", true],
    [{ status: 408 }, "timeout", true],
    [{ status: 504 }, "timeout", true],
    [{ status: 500 }, "provider_error", true],
    [{ status: 401 }, "account", false],
    [{ status: 400 }, "provider_error", false],
    [{ name: "AbortError", message: "aborted" }, "timeout", true],
    [{ message: "fetch failed" }, "provider_error", true],
    [{ name: "OutputParserException", message: "bad json" }, "invalid_output", true],
    [{ message: "something odd" }, "provider_error", false],
  ])("%j → %s (retryable: %s)", (input, code, retryable) => {
    expect(classifyProviderError(input)).toMatchObject({ code, retryable });
  });

  it("keeps an existing AiError unchanged and carries the provider request id", () => {
    const e = classifyProviderError({ status: 502, requestID: "req_123" });
    expect(e.requestId).toBe("req_123");
    expect(classifyProviderError(e)).toBe(e);
  });

  it("turns rate limits into the app's rate_limited error and everything else into provider_error", () => {
    expect(toAppError(classifyProviderError({ status: 429 })).code).toBe("rate_limited");
    expect(toAppError(classifyProviderError({ status: 500 })).code).toBe("provider_error");
    expect(toAppError(new Error("boom")).code).toBe("provider_error");
  });
});

describe("SlidingWindowLimiter", () => {
  it("lets requests through up to the limit, then waits for the window to move", async () => {
    let t = 0;
    const slept: number[] = [];
    const limiter = new SlidingWindowLimiter(2, 1000, () => t, async (ms) => void (slept.push(ms), (t += ms)));
    expect(await limiter.acquire()).toBe(true);
    expect(await limiter.acquire()).toBe(true);
    expect(await limiter.acquire()).toBe(true); // had to wait
    expect(slept).toEqual([1000]);
  });

  it("refuses rather than waiting longer than the cap", async () => {
    const limiter = new SlidingWindowLimiter(1, 60_000, () => 0, vi.fn(async () => undefined));
    expect(await limiter.acquire(1000)).toBe(true);
    expect(await limiter.acquire(1000)).toBe(false);
  });
});
