import type { MasteryStatus } from "@adhyaapak/shared";
import { describe, expect, it } from "vitest";
import { evaluateIntervention } from "./effectiveness";

const st = (status: MasteryStatus, estimate = 0.5) => ({ status, estimate });
const run = (before: ReturnType<typeof st>, after: ReturnType<typeof st>, newEvidenceCount = 3) => evaluateIntervention({ before, after, newEvidenceCount }).outcome;

describe("evaluateIntervention", () => {
  it("never claims improvement from fewer than two new counted answers", () => {
    expect(run(st("needs_foundation", 0.2), st("likely_secure", 0.9), 1)).toBe("not_enough_evidence");
    expect(run(st("needs_foundation", 0.2), st("likely_secure", 0.9), 0)).toBe("not_enough_evidence");
    expect(evaluateIntervention({ before: st("developing"), after: st("developing"), newEvidenceCount: 1 }).explanation).toMatch(/Only 1 new counted answer since/);
  });

  it("improved when the status moves up", () => {
    expect(run(st("needs_foundation", 0.2), st("developing", 0.6))).toBe("improved");
    expect(run(st("developing"), st("ready_for_challenge", 0.9))).toBe("improved");
  });

  it("declined when the status moves down", () => {
    expect(run(st("likely_secure", 0.8), st("developing", 0.55))).toBe("declined");
  });

  it("uses the estimate only when the status did not move, and only past the threshold", () => {
    expect(run(st("developing", 0.45), st("developing", 0.66))).toBe("improved");
    expect(run(st("developing", 0.66), st("developing", 0.45))).toBe("declined");
    expect(run(st("developing", 0.5), st("developing", 0.55))).toBe("no_change");
  });

  it("does not treat 'not enough evidence' as the bottom of the scale", () => {
    expect(run(st("not_enough_evidence"), st("developing", 0.6))).toBe("evidence_gathered");
    expect(run(st("not_enough_evidence"), st("needs_foundation", 0.2))).toBe("evidence_gathered");
  });

  it("says 'not enough evidence' if recent answers have faded to no status", () => {
    expect(run(st("developing"), st("not_enough_evidence"))).toBe("not_enough_evidence");
  });

  it("is deterministic and always explains itself", () => {
    const a = evaluateIntervention({ before: st("developing", 0.5), after: st("likely_secure", 0.8), newEvidenceCount: 4 });
    expect(a).toEqual(evaluateIntervention({ before: st("developing", 0.5), after: st("likely_secure", 0.8), newEvidenceCount: 4 }));
    expect(a.explanation.length).toBeGreaterThan(10);
  });
});
