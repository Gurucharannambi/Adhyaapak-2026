import type { BankQuestion } from "./types";

export interface QuestionIssue {
  code: "blank_stem" | "too_few_options" | "duplicate_option_id" | "duplicate_option_text" | "blank_option" | "correct_option_missing" | "correct_option_tagged" | "bad_difficulty";
  message: string;
}

/**
 * Metadata checks a question must pass before it is used in an assessment (CLAUDE.md §6 B).
 * Also the first gate for AI-drafted questions in Phase 5, before a teacher ever sees them.
 */
export function validateQuestion(q: BankQuestion): QuestionIssue[] {
  const issues: QuestionIssue[] = [];
  const add = (code: QuestionIssue["code"], message: string) => issues.push({ code, message });

  if (!q.stem.trim()) add("blank_stem", "The question text is empty.");
  if (!Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > 5) add("bad_difficulty", "Difficulty must be a whole number from 1 to 5.");
  if (q.options.length < 2) add("too_few_options", "A multiple-choice question needs at least two options.");

  const ids = new Set<string>();
  const texts = new Set<string>();
  for (const o of q.options) {
    if (!o.text.trim()) add("blank_option", `Option ${o.id} is empty.`);
    if (ids.has(o.id)) add("duplicate_option_id", `Option id "${o.id}" is used twice.`);
    ids.add(o.id);
    const t = o.text.trim().toLowerCase();
    if (texts.has(t)) add("duplicate_option_text", `Two options both say "${o.text}".`);
    texts.add(t);
  }

  const correct = q.options.find((o) => o.id === q.correctOptionId);
  if (!correct) add("correct_option_missing", "The marked correct answer is not one of the options.");
  else if (correct.misconceptionKey) add("correct_option_tagged", "The correct option is tagged as a misconception.");
  return issues;
}
