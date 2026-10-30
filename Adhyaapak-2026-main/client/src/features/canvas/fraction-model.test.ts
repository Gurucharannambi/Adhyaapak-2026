import { describe, expect, it } from "vitest";
import { EXERCISES, INITIAL, answerOf, check, compare, equivalent, equivalentsOf, maxMultiplier, reduce, scale, simplify, stepsFor, validate } from "./fraction-model";

describe("fraction model", () => {
  it("decides equality by cross-multiplication, exactly", () => {
    expect(equivalent({ n: 1, d: 2 }, { n: 4, d: 8 })).toBe(true);
    expect(equivalent({ n: 2, d: 3 }, { n: 3, d: 4 })).toBe(false);
    expect(equivalent({ n: 0, d: 5 }, { n: 0, d: 7 })).toBe(true);
    expect(compare({ n: 1, d: 3 }, { n: 2, d: 5 })).toBe(-1);
    expect(compare({ n: 3, d: 6 }, { n: 1, d: 2 })).toBe(0);
  });

  it("scaling keeps the amount: every k gives an equivalent fraction", () => {
    for (const f of [{ n: 1, d: 2 }, { n: 2, d: 3 }, { n: 3, d: 4 }, { n: 5, d: 6 }]) {
      for (let k = 1; k <= 6; k++) expect(equivalent(f, scale(f, k))).toBe(true);
    }
    expect(simplify({ n: 6, d: 8 })).toEqual({ n: 3, d: 4 });
  });

  it("rejects what the canvas cannot show and says why", () => {
    expect(validate({ n: 1, d: 2 })).toEqual({ ok: true });
    expect(validate({ n: 1, d: 0 })).toEqual({ ok: false, reason: "denominator_small" });
    expect(validate({ n: 1, d: 13 })).toEqual({ ok: false, reason: "denominator_large" });
    expect(validate({ n: -1, d: 4 })).toEqual({ ok: false, reason: "numerator_negative" });
    expect(validate({ n: 5, d: 4 })).toEqual({ ok: false, reason: "numerator_large" });
    expect(validate({ n: 1.5, d: 4 })).toEqual({ ok: false, reason: "not_whole" });
  });

  it("only offers multipliers whose result still fits", () => {
    expect(maxMultiplier({ n: 1, d: 2 })).toBe(6);
    expect(maxMultiplier({ n: 1, d: 5 })).toBe(2);
    expect(maxMultiplier({ n: 1, d: 12 })).toBe(1);
    expect(equivalentsOf({ n: 1, d: 2 }).map((f) => f.d)).toEqual([2, 4, 6, 8, 10, 12]);
  });

  it("explains each step with numbers that are true of the model", () => {
    const steps = stepsFor({ n: 2, d: 3 }, 4);
    expect(steps.join(" ")).toContain("3 × 4 = 12");
    expect(steps.join(" ")).toContain("2 × 4 = 8");
    expect(steps.join(" ")).toContain("2/3 = 8/12");
    expect(stepsFor({ n: 2, d: 3 }, 1)).toHaveLength(2);
  });
});

describe("exercises", () => {
  it("marks answers by equivalence, and tells an invalid entry from a wrong one", () => {
    const p1 = EXERCISES.find((e) => e.id === "p1")!;
    expect(check(p1, "2").status).toBe("correct");
    expect(check(p1, "3").status).toBe("wrong");
    expect(check(p1, "").status).toBe("invalid");
    expect(check(p1, "1.5").status).toBe("invalid");
    expect(check(p1, "-2").status).toBe("invalid");
    const p3 = EXERCISES.find((e) => e.id === "p3")!;
    expect(check(p3, "12").status).toBe("correct");
    expect(check(p3, "0").status).toBe("invalid");
  });

  it("derives every stored answer from the model, so no exercise can have a wrong key", () => {
    for (const ex of EXERCISES) {
      expect(Number.isInteger(answerOf(ex)), ex.id).toBe(true);
      expect(check(ex, String(answerOf(ex))).status, ex.id).toBe("correct");
      expect(check(ex, String(answerOf(ex) + 1)).status, ex.id).toBe("wrong");
    }
    // The shrinking case works too: 4/10 = 2/5.
    expect(answerOf(EXERCISES.find((e) => e.id === "c2")!)).toBe(5);
  });
});

describe("canvas state", () => {
  it("changing the fraction resets explanation steps and keeps the multiplier in range", () => {
    let s = reduce(INITIAL, { type: "revealNext" });
    expect(s.revealed).toBe(1);
    s = reduce(s, { type: "setBase", base: { n: 1, d: 5 } });
    expect(s.revealed).toBe(0);
    expect(s.k).toBe(2); // 5 × 2 = 10 fits; a multiplier of 3 would not
    s = reduce(s, { type: "setMultiplier", k: 3 });
    expect(s.k).toBe(2); // refused: 15 parts is more than the canvas shows
  });

  it("ignores invalid input instead of corrupting the canvas", () => {
    expect(reduce(INITIAL, { type: "setBase", base: { n: 7, d: 3 } })).toBe(INITIAL);
    expect(reduce(INITIAL, { type: "setMultiplier", k: 0 })).toBe(INITIAL);
  });

  it("reveals steps one at a time and never past the last", () => {
    let s = INITIAL;
    const total = stepsFor(s.base, s.k).length;
    for (let i = 0; i < total + 3; i++) s = reduce(s, { type: "revealNext" });
    expect(s.revealed).toBe(total);
    expect(reduce(s, { type: "hideSteps" }).revealed).toBe(0);
  });

  it("undo restores the exact previous state, and reset returns to the start", () => {
    const a = reduce(INITIAL, { type: "setBase", base: { n: 2, d: 3 } });
    const b = reduce(a, { type: "setMultiplier", k: 4 });
    const undone = reduce(b, { type: "undo" });
    expect(undone.base).toEqual({ n: 2, d: 3 });
    expect(undone.k).toBe(a.k);
    expect(reduce(INITIAL, { type: "undo" })).toBe(INITIAL);
    expect(reduce(b, { type: "reset" })).toEqual(INITIAL);
  });
});
