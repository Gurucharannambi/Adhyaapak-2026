import { describe, expect, it } from "vitest";
import { ConceptGraph } from "../graph/graph";
import { evaluateResponse, normalizeAnswer } from "./evaluate";
import { validateQuestion } from "./question-validation";
import { prerequisitePulse, selectDiagnosticQuestions } from "./selection";
import type { BankQuestion } from "./types";

function q(over: Partial<BankQuestion> & { key: string }): BankQuestion {
  return {
    id: `id-${over.key}`,
    conceptId: "c1",
    role: "diagnostic",
    difficulty: 2,
    stem: "1/2 + 1/3 = ?",
    options: [
      { id: "a", text: "2/5", misconceptionKey: "adds-denominators" },
      { id: "b", text: "5/6" },
      { id: "c", text: "1/5" },
    ],
    correctOptionId: "b",
    reviewStatus: "approved",
    ...over,
  };
}

describe("evaluateResponse", () => {
  const question = q({ key: "q1" });

  it("marks the correct option correct and other options incorrect", () => {
    expect(evaluateResponse(question, { kind: "option", optionId: "b" })).toEqual({ result: "correct", reason: "correct", chosenOptionId: "b" });
    expect(evaluateResponse(question, { kind: "option", optionId: "a" })).toEqual({ result: "incorrect", reason: "wrong_option", chosenOptionId: "a" });
  });

  it("treats blank, unreadable and invalid options as insufficient, never as wrong", () => {
    expect(evaluateResponse(question, { kind: "blank" }).result).toBe("insufficient");
    expect(evaluateResponse(question, { kind: "unreadable" }).result).toBe("insufficient");
    expect(evaluateResponse(question, { kind: "option", optionId: "zzz" })).toMatchObject({ result: "insufficient", reason: "invalid_option" });
  });

  it("maps typed paper answers onto printed options, ignoring spacing and symbols", () => {
    expect(evaluateResponse(question, { kind: "text", text: " 5 / 6 " }).result).toBe("correct");
    expect(evaluateResponse(question, { kind: "text", text: "2⁄5" })).toMatchObject({ result: "incorrect", chosenOptionId: "a" });
  });

  it("does not guess when typed text matches no option", () => {
    expect(evaluateResponse(question, { kind: "text", text: "7/8" })).toMatchObject({ result: "insufficient", reason: "unrecognised_text" });
    expect(evaluateResponse(question, { kind: "text", text: "   " }).result).toBe("insufficient");
  });

  it("normalizeAnswer unifies spaces, case, minus and slash glyphs", () => {
    expect(normalizeAnswer(" −3 / 4 ")).toBe("-3/4");
    expect(normalizeAnswer("5/6.")).toBe("5/6");
  });
});

describe("validateQuestion", () => {
  it("accepts a good question", () => {
    expect(validateQuestion(q({ key: "ok" }))).toEqual([]);
  });

  it.each([
    ["blank_stem", { stem: "  " }],
    ["too_few_options", { options: [{ id: "a", text: "x" }] }],
    ["correct_option_missing", { correctOptionId: "z" }],
    ["bad_difficulty", { difficulty: 9 }],
    ["duplicate_option_id", { options: [{ id: "a", text: "x" }, { id: "a", text: "y" }], correctOptionId: "a" }],
    ["duplicate_option_text", { options: [{ id: "a", text: "x" }, { id: "b", text: " X " }], correctOptionId: "a" }],
    ["blank_option", { options: [{ id: "a", text: "x" }, { id: "b", text: "" }], correctOptionId: "a" }],
    ["correct_option_tagged", { options: [{ id: "a", text: "x", misconceptionKey: "m" }, { id: "b", text: "y" }], correctOptionId: "a" }],
  ] as const)("flags %s", (code, over) => {
    expect(validateQuestion(q({ key: "bad", ...(over as Partial<BankQuestion>) })).map((i) => i.code)).toContain(code);
  });
});

describe("selectDiagnosticQuestions", () => {
  const bank = [
    q({ key: "a-easy", conceptId: "A", difficulty: 1, options: [{ id: "a", text: "x" }, { id: "b", text: "y" }], correctOptionId: "a" }),
    q({ key: "a-tagged", conceptId: "A", difficulty: 3 }),
    q({ key: "b-1", conceptId: "B", difficulty: 2 }),
    q({ key: "b-2", conceptId: "B", difficulty: 2 }),
    q({ key: "c-1", conceptId: "C", difficulty: 2 }),
  ];

  it("spreads across concepts round-robin and prefers misconception-revealing questions", () => {
    const picked = selectDiagnosticQuestions(["A", "B", "C"], bank, { count: 3 });
    expect(picked.map((p) => p.key)).toEqual(["a-tagged", "b-1", "c-1"]);
  });

  it("is deterministic", () => {
    const first = selectDiagnosticQuestions(["A", "B", "C"], bank, { count: 4 }).map((p) => p.key);
    expect(selectDiagnosticQuestions(["A", "B", "C"], bank, { count: 4 }).map((p) => p.key)).toEqual(first);
  });

  it("clamps the count to 2..5", () => {
    expect(selectDiagnosticQuestions(["A", "B", "C"], bank, { count: 1 })).toHaveLength(2);
    expect(selectDiagnosticQuestions(["A", "B", "C"], bank, { count: 99 })).toHaveLength(5);
  });

  it("never picks unapproved, non-diagnostic, invalid or excluded questions", () => {
    const messy = [
      q({ key: "draft", conceptId: "A", reviewStatus: "draft" }),
      q({ key: "guided", conceptId: "A", role: "guided" }),
      q({ key: "invalid", conceptId: "A", correctOptionId: "nope" }),
      q({ key: "excluded", conceptId: "A" }),
      q({ key: "good", conceptId: "A" }),
    ];
    const picked = selectDiagnosticQuestions(["A"], messy, { count: 3, excludeKeys: new Set(["excluded"]) });
    expect(picked.map((p) => p.key)).toEqual(["good"]);
  });

  it("returns fewer than requested when the bank is small instead of padding", () => {
    expect(selectDiagnosticQuestions(["C"], bank, { count: 4 })).toHaveLength(1);
  });

  it("respects maxPerConcept and maxDifficulty", () => {
    expect(selectDiagnosticQuestions(["B"], bank, { count: 3, maxPerConcept: 1 })).toHaveLength(1);
    expect(selectDiagnosticQuestions(["A"], bank, { count: 3, maxDifficulty: 2 }).map((p) => p.key)).toEqual(["a-easy"]);
  });
});

describe("prerequisitePulse", () => {
  const graph = new ConceptGraph(["mult", "part", "equiv", "common"], [
    { prerequisiteId: "mult", dependentId: "equiv" },
    { prerequisiteId: "part", dependentId: "equiv" },
    { prerequisiteId: "equiv", dependentId: "common" },
  ]);
  const bank = [
    q({ key: "m1", conceptId: "mult", difficulty: 1 }),
    q({ key: "p1", conceptId: "part", difficulty: 2 }),
    q({ key: "p-hard", conceptId: "part", difficulty: 5 }),
    q({ key: "e1", conceptId: "equiv", difficulty: 2 }),
  ];

  it("asks about direct prerequisites only, one question each, easy items", () => {
    expect(prerequisitePulse(graph, "equiv", bank).map((p) => p.key)).toEqual(["m1", "p1"]);
    expect(prerequisitePulse(graph, "common", bank).map((p) => p.key)).toEqual(["e1"]);
  });

  it("returns nothing for a concept with no prerequisites", () => {
    expect(prerequisitePulse(graph, "mult", bank)).toEqual([]);
  });
});
