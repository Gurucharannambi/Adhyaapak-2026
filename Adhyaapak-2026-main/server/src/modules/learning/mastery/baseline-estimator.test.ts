import type { AssessmentEvidence } from "@adhyaapak/shared";
import { describe, expect, it } from "vitest";
import { withLearningConfig } from "../config";
import { BaselineMasteryEstimator } from "./baseline-estimator";

const NOW = new Date("2026-10-01T10:00:00Z");
let n = 0;
function ev(over: Partial<AssessmentEvidence> & { daysAgo?: number } = {}): AssessmentEvidence {
  const { daysAgo = 0, ...rest } = over;
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    studentId: "00000000-0000-4000-8000-0000000000aa",
    conceptId: "00000000-0000-4000-8000-0000000000bb",
    questionResponseId: "00000000-0000-4000-8000-0000000000cc",
    source: "device_response",
    result: "correct",
    difficulty: 2,
    confidence: "high",
    reviewStatus: "not_required",
    observedAt: new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString(),
    ...rest,
  };
}
const est = new BaselineMasteryEstimator();
const run = (evidence: AssessmentEvidence[]) => est.estimate({ evidence, now: NOW });

describe("BaselineMasteryEstimator — statuses", () => {
  it("no evidence → not enough evidence at the neutral estimate", () => {
    expect(run([])).toMatchObject({ status: "not_enough_evidence", estimate: 0.5, evidenceCount: 0 });
  });

  it("a single correct answer is NOT mastery", () => {
    expect(run([ev()]).status).toBe("not_enough_evidence");
  });

  it("a single wrong answer is NOT a knowledge gap", () => {
    expect(run([ev({ result: "incorrect" })]).status).toBe("not_enough_evidence");
  });

  it("two wrong answers (confident) → needs foundation", () => {
    expect(run([ev({ result: "incorrect", selfConfidence: "sure" }), ev({ result: "incorrect", selfConfidence: "sure" })]).status).toBe("needs_foundation");
  });

  it("one right and one wrong → developing", () => {
    expect(run([ev(), ev({ result: "incorrect" })]).status).toBe("developing");
  });

  it("two correct → developing (needs a third item before 'likely secure')", () => {
    expect(run([ev(), ev()]).status).toBe("developing");
  });

  it("three correct → likely secure", () => {
    expect(run([ev(), ev(), ev()]).status).toBe("likely_secure");
  });

  it("four correct with a hard item → ready for challenge", () => {
    expect(run([ev(), ev(), ev(), ev({ difficulty: 4 })]).status).toBe("ready_for_challenge");
  });

  it("four correct but all easy → stays likely secure (no hard item to justify challenge)", () => {
    expect(run([ev({ difficulty: 1 }), ev({ difficulty: 1 }), ev({ difficulty: 2 }), ev({ difficulty: 2 })]).status).toBe("likely_secure");
  });

  it("a hard correct answer that was a guess does not unlock challenge", () => {
    expect(run([ev(), ev(), ev(), ev({ difficulty: 4, selfConfidence: "guess" })]).status).toBe("likely_secure");
  });

  it("partial credit counts as half", () => {
    const r = est.explain({ evidence: [ev({ result: "partial" }), ev({ result: "partial" })], now: NOW });
    expect(r.contributions.every((c) => c.score === 0.5)).toBe(true);
    expect(r.estimate).toBe(0.5);
  });
});

