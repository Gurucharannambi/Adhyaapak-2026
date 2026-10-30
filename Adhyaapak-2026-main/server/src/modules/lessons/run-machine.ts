import type { RunState } from "@adhyaapak/shared";

/**
 * The lesson session as an explicit state machine. The state itself is derived from stored records (see
 * `deriveState` in run.service.ts); this table says which moves are allowed from each state, so an impossible request
 * (for example starting a new check after the lesson is wrapped up) is refused with a clear reason instead of
 * silently corrupting the record.
 *
 *   not_started → teaching → checking ⇄ paused → needs_wrap → done
 *                    └──────────────────────────────────────┘ (a lesson can be wrapped up without a check)
 *
 * "paused" belongs to a running check only (an interruption, an assembly): students' devices stop accepting answers until
 * the teacher resumes. Paper answers keyed by the teacher are still accepted, and the check can be finished from paused.
 */
export type RunEvent = "start" | "start_check" | "finish_check" | "wrap" | "pause" | "resume";

type Move = { ok: true; to: RunState; /** The request changes nothing: it repeats something already done. */ noop: boolean } | { ok: false; message: string };

const TABLE: Record<RunState, Partial<Record<RunEvent, Move>>> = {
  not_started: {
    start: { ok: true, to: "teaching", noop: false },
    // Starting a check also starts the lesson, so "Check" can be the first thing a teacher opens.
    start_check: { ok: true, to: "checking", noop: false },
    finish_check: { ok: false, message: "No check has been started for this lesson today." },
    wrap: { ok: true, to: "done", noop: false },
  },
  teaching: {
    start: { ok: true, to: "teaching", noop: true },
    start_check: { ok: true, to: "checking", noop: false },
    finish_check: { ok: false, message: "No check has been started for this lesson today." },
    wrap: { ok: true, to: "done", noop: false },
  },
  checking: {
    start: { ok: true, to: "checking", noop: true },
    start_check: { ok: true, to: "checking", noop: true },
    finish_check: { ok: true, to: "needs_wrap", noop: false },
    wrap: { ok: false, message: "Finish the check before wrapping up, so its answers are counted." },
    pause: { ok: true, to: "paused", noop: false },
    resume: { ok: true, to: "checking", noop: true },
  },
  paused: {
    start: { ok: true, to: "paused", noop: true },
    start_check: { ok: true, to: "paused", noop: true },
    finish_check: { ok: true, to: "needs_wrap", noop: false },
    wrap: { ok: false, message: "Finish the check before wrapping up, so its answers are counted." },
    pause: { ok: true, to: "paused", noop: true },
    resume: { ok: true, to: "checking", noop: false },
  },
  needs_wrap: {
    start: { ok: true, to: "needs_wrap", noop: true },
    start_check: { ok: true, to: "needs_wrap", noop: true },
    finish_check: { ok: true, to: "needs_wrap", noop: true },
    wrap: { ok: true, to: "done", noop: false },
  },
  done: {
    start: { ok: true, to: "done", noop: true },
    start_check: { ok: false, message: "This lesson is already wrapped up. Reopening it is not supported, so start a new check from the next lesson." },
    finish_check: { ok: true, to: "done", noop: true },
    wrap: { ok: true, to: "done", noop: true },
  },
};

export function transition(from: RunState, event: RunEvent): Move {
  return TABLE[from][event] ?? { ok: false, message: `That cannot be done while the lesson is ${from.replace("_", " ")}.` };
}

/** Every move the machine allows, for tests and documentation. */
export const allowedEvents = (from: RunState): RunEvent[] => (Object.keys(TABLE[from]) as RunEvent[]).filter((e) => TABLE[from][e]?.ok);
