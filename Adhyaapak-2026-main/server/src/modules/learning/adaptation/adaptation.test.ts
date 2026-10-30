import type { MasteryStatus } from "@adhyaapak/shared";
import { describe, expect, it } from "vitest";
import { ConceptGraph } from "../graph/graph";
import { groupFor, proposeGroups } from "./groups";
import { POLICY_VERSION, recommendNextActivity, type ConceptState, type PastRecommendation } from "./policy";

// multiplication -> equivalent -> common -> adding -> word
const graph = new ConceptGraph(["mult", "equiv", "common", "adding", "word"], [
  { prerequisiteId: "mult", dependentId: "equiv" },
  { prerequisiteId: "equiv", dependentId: "common" },
  { prerequisiteId: "common", dependentId: "adding" },
  { prerequisiteId: "adding", dependentId: "word" },
]);

const st = (status: MasteryStatus, evidenceCount = 4): ConceptState => ({ status, estimate: 0.5, evidenceCount, evidenceIds: Array.from({ length: evidenceCount }, (_, i) => `${status}-${i}`) });
const mastery = (entries: Record<string, ConceptState>) => new Map(Object.entries(entries));
const rec = (m: Record<string, ConceptState>, over: Partial<Parameters<typeof recommendNextActivity>[0]> = {}) =>
  recommendNextActivity({ studentId: "s1", conceptId: "adding", graph, masteryByConcept: mastery(m), ...over });

describe("recommendNextActivity — by status", () => {
  it("no evidence → follow-up assessment, not a judgement", () => {
    const r = rec({});
    expect(r.activity.type).toBe("follow_up_assessment");
    expect(r).toMatchObject({ evidenceSufficiency: "insufficient", uncertainty: "high", teacherReviewRequired: false, policyVersion: POLICY_VERSION });
    expect(r.reason).toMatch(/no reviewed evidence/);
  });

  it("not enough evidence (1 answer) → follow-up assessment, never foundation", () => {
    const r = rec({ adding: st("not_enough_evidence", 1) });
    expect(r.activity.type).toBe("follow_up_assessment");
    expect(r.reason).toMatch(/not enough/);
  });

  it("developing → guided practice", () => {
    expect(rec({ adding: st("developing") }).activity.type).toBe("guided_practice");
  });

  it("likely secure → a later revisit question, not more practice", () => {
    expect(rec({ adding: st("likely_secure") }).activity.type).toBe("revisit_question");
  });

  it("ready for challenge → challenge activity", () => {
    expect(rec({ adding: st("ready_for_challenge", 5) })).toMatchObject({ activity: { type: "challenge_activity" }, uncertainty: "low", evidenceSufficiency: "sufficient" });
  });
});

describe("recommendNextActivity — Case C: prerequisite gaps", () => {
  it("supported gap two levels down → foundation activity on that deeper concept, teacher reviews", () => {
    const r = rec({ adding: st("needs_foundation"), common: st("developing"), equiv: st("needs_foundation") });
    expect(r.activity.type).toBe("foundation_activity");
    expect(r.conceptId).toBe("equiv");
    expect(r.prerequisiteConceptIds).toEqual(["equiv"]);
    expect(r.teacherReviewRequired).toBe(true);
    expect(r.evidenceIds).toEqual(expect.arrayContaining(["needs_foundation-0"]));
  });

  it("picks the deepest supported gap when several prerequisites struggle", () => {
    const r = rec({ adding: st("needs_foundation"), common: st("needs_foundation"), equiv: st("needs_foundation") });
    expect(r.conceptId).toBe("equiv");
    expect(r.prerequisiteConceptIds).toEqual(["common", "equiv"]);
  });

  it("no evidence on prerequisites → probe the nearest one first (a diagnostic, not a label)", () => {
    const r = rec({ adding: st("needs_foundation") });
    expect(r.activity.type).toBe("prerequisite_diagnostic");
    expect(r.conceptId).toBe("common");
    expect(r.prerequisiteConceptIds).toEqual(["common", "equiv"]);
    expect(r.teacherReviewRequired).toBe(false);
  });

  it("prerequisites look fine → foundation work on this concept itself", () => {
    const r = rec({ adding: st("needs_foundation"), common: st("likely_secure"), equiv: st("ready_for_challenge") });
    expect(r).toMatchObject({ activity: { type: "foundation_activity" }, conceptId: "adding", prerequisiteConceptIds: [] });
    expect(r.reason).toMatch(/difficulty seems to be in this concept itself/);
  });

  it("does not look further up than the configured depth", () => {
    const r = rec({ adding: st("needs_foundation"), mult: st("needs_foundation"), common: st("likely_secure"), equiv: st("likely_secure") }, { config: { maxActivityRepeats: 2, maxPrerequisiteDepth: 2 } });
    // mult is 3 levels above 'adding', outside depth 2.
    expect(r.conceptId).toBe("adding");
  });
});

