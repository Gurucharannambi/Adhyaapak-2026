import type { LlmProvider, StructuredRequest, StructuredResult } from "../modules/ai/provider";

type Step = unknown | Error | (() => unknown);

/**
 * A stand-in AI for tests: plays back prepared answers in order (or throws a prepared error) and
 * records every request, so tests can check what the app asked for without calling a real model.
 */
export class ScriptedProvider implements LlmProvider {
  available = true;
  readonly model = "fake/model";
  readonly calls: StructuredRequest<unknown>[] = [];
  private readonly script: Step[];

  constructor(...script: Step[]) {
    this.script = script;
  }

  /** Drops unplayed answers and recorded calls, so one test's leftovers never leak into the next. */
  reset() {
    this.script.length = 0;
    this.calls.length = 0;
    return this;
  }

  queue(...steps: Step[]) {
    this.script.push(...steps);
    return this;
  }

  async generate<T>(req: StructuredRequest<T>): Promise<StructuredResult<T>> {
    this.calls.push(req as StructuredRequest<unknown>);
    const next = this.script.shift();
    if (next === undefined) throw new Error("ScriptedProvider: no more prepared answers");
    if (next instanceof Error) throw next;
    // Run through the same schema the real provider would apply.
    const data = req.schema.parse(typeof next === "function" ? (next as () => unknown)() : next);
    return { data, meta: { model: this.model, durationMs: 1, attempts: 1 } };
  }
}