describe("BaselineMasteryEstimator — evidence rules", () => {
  it("ignores insufficient, pending and rejected evidence (unreviewed results never change mastery)", () => {
    const r = run([
      ev({ result: "insufficient" }),
      ev({ confidence: "low", reviewStatus: "pending" }),
      ev({ reviewStatus: "rejected" }),
      ev({ confidence: "low", reviewStatus: "not_required" }),
    ]);
    expect(r).toMatchObject({ evidenceCount: 0, status: "not_enough_evidence" });
  });

  it("counts low-confidence evidence once a teacher has approved it", () => {
    expect(run([ev({ confidence: "low", reviewStatus: "approved" })]).evidenceCount).toBe(1);
  });

  it("two guessed-correct answers are not enough effective weight", () => {
    expect(run([ev({ selfConfidence: "guess" }), ev({ selfConfidence: "guess" })]).status).toBe("not_enough_evidence");
  });

  it("a confident wrong answer pulls the estimate down more than an unsure one", () => {
    const sure = run([ev(), ev({ result: "incorrect", selfConfidence: "sure" })]).estimate;
    const unsure = run([ev(), ev({ result: "incorrect", selfConfidence: "unsure" })]).estimate;
    expect(sure).toBeLessThan(unsure);
  });

  it("a harder correct answer counts for more than an easy one", () => {
    const hard = run([ev({ difficulty: 5 }), ev({ result: "incorrect" })]).estimate;
    const easy = run([ev({ difficulty: 1 }), ev({ result: "incorrect" })]).estimate;
    expect(hard).toBeGreaterThan(easy);
  });

  it("old evidence fades: three correct answers months ago no longer count as secure", () => {
    expect(run([ev({ daysAgo: 150 }), ev({ daysAgo: 150 }), ev({ daysAgo: 150 })]).status).toBe("not_enough_evidence");
  });

  it("recent evidence outweighs old evidence", () => {
    const improving = run([ev({ result: "incorrect", daysAgo: 60 }), ev({ result: "incorrect", daysAgo: 60 }), ev(), ev(), ev()]);
    const declining = run([ev({ daysAgo: 60 }), ev({ daysAgo: 60 }), ev({ result: "incorrect" }), ev({ result: "incorrect" }), ev({ result: "incorrect" })]);
    expect(improving.estimate).toBeGreaterThan(declining.estimate);
  });

  it("practice activity evidence is weighted below a classroom response", () => {
    const practice = est.explain({ evidence: [ev({ source: "practice_activity" })], now: NOW }).contributions[0]!.weight;
    const classroom = est.explain({ evidence: [ev()], now: NOW }).contributions[0]!.weight;
    expect(practice).toBeLessThan(classroom);
  });
});

describe("BaselineMasteryEstimator — reproducibility and explanation", () => {
  it("gives identical output regardless of input order", () => {
    const list = [ev({ daysAgo: 5 }), ev({ result: "incorrect", daysAgo: 3 }), ev({ difficulty: 4, daysAgo: 1 }), ev({ daysAgo: 9 })];
    expect(run(list)).toEqual(run([...list].reverse()));
  });

  it("is deterministic for the same input", () => {
    const list = [ev(), ev({ result: "incorrect" }), ev()];
    expect(run(list)).toEqual(run(list));
  });

  it("explains every number: contributions reference evidence ids and multiply their factors", () => {
    const list = [ev({ difficulty: 4, selfConfidence: "unsure", daysAgo: 30 })];
    const x = est.explain({ evidence: list, now: NOW });
    const c = x.contributions[0]!;
    expect(c.evidenceId).toBe(list[0]!.id);
    expect(c.factors.decay).toBeCloseTo(0.5, 5);
    expect(c.weight).toBeCloseTo(c.factors.decay * c.factors.difficulty * c.factors.selfConfidence * c.factors.source, 10);
    expect(x.evidenceIds).toEqual([list[0]!.id]);
  });

  it("never lets the estimate leave 0..1", () => {
    const many = Array.from({ length: 200 }, () => ev({ difficulty: 5 }));
    const r = run(many);
    expect(r.estimate).toBeGreaterThan(0.99);
    expect(r.estimate).toBeLessThanOrEqual(1);
    expect(run(many.map((e) => ({ ...e, result: "incorrect" as const }))).estimate).toBeGreaterThanOrEqual(0);
  });

  it("reports the algorithm version so stored results can be recomputed later", () => {
    expect(est.version).toBe("baseline-1.0.0");
  });

  it("thresholds come from config, not code", () => {
    const strict = new BaselineMasteryEstimator(withLearningConfig({ mastery: { thresholds: { secureMinItems: 5 } } }).mastery);
    expect(strict.estimate({ evidence: [ev(), ev(), ev()], now: NOW }).status).toBe("developing");
  });
});
