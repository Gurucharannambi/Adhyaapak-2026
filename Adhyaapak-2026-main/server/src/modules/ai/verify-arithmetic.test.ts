import { describe, expect, it } from "vitest";
import { parseFraction, verifyFractionArithmetic } from "./verify-arithmetic";

const q = (stem: string, options: Array<[string, string?]>, correctIndex: number) => ({
  stem,
  options: options.map(([text, misconceptionKey]) => ({ text, misconceptionKey: misconceptionKey ?? null })),
  correctIndex,
});

describe("parseFraction", () => {
  it("reads fractions, mixed numbers, whole numbers and unicode slashes", () => {
    expect(parseFraction("3/4")).toEqual({ n: 3, d: 4 });
    expect(parseFraction(" 3 / 4 ")).toEqual({ n: 3, d: 4 });
    expect(parseFraction("1 7/12")).toEqual({ n: 19, d: 12 });
    expect(parseFraction("5")).toEqual({ n: 5, d: 1 });
    expect(parseFraction("3⁄4")).toEqual({ n: 3, d: 4 });
  });
  it("returns undefined for anything else", () => {
    for (const bad of ["", "abc", "1/2/3", "-1/2", "0.5", "1/ "]) expect(parseFraction(bad)).toBeUndefined();
  });
});

describe("verifyFractionArithmetic", () => {
  it("verifies a correct addition question with correctly tagged distractors", () => {
    const r = verifyFractionArithmetic(q("1/2 + 1/3 = ?", [["2/5", "adds-denominators"], ["5/6"], ["2/6", "combines-tops-multiplies-bottoms"], ["1/5"]], 1));
    expect(r).toEqual({ status: "verified", issues: [] });
  });

  it("accepts an unsimplified or mixed-number form of the right answer", () => {
    expect(verifyFractionArithmetic(q("3/4 + 5/6 = ?", [["8/10", "adds-denominators"], ["1 7/12"], ["14/12"], ["8/24", "combines-tops-multiplies-bottoms"]], 1)).status).toBe("verified");
    expect(verifyFractionArithmetic(q("1/2 + 1/3 = ?", [["10/12"], ["1/5"]], 0)).status).toBe("verified");
  });

  it("catches a wrong marked answer", () => {
    const r = verifyFractionArithmetic(q("1/2 + 1/3 = ?", [["2/5"], ["5/6"], ["1/6"], ["3/6"]], 0));
    expect(r.status).toBe("failed");
    expect(r.issues[0]).toMatch(/marked answer is wrong/);
  });

  it("catches a second correct option", () => {
    const r = verifyFractionArithmetic(q("1/2 + 1/3 = ?", [["5/6"], ["10/12"], ["2/5"], ["1/5"]], 0));
    expect(r.status).toBe("failed");
    expect(r.issues.join()).toMatch(/Option B is also a correct answer/);
  });

  it("catches a misconception tag that does not match what the mistake produces", () => {
    const r = verifyFractionArithmetic(q("1/2 + 1/3 = ?", [["2/5", "adds-denominators"], ["5/6"], ["1/5", "adds-denominators"], ["1/6"]], 1));
    expect(r.status).toBe("failed");
    expect(r.issues.join()).toMatch(/Option C is tagged "adds-denominators" but is not what that mistake gives \(2\/5\)/);
  });

  it("catches a tag applied to the wrong operation", () => {
    const r = verifyFractionArithmetic(q("3/4 − 1/3 = ?", [["4/7", "adds-denominators"], ["5/12"], ["2/1", "subtracts-denominators"], ["1/2"]], 1));
    expect(r.status).toBe("failed");
    expect(r.issues.join()).toMatch(/does not apply to subtraction/);
  });

  it("handles subtraction, including the 3/0 style result of subtracting denominators", () => {
    expect(verifyFractionArithmetic(q("5/8 − 2/8 = ?", [["3/0", "subtracts-denominators"], ["3/8"], ["3/16"], ["7/8"]], 1)).status).toBe("verified");
    expect(verifyFractionArithmetic(q("3/4 − 1/3 = ?", [["2/1", "subtracts-denominators"], ["5/12"], ["2/12"], ["1/2"]], 1)).status).toBe("verified");
  });

  it("rejects a negative result and a zero denominator in the question", () => {
    expect(verifyFractionArithmetic(q("1/4 − 1/2 = ?", [["1/4"], ["2/4"], ["3/4"], ["0"]], 0)).issues.join()).toMatch(/negative/);
    expect(verifyFractionArithmetic(q("1/0 + 1/2 = ?", [["1"], ["2"]], 0)).status).toBe("failed");
  });

  it("fails when the marked answer is not a fraction we can read", () => {
    expect(verifyFractionArithmetic(q("1/2 + 1/3 = ?", [["five sixths"], ["5/6"]], 0)).status).toBe("failed");
  });

  it("leaves tags it does not know to the teacher, and other question shapes as not applicable", () => {
    expect(verifyFractionArithmetic(q("1/2 + 1/3 = ?", [["2/5", "some-other-pattern"], ["5/6"], ["1/6"], ["1/5"]], 1)).status).toBe("verified");
    expect(verifyFractionArithmetic(q("Anu ate 1/4 of a pizza and Biju ate 1/2. How much altogether?", [["3/4"], ["2/6"]], 0))).toEqual({ status: "not_applicable", issues: [] });
    expect(verifyFractionArithmetic(q("What is 1/4 multiplied by 2?", [["1/2"], ["2/8"]], 0)).status).toBe("not_applicable");
  });

  it("agrees with every addition, subtraction and comparison question in the hand-written seed bank", async () => {
    const { QUESTIONS } = await import("../curriculum/seed/fractions-class6");
    let checked = 0;
    for (const s of QUESTIONS) {
      const r = verifyFractionArithmetic({ stem: s.stem, options: s.options.map((o) => ({ text: o.text, misconceptionKey: o.misconceptionKey ?? null })), correctIndex: s.options.findIndex((o) => o.id === s.correct) });
      if (r.status === "not_applicable") continue;
      checked++;
      expect(r, s.key).toEqual({ status: "verified", issues: [] });
    }
    expect(checked).toBe(9); // q-af-1..4, q-sf-1..3 and the two "which is greater" questions q-cf-1 and q-cf-2
  });
});

