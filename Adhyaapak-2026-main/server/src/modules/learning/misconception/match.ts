import { normalizeAnswer } from "../assessment/evaluate";
import type { BankQuestion, Evaluation, StudentResponse } from "../assessment/types";
import type { MisconceptionRule } from "./rules";

/**
 * Finds the known error pattern behind an INCORRECT response, if any. Only teacher-approved rules
 * are used. Returns undefined when nothing matches; the caller must then treat the error as "unknown",
 * not invent a misconception (CLAUDE.md §7).
 */
export function matchMisconception(
  question: BankQuestion,
  response: StudentResponse,
  evaluation: Evaluation,
  rules: readonly MisconceptionRule[],
): MisconceptionRule | undefined {
  if (evaluation.result !== "incorrect") return undefined;
  const approved = rules.filter((r) => r.reviewStatus === "approved");

  const chosen = question.options.find((o) => o.id === evaluation.chosenOptionId);
  if (chosen?.misconceptionKey) {
    const byTag = approved.find((r) => r.key === chosen.misconceptionKey && r.trigger.kind === "distractor_option");
    if (byTag) return byTag;
  }

  const text = response.kind === "text" ? response.text : chosen?.text;
  if (text) {
    const wanted = normalizeAnswer(text);
    return approved.find(
      (r) => r.conceptId === question.conceptId && r.trigger.kind === "answer_pattern" && r.trigger.patterns.some((p) => normalizeAnswer(p) === wanted),
    );
  }
  return undefined;
}
