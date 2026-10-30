import { describe, expect, it } from "vitest";
import type { RunState } from "@adhyaapak/shared";
import { allowedEvents, transition, type RunEvent } from "./run-machine";

const STATES: RunState[] = ["not_started", "teaching", "checking", "paused", "needs_wrap", "done"];
const EVENTS: RunEvent[] = ["start", "start_check", "finish_check", "wrap", "pause", "resume"];
/** Position in the lesson; a paused check is at the same point as a running one. */
const RANK: Record<RunState, number> = { not_started: 0, teaching: 1, checking: 2, paused: 2, needs_wrap: 3, done: 4 };

describe("lesson session state machine", () => {
  it("follows the happy path", () => {
    let s: RunState = "not_started";
    for (const [event, to] of [["start", "teaching"], ["start_check", "checking"], ["finish_check", "needs_wrap"], ["wrap", "done"]] as const) {
      const m = transition(s, event);
      expect(m).toMatchObject({ ok: true, to, noop: false });
      s = to;
    }
  });

  it("lets a lesson be wrapped up without a check, and a check start the lesson", () => {
    expect(transition("teaching", "wrap")).toMatchObject({ ok: true, to: "done" });
    expect(transition("not_started", "start_check")).toMatchObject({ ok: true, to: "checking" });
  });

  it("refuses impossible moves with a reason a teacher can act on", () => {
    expect(transition("checking", "wrap")).toEqual({ ok: false, message: "Finish the check before wrapping up, so its answers are counted." });
    expect(transition("teaching", "finish_check")).toMatchObject({ ok: false });
    expect(transition("done", "start_check")).toMatchObject({ ok: false });
    expect((transition("done", "start_check") as { message: string }).message).toMatch(/already wrapped up/);
  });

  it("treats repeats as no-ops, so a double click or a retried request is harmless", () => {
    expect(transition("teaching", "start")).toMatchObject({ ok: true, noop: true });
    expect(transition("checking", "start_check")).toMatchObject({ ok: true, noop: true });
    expect(transition("done", "wrap")).toMatchObject({ ok: true, noop: true });
    expect(transition("needs_wrap", "finish_check")).toMatchObject({ ok: true, noop: true });
  });

  it("never moves backwards: no allowed move leaves a state earlier in the order", () => {
    for (const from of STATES) {
      for (const e of EVENTS) {
        const m = transition(from, e);
        if (m.ok) expect(RANK[m.to]).toBeGreaterThanOrEqual(RANK[from]);
      }
    }
  });

  it("pauses and resumes only a running check, and a paused check can still be finished", () => {
    expect(transition("checking", "pause")).toMatchObject({ ok: true, to: "paused", noop: false });
    expect(transition("paused", "resume")).toMatchObject({ ok: true, to: "checking", noop: false });
    expect(transition("paused", "pause")).toMatchObject({ ok: true, noop: true });
    expect(transition("checking", "resume")).toMatchObject({ ok: true, noop: true });
    expect(transition("paused", "finish_check")).toMatchObject({ ok: true, to: "needs_wrap" });
    expect(transition("paused", "wrap")).toMatchObject({ ok: false });
    for (const from of ["not_started", "teaching", "needs_wrap", "done"] as const) {
      expect(transition(from, "pause")).toMatchObject({ ok: false });
      expect(transition(from, "resume")).toMatchObject({ ok: false });
    }
  });

  it("is total: every state and event has an answer, and 'done' can only be repeated", () => {
    for (const from of STATES) for (const e of EVENTS) expect(transition(from, e)).toHaveProperty("ok");
    expect(allowedEvents("done").every((e) => (transition("done", e) as { noop: boolean }).noop)).toBe(true);
  });
});
