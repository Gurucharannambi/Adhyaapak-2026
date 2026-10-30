import type { BankQuestion, Evaluation, StudentResponse } from "./types";

/** Lower-case, strip spaces and unify minus/division glyphs so "2 / 5", "2/5" and "2⁄5" compare equal. */
export function normalizeAnswer(s: string): string {
  return s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s ]+/g, "")
    .replace(/[−–—]/g, "-")
    .replace(/[⁄∕]/g, "/")
    .replace(/\.$/, "");
}

/**
 * Deterministic answer check (CLAUDE.md §12: exact-answer checking never uses the LLM).
 * Anything we cannot interpret is `insufficient`, never `incorrect`.
 */
export function evaluateResponse(question: BankQuestion, response: StudentResponse): Evaluation {
  switch (response.kind) {
    case "blank":
      return { result: "insufficient", reason: "blank" };
    case "unreadable":
      return { result: "insufficient", reason: "unreadable" };
    case "option": {
      const chosen = question.options.find((o) => o.id === response.optionId);
      if (!chosen) return { result: "insufficient", reason: "invalid_option" };
      return chosen.id === question.correctOptionId
        ? { result: "correct", reason: "correct", chosenOptionId: chosen.id }
        : { result: "incorrect", reason: "wrong_option", chosenOptionId: chosen.id };
    }
    case "text": {
      // Teacher-typed paper answers: accept only if they match one of the printed options.
      const wanted = normalizeAnswer(response.text);
      const chosen = wanted ? question.options.find((o) => normalizeAnswer(o.text) === wanted) : undefined;
      if (!chosen) return { result: "insufficient", reason: "unrecognised_text" };
      return chosen.id === question.correctOptionId
        ? { result: "correct", reason: "correct", chosenOptionId: chosen.id }
        : { result: "incorrect", reason: "wrong_option", chosenOptionId: chosen.id };
    }
  }
}