describe("recommendNextActivity — misconceptions", () => {
  it("a corroborated misconception → targeted guided practice with teacher review", () => {
    const r = rec({ adding: st("developing") }, { misconceptions: [{ patternId: "p1", name: "Adds the denominators" }] });
    expect(r.activity.type).toBe("guided_practice");
    expect(r.teacherReviewRequired).toBe(true);
    expect(r.reason).toMatch(/Adds the denominators/);
  });

  it("when foundations are also weak, the prerequisite logic wins and mentions the pattern", () => {
    const r = rec({ adding: st("needs_foundation") }, { misconceptions: [{ patternId: "p1", name: "Adds the denominators" }] });
    expect(r.activity.type).toBe("prerequisite_diagnostic");
    expect(r.reason).toMatch(/Adds the denominators/);
  });
});

describe("recommendNextActivity — never loops forever", () => {
  const past = (n: number, status: MasteryStatus, type: PastRecommendation["activityType"] = "guided_practice"): PastRecommendation[] =>
    Array.from({ length: n }, () => ({ conceptId: "adding", activityType: type, statusAtTime: status }));

  it("the same activity repeated with no change escalates to the teacher", () => {
    const r = rec({ adding: st("developing") }, { history: past(2, "developing") });
    expect(r.activity.type).toBe("teacher_review");
    expect(r.teacherReviewRequired).toBe(true);
    expect(r.reason).toMatch(/2 times with no change/);
  });

  it("one earlier attempt is still allowed", () => {
    expect(rec({ adding: st("developing") }, { history: past(1, "developing") }).activity.type).toBe("guided_practice");
  });

  it("repeats under a different status do not count (the student moved)", () => {
    expect(rec({ adding: st("developing") }, { history: past(3, "needs_foundation") }).activity.type).toBe("guided_practice");
  });

  it("follow-up assessments never escalate (asking for evidence is always allowed)", () => {
    expect(rec({}, { history: past(5, "not_enough_evidence", "follow_up_assessment") }).activity.type).toBe("follow_up_assessment");
  });

  it("is deterministic", () => {
    const inputs = { adding: st("needs_foundation"), equiv: st("needs_foundation") };
    expect(rec(inputs)).toEqual(rec(inputs));
  });
});

describe("recommendation contract", () => {
  it("always carries scope, concept, activity, prerequisites, evidence, reason, sufficiency, uncertainty, review flag and policy version", () => {
    for (const status of ["not_enough_evidence", "needs_foundation", "developing", "likely_secure", "ready_for_challenge"] as MasteryStatus[]) {
      const r = rec({ adding: st(status) });
      expect(r.scope).toEqual({ kind: "student", studentId: "s1" });
      expect(r.reason.length).toBeGreaterThan(10);
      expect(Array.isArray(r.evidenceIds) && Array.isArray(r.prerequisiteConceptIds)).toBe(true);
      expect(["insufficient", "limited", "sufficient"]).toContain(r.evidenceSufficiency);
      expect(typeof r.teacherReviewRequired).toBe("boolean");
      expect(r.policyVersion).toBe(POLICY_VERSION);
    }
  });
});

describe("proposeGroups", () => {
  it("sorts students into foundation / guided / challenge / follow-up lanes", () => {
    const recs = [
      rec({ adding: st("needs_foundation"), equiv: st("needs_foundation") }, { studentId: "s-b" }),
      rec({ adding: st("developing") }, { studentId: "s-a" }),
      rec({ adding: st("ready_for_challenge", 5) }, { studentId: "s-c" }),
      rec({}, { studentId: "s-d" }),
    ];
    const g = proposeGroups(recs);
    expect(g.foundation.map((m) => m.studentId)).toEqual(["s-b"]);
    expect(g.guided.map((m) => m.studentId)).toEqual(["s-a"]);
    expect(g.challenge.map((m) => m.studentId)).toEqual(["s-c"]);
    expect(g.follow_up.map((m) => m.studentId)).toEqual(["s-d"]);
  });

  it("puts a student with one wrong answer in the follow-up lane, never in foundation", () => {
    const g = proposeGroups([rec({ adding: st("not_enough_evidence", 1) }, { studentId: "s-x" })]);
    expect(g.foundation).toEqual([]);
    expect(g.follow_up.map((m) => m.studentId)).toEqual(["s-x"]);
  });

  it("maps escalations to the teacher lane", () => {
    expect(groupFor("teacher_review")).toBe("follow_up");
  });

  it("is stable regardless of input order", () => {
    const a = rec({ adding: st("developing") }, { studentId: "s-1" });
    const b = rec({ adding: st("developing") }, { studentId: "s-2" });
    expect(proposeGroups([a, b])).toEqual(proposeGroups([b, a]));
  });
});
