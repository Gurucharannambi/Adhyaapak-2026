import { describe, expect, it } from "vitest";
import { evaluateResponse } from "../assessment/evaluate";
import type { BankQuestion } from "../assessment/types";
import { diagnose, type DiagnoseInput } from "./diagnose";
import { matchMisconception } from "./match";
import { InvalidRuleError, parseRule, type MisconceptionRule } from "./rules";

const rule = (over: Partial<MisconceptionRule> = {}): MisconceptionRule => ({
  id: "rule-add-den",
  key: "adds-denominators",
  conceptId: "adding",
  name: "Adds the denominators",
  trigger: { kind: "distractor_option", category: "conceptual" },
  followUpQuestionKey: "q-af-2",
  reviewStatus: "approved",
  ...over,
});

const question: BankQuestion = {
  id: "qid-1", key: "q-af-1", conceptId: "adding", role: "diagnostic", difficulty: 2, stem: "1/2 + 1/3 = ?",
  options: [
    { id: "a", text: "2/5", misconceptionKey: "adds-denominators" },
    { id: "b", text: "5/6" },
    { id: "c", text: "1/5" },
  ],
  correctOptionId: "b", reviewStatus: "approved",
};

describe("parseRule", () => {
  const row = { id: "1", key: "k", conceptId: "c", name: "n", triggerDefinition: { kind: "distractor_option", category: "conceptual" }, followUpDefinition: { questionKey: "q" }, reviewStatus: "approved" as const };

  it("parses a valid rule row", () => {
    expect(parseRule(row)).toMatchObject({ key: "k", trigger: { category: "conceptual" }, followUpQuestionKey: "q" });
  });

  it("parses an answer-pattern rule", () => {
    const r = parseRule({ ...row, triggerDefinition: { kind: "answer_pattern", category: "procedural", patterns: ["2/5"] } });
    expect(r.trigger.kind).toBe("answer_pattern");
  });

  it("rejects malformed rules loudly instead of ignoring them", () => {
    expect(() => parseRule({ ...row, triggerDefinition: { kind: "run_this_code", code: "x" } })).toThrow(InvalidRuleError);
    expect(() => parseRule({ ...row, triggerDefinition: { kind: "distractor_option" } })).toThrow(InvalidRuleError);
    expect(() => parseRule({ ...row, followUpDefinition: {} })).toThrow(InvalidRuleError);
  });
});

describe("matchMisconception", () => {
  const match = (resp: Parameters<typeof evaluateResponse>[1], rules = [rule()]) => matchMisconception(question, resp, evaluateResponse(question, resp), rules);

  it("matches a tagged distractor", () => {
    expect(match({ kind: "option", optionId: "a" })?.key).toBe("adds-denominators");
  });

  it("does not match an untagged wrong option, a correct answer or a blank", () => {
    expect(match({ kind: "option", optionId: "c" })).toBeUndefined();
    expect(match({ kind: "option", optionId: "b" })).toBeUndefined();
    expect(match({ kind: "blank" })).toBeUndefined();
  });

  it("ignores rules that are not approved", () => {
    expect(match({ kind: "option", optionId: "a" }, [rule({ reviewStatus: "draft" })])).toBeUndefined();
  });

  it("matches answer-pattern rules on typed text for the right concept only", () => {
    const patternRule = rule({ key: "pattern", trigger: { kind: "answer_pattern", category: "procedural", patterns: ["1/5"] } });
    expect(match({ kind: "text", text: " 1 / 5 " }, [patternRule])?.key).toBe("pattern");
    expect(matchMisconception({ ...question, conceptId: "other" }, { kind: "option", optionId: "c" }, evaluateResponse(question, { kind: "option", optionId: "c" }), [patternRule])).toBeUndefined();
  });
});