describe("verifyFractionArithmetic: comparison questions", () => {
  const cq = (stem: string, options: Array<[string, string?]>, correctIndex: number) => q(stem, options, correctIndex);

  it("verifies a correct 'which is greater' question", () => {
    expect(verifyFractionArithmetic(cq("Which is greater: 1/3 or 1/8?", [["1/8", "bigger-denominator-bigger"], ["1/3"], ["They are equal"], ["Cannot tell"]], 1))).toEqual({ status: "verified", issues: [] });
  });

  it("catches the real mistake a live model made: asking which of two EQUAL fractions is greater", () => {
    const r = verifyFractionArithmetic(cq("Which is greater: 4/6 or 2/3?", [["4/6"], ["2/3"], ["1/2"], ["3/4"]], 1));
    expect(r.status).toBe("failed");
    expect(r.issues[0]).toMatch(/are equal, so no fraction can be the answer/);
  });

  it("accepts 'they are equal' as the answer when the fractions are equal", () => {
    expect(verifyFractionArithmetic(cq("Which is greater: 4/6 or 2/3?", [["4/6"], ["2/3"], ["They are equal"], ["Cannot tell"]], 2)).status).toBe("verified");
  });

  it("catches the wrong fraction marked as the answer, and handles 'smaller'", () => {
    expect(verifyFractionArithmetic(cq("Which is greater: 2/5 or 3/10?", [["3/10"], ["2/5"]], 0)).issues[0]).toMatch(/marked answer is wrong: the greater fraction is 2\/5/);
    expect(verifyFractionArithmetic(cq("Which is smaller: 2/5 or 3/10?", [["3/10"], ["2/5"]], 0)).status).toBe("verified");
  });

  it("checks the bigger-denominator tag points at the fraction with the larger denominator", () => {
    expect(verifyFractionArithmetic(cq("Which is greater: 3/5 or 3/7?", [["3/7", "bigger-denominator-bigger"], ["3/5"], ["Equal"], ["Cannot tell"]], 1)).status).toBe("verified");
    const bad = verifyFractionArithmetic(cq("Which is greater: 3/5 or 3/7?", [["3/5", "bigger-denominator-bigger"], ["3/7"], ["Equal"], ["Cannot tell"]], 1));
    expect(bad.status).toBe("failed");
  });

  it("flags an option that is also correct, and ignores three-way and other question shapes", () => {
    expect(verifyFractionArithmetic(cq("Which is greater: 1/3 or 1/8?", [["1/3"], ["2/6"], ["1/8"], ["Equal"]], 0)).issues.join()).toMatch(/Option B is also a correct answer/);
    expect(verifyFractionArithmetic(cq("Which is the largest: 2/3, 3/4 or 5/8?", [["2/3"], ["3/4"]], 1)).status).toBe("not_applicable");
  });
});

