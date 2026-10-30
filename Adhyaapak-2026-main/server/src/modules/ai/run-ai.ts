import type { z } from "zod";
import type { Db } from "../../db/client";
import { aiRuns } from "../../db/schema";
import type { Actor } from "../auth/permissions";
import { AiError, toAppError } from "./errors";
import type { LlmProvider, StructuredRequest } from "./provider";

/**
 * Runs one AI call and records it in `ai_runs` (metadata only). On failure the error is converted to
 * a safe, user-facing one; the provider's own text never leaves this function.
 */
export async function runAi<T>(db: Db, ai: LlmProvider, actor: Actor, conceptId: string | null, req: StructuredRequest<T> & { schema: z.ZodType<T> }): Promise<T> {
  const started = Date.now();
  try {
    const r = await ai.generate(req);
    await db.insert(aiRuns).values({ userId: actor.id, workflow: req.workflow, promptVersion: req.promptVersion, model: r.meta.model, conceptId, status: "ok", durationMs: r.meta.durationMs, attempts: r.meta.attempts });
    return r.data;
  } catch (err) {
    await db
      .insert(aiRuns)
      .values({ userId: actor.id, workflow: req.workflow, promptVersion: req.promptVersion, model: ai.model, conceptId, status: "failed", errorCode: err instanceof AiError ? err.code : "unknown", durationMs: Date.now() - started, attempts: (err as { attempts?: number }).attempts ?? 1 })
      .catch(() => undefined); // never let bookkeeping hide the real failure
    throw toAppError(err);
  }
}
