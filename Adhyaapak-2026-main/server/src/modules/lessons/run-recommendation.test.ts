import { describe, expect, it } from "vitest";
import { recommendFromCheck, type CheckFacts } from "./run-recommendation";

const q = (answered: number, correct: number, patternCount = 0) => ({
  answered,
  correct,
  options: [
    { count: correct, pattern: null },
    { count: patternCount, pattern: patternCount ? "Adds the denominators" : null },
    { count: answered - correct - patternCount, pattern: null },
  ],
});
const facts = (over: Partial<CheckFacts> & { questions: CheckFacts["questions"] }): CheckFacts => ({ answered: 20, studentCount: 30, ...over });

describe("recommendFromCheck", () => {
  it("gives no advice until someone has answered", () => {
    expect(recommendFromCheck(facts({ answered: 0, questions: [q(0, 0)] }))).toBeNull();
  });

  it("refuses to decide on too few answers, and says how many", () => {
    const r = recommendFromCheck(facts({ answered: 2, studentCount: 30, questions: [q(2, 2)] }))!;
    expect(r.action).toBe("need_more_evidence");
    expect(r.sufficiency).toBe("none");
    expect(r.reason).toContain("2 of 30");
    // Enough to start, but under a quarter of the class: still thin.
    expect(recommendFromCheck(facts({ answered: 5, studentCount: 30, questions: [q(5, 5)] }))!.sufficiency).toBe("thin");
  });

  it("recommends re-teaching when an error pattern is common, naming the pattern and the counts", () => {
    const r = recommendFromCheck(facts({ questions: [q(20, 10, 8)] }))!;
    expect(r.action).toBe("reteach");
    expect(r.headline).toContain("Adds the denominators");
    expect(r.reason).toContain("8 of 20");
    expect(r.teacherReviewRequired).toBe(true);
  });

  it("does not call a single odd pattern a class-wide problem", () => {
    const r = recommendFromCheck(facts({ questions: [q(20, 18, 2)] }))!;
    expect(r.action).toBe("move_on");
  });

  it("moves on at 80% correct, advises practice from 60%, and re-teaches below that", () => {
    expect(recommendFromCheck(facts({ questions: [q(20, 16)] }))!.action).toBe("move_on");
    expect(recommendFromCheck(facts({ questions: [q(20, 13)] }))!.action).toBe("practise");
    expect(recommendFromCheck(facts({ questions: [q(20, 8)] }))!.action).toBe("reteach");
  });
});