describe("verifyFractionArithmetic: equivalence questions", () => {
  it("verifies a good 'equivalent to' question, including correctly tagged distractors", () => {
    const r = verifyFractionArithmetic(q("Which fraction is equivalent to 1/2?", [["2/3", "adds-same-number-to-both"], ["2/4"], ["2/2", "multiplies-numerator-only"], ["1/4"]], 1));
    expect(r).toEqual({ status: "verified", issues: [] });
  });

  it("catches the live-model mistake of offering two equivalent options", () => {
    const r = verifyFractionArithmetic(q("Which fraction is equivalent to 2/3?", [["4/6"], ["5/7", "adds-same-number-to-both"], ["2/5"], ["6/9"]], 0));
    expect(r.status).toBe("failed");
    expect(r.issues[0]).toMatch(/Exactly one option should be equivalent to 2\/3, but 2 are/);
  });

  it("catches a wrong marked answer and tags that do not match the mistake", () => {
    expect(verifyFractionArithmetic(q("Which fraction is equivalent to 1/2?", [["2/3"], ["2/4"], ["1/3"], ["1/4"]], 0)).issues[0]).toMatch(/marked answer is wrong: 2\/4 is the one that fits/);
    const bad = verifyFractionArithmetic(q("Which fraction is equivalent to 1/2?", [["3/7", "adds-same-number-to-both"], ["2/4"], ["1/3"], ["1/4"]], 1));
    expect(bad.issues.join()).toMatch(/Option A is tagged "adds-same-number-to-both"/);
  });

  it("handles the NOT form", () => {
    expect(verifyFractionArithmetic(q("Which of these fractions is NOT equivalent to 3/6?", [["1/2"], ["2/4"], ["3/5"], ["6/12"]], 2)).status).toBe("verified");
    expect(verifyFractionArithmetic(q("Which of these fractions is NOT equivalent to 3/6?", [["1/2"], ["2/4"], ["3/5"], ["6/12"]], 0)).status).toBe("failed");
    expect(verifyFractionArithmetic(q("Which of these fractions is NOT equivalent to 3/6?", [["1/2"], ["2/4"], ["3/5"], ["4/7"]], 2)).issues[0]).toMatch(/Exactly one option should be NOT equivalent/);
  });

  it("agrees with the hand-written equivalence questions in the seed bank", async () => {
    const { QUESTIONS } = await import("../curriculum/seed/fractions-class6");
    for (const s of QUESTIONS.filter((x) => /equivalent to/i.test(x.stem))) {
      const r = verifyFractionArithmetic({ stem: s.stem, options: s.options.map((o) => ({ text: o.text, misconceptionKey: o.misconceptionKey ?? null })), correctIndex: s.options.findIndex((o) => o.id === s.correct) });
      expect(r.status, s.key).not.toBe("failed");
    }
  });
});
