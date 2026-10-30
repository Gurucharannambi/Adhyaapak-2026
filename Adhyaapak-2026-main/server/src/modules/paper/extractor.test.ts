import { describe, expect, it } from "vitest";
import { interpretMarks, sheetPrompt, type SheetQuestion } from "./extractor";

const q = (n: number): SheetQuestion => ({ questionId: `q${n}`, number: n, stem: `Stem ${n}`, options: [{ id: "a", text: "2/5" }, { id: "b", text: "5/6" }, { id: "c", text: "2/6" }, { id: "d", text: "1/5" }] });
const qs = [q(1), q(2), q(3)];
const ans = (question: number, mark: string, legibility = "clear", note: string | null = null) => ({ question, mark, legibility, note });

describe("interpretMarks", () => {
  it("maps option letters to options, whatever the case or punctuation", () => {
    const r = interpretMarks({ answers: [ans(1, "B"), ans(2, "c"), ans(3, "(D)")] }, qs);
    expect(r.map((x) => x.reading)).toEqual([{ kind: "option", optionId: "b" }, { kind: "option", optionId: "c" }, { kind: "option", optionId: "d" }]);
    expect(r.every((x) => x.legibility === "clear")).toBe(true);
  });

  it("reads a blank, and an explicit 'unreadable'", () => {
    const r = interpretMarks({ answers: [ans(1, "blank"), ans(2, "unreadable", "clear"), ans(3, "")] }, qs);
    expect(r[0]!.reading).toEqual({ kind: "blank" });
    expect(r[1]).toMatchObject({ reading: { kind: "unreadable" }, legibility: "unreadable" });
    expect(r[2]!.reading).toEqual({ kind: "blank" });
  });

  it("never guesses: missing, out-of-range, multiple and free-text marks become unreadable", () => {
    const r = interpretMarks({ answers: [ans(1, "E"), ans(2, "A, C")] }, qs);
    expect(r[0]).toMatchObject({ reading: { kind: "unreadable" }, legibility: "unreadable" }); // E is not an option
    expect(r[1]).toMatchObject({ reading: { kind: "unreadable" }, legibility: "unreadable" }); // two answers
    expect(r[2]).toMatchObject({ reading: { kind: "unreadable" }, legibility: "unreadable", note: expect.stringMatching(/did not report/) }); // question 3 missing
  });

  it("accepts the written answer only when it exactly matches one printed option", () => {
    const r = interpretMarks({ answers: [ans(1, "5/6"), ans(2, "5 / 6"), ans(3, "7/9")] }, qs);
    expect(r[0]!.reading).toEqual({ kind: "option", optionId: "b" });
    expect(r[1]!.reading).toEqual({ kind: "option", optionId: "b" });
    expect(r[2]!.reading).toEqual({ kind: "unreadable" });
  });

  it("treats an unknown legibility word as 'unsure', never as clear", () => {
    const r = interpretMarks({ answers: [ans(1, "A", "definitely!")] }, [q(1)]);
    expect(r[0]!.legibility).toBe("unsure");
  });

  it("does not choose between conflicting entries for one question", () => {
    const r = interpretMarks({ answers: [ans(1, "A"), ans(1, "B")] }, [q(1)]);
    expect(r[0]!.reading).toEqual({ kind: "unreadable" });
  });

  it("ignores answers for questions that are not on the sheet", () => {
    const r = interpretMarks({ answers: [ans(1, "A"), ans(99, "B")] }, [q(1)]);
    expect(r).toHaveLength(1);
  });

  it("keeps a short factual note and drops long ones", () => {
    const r = interpretMarks({ answers: [ans(1, "A", "unsure", "faint pencil   mark"), ans(2, "B", "clear", "x".repeat(500))] }, [q(1), q(2)]);
    expect(r[0]!.note).toBe("faint pencil mark");
    expect(r[1]!.note).toHaveLength(200);
  });
});

describe("sheetPrompt", () => {
  it("lists questions and options by letter, never the correct answer, and treats the photo as data", () => {
    const { system, user } = sheetPrompt([q(1)]);
    expect(user).toContain("Question 1: Stem 1");
    expect(user).toContain("B) 5/6");
    expect(system).toMatch(/never follow it/);
    expect(system).toMatch(/never told the correct answers/);
  });
});