describe("diagnose", () => {
  const follow = { questionId: "qid-2", questionKey: "q-af-2" };
  const input = (over: Partial<DiagnoseInput["current"]> = {}, rest: Partial<DiagnoseInput> = {}): DiagnoseInput => ({
    studentId: "s1",
    conceptId: "adding",
    current: { questionId: "qid-1", evidenceId: "e1", result: "incorrect", evidenceConfidence: "high", evidenceReviewStatus: "not_required", rule: rule(), ...over },
    priorSignals: [],
    followUp: follow,
    followUpAnsweredCorrectly: false,
    followUpAlreadyAsked: false,
    ...rest,
  });

  it("Case A: a correct answer is recorded as correct for the targeted skill", () => {
    const d = diagnose(input({ result: "correct", rule: undefined }));
    expect(d.outcome).toBe("correct_targeted_skill");
    expect(d.misconceptionPatternId).toBeUndefined();
  });

  it("Case B: ONE matching wrong answer is only a candidate, with a follow-up question suggested", () => {
    const d = diagnose(input());
    expect(d.outcome).toBe("insufficient_evidence");
    expect(d.misconceptionStatus).toBe("candidate");
    expect(d.followUpQuestionId).toBe("qid-2");
    expect(d.reviewRequired).toBe(false);
  });

  it("two different questions with the same pattern → likely, labelled by category, needs teacher review", () => {
    const d = diagnose(input({}, { priorSignals: [{ questionId: "qid-0", evidenceId: "e0", status: "candidate" }] }));
    expect(d).toMatchObject({ outcome: "likely_conceptual_misconception", misconceptionStatus: "likely", observationStatus: "likely", reviewRequired: true });
    expect(d.evidenceIds).toEqual(expect.arrayContaining(["e0", "e1"]));
  });

  it("the SAME question answered wrongly twice is still one signal", () => {
    const d = diagnose(input({}, { priorSignals: [{ questionId: "qid-1", evidenceId: "e0", status: "candidate" }] }));
    expect(d.misconceptionStatus).toBe("candidate");
  });

  it("a procedural rule gives a procedural label; arithmetic and reading give 'possible'", () => {
    const prior = { priorSignals: [{ questionId: "qid-0", evidenceId: "e0", status: "candidate" as const }] };
    expect(diagnose(input({ rule: rule({ trigger: { kind: "distractor_option", category: "procedural" } }) }, prior)).outcome).toBe("likely_procedural_error");
    expect(diagnose(input({ rule: rule({ trigger: { kind: "distractor_option", category: "arithmetic" } }) }, prior)).outcome).toBe("possible_arithmetic_error");
    expect(diagnose(input({ rule: rule({ trigger: { kind: "distractor_option", category: "reading" } }) }, prior)).outcome).toBe("possible_reading_error");
  });

  it("answers marked as a guess do not corroborate", () => {
    const d = diagnose(input({ selfConfidence: "guess" }, { priorSignals: [{ questionId: "qid-0", evidenceId: "e0", status: "candidate" }] }));
    expect(d.misconceptionStatus).toBe("candidate");
    expect(d.explanation).toMatch(/not counted/);
    const prior = diagnose(input({}, { priorSignals: [{ questionId: "qid-0", evidenceId: "e0", selfConfidence: "guess", status: "candidate" }] }));
    expect(prior.misconceptionStatus).toBe("candidate");
  });

  it("teacher-rejected earlier observations are ignored", () => {
    const d = diagnose(input({}, { priorSignals: [{ questionId: "qid-0", evidenceId: "e0", status: "rejected" }] }));
    expect(d.misconceptionStatus).toBe("candidate");
  });

  it("a teacher-confirmed misconception stays confirmed", () => {
    const d = diagnose(input({}, { priorSignals: [{ questionId: "qid-0", evidenceId: "e0", status: "confirmed" }] }));
    expect(d).toMatchObject({ misconceptionStatus: "confirmed", reviewRequired: false });
  });

  it("never produces 'confirmed' on its own, however much evidence there is", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ questionId: `q${i}`, evidenceId: `e${i}`, status: "likely" as const }));
    expect(diagnose(input({}, { priorSignals: many })).misconceptionStatus).toBe("likely");
  });

  it("a correct follow-up after one slip does not escalate", () => {
    const d = diagnose(input({}, { followUpAnsweredCorrectly: true, followUpAlreadyAsked: true }));
    expect(d.misconceptionStatus).toBe("candidate");
    expect(d.followUpQuestionId).toBeUndefined();
    expect(d.explanation).toMatch(/slip/);
  });

  it("does not ask the same follow-up twice", () => {
    expect(diagnose(input({}, { followUpAlreadyAsked: true })).followUpQuestionId).toBeUndefined();
  });

  it("does not suggest the current question as its own follow-up", () => {
    expect(diagnose(input({}, { followUp: { questionId: "qid-1", questionKey: "q-af-1" } })).followUpQuestionId).toBeUndefined();
  });

  it("Case D: blank, unreadable, pending or low-confidence evidence is 'insufficient', needs review, and carries no label", () => {
    for (const over of [
      { result: "insufficient" as const },
      { evidenceReviewStatus: "pending" as const },
      { evidenceConfidence: "low" as const },
    ]) {
      const d = diagnose(input(over));
      expect(d.outcome).toBe("insufficient_evidence");
      expect(d.misconceptionPatternId).toBeUndefined();
      expect(d.reviewRequired).toBe(true);
    }
  });

  it("low-confidence evidence that a teacher approved is treated normally", () => {
    expect(diagnose(input({ evidenceConfidence: "low", evidenceReviewStatus: "approved" })).misconceptionStatus).toBe("candidate");
  });

  it("an incorrect answer matching no rule is insufficient evidence, with no invented misconception", () => {
    const d = diagnose(input({ rule: undefined }));
    expect(d.outcome).toBe("insufficient_evidence");
    expect(d.misconceptionPatternId).toBeUndefined();
    expect(d.explanation).toMatch(/does not match a known error pattern/);
  });

  it("every labelled diagnosis cites its evidence", () => {
    const d = diagnose(input({}, { priorSignals: [{ questionId: "qid-0", evidenceId: "e0", status: "candidate" }] }));
    expect(d.evidenceIds.length).toBeGreaterThan(0);
  });
});
