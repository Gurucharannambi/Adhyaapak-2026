import type { RunRecommendation } from "@adhyaapak/shared";

/**
 * Thresholds for the wrap-up advice. They are explicit and deliberately simple so a teacher can check the advice by
 * hand; they are a starting point, not a validated model (CLAUDE.md §7: do not invent precision).
 */
export const RECOMMENDATION_RULES = {
  /** Fewer answers than this, or fewer than this share of the roster, is too little to say anything. */
  minAnswered: 3,
  minRosterShare: 0.25,
  /** A pattern chosen by at least this many students (and this share of those who answered) is worth re-teaching. */
  patternMinStudents: 3,
  patternMinShare: 0.25,
  /** Share of answers that were correct, over the whole check. */
  moveOnAt: 0.8,
  practiseAt: 0.6,
} as const;

export interface CheckFacts {
  /** Students who have answered the check. */
  answered: number;
  studentCount: number;
  questions: Array<{ answered: number; correct: number; options: Array<{ count: number; pattern: string | null }> }>;
}

/** Turns the facts of a check into advice. Returns null until at least one student has answered. */
export function recommendFromCheck(f: CheckFacts): RunRecommendation | null {
  const R = RECOMMENDATION_RULES;
  if (f.answered === 0) return null;

  const tooFew = f.answered < R.minAnswered || f.answered < Math.ceil(f.studentCount * R.minRosterShare);
  if (tooFew) {
    return {
      action: "need_more_evidence",
      headline: "Not enough answers yet to decide",
      reason: `${f.answered} of ${f.studentCount} students have answered. Key in more answers before deciding; one or two answers can mislead.`,
      sufficiency: f.answered < R.minAnswered ? "none" : "thin",
      teacherReviewRequired: true,
    };
  }

  // The most-chosen answer pattern across the questions.
  const byPattern = new Map<string, number>();
  for (const q of f.questions) for (const o of q.options) if (o.pattern && o.count > 0) byPattern.set(o.pattern, (byPattern.get(o.pattern) ?? 0) + o.count);
  const top = [...byPattern.entries()].sort((a, b) => b[1] - a[1])[0];
  const totalAnswers = f.questions.reduce((s, q) => s + q.answered, 0);
  const correct = f.questions.reduce((s, q) => s + q.correct, 0);
  const rate = totalAnswers ? correct / totalAnswers : 0;
  const pct = Math.round(rate * 100);

  if (top && top[1] >= R.patternMinStudents && top[1] >= Math.ceil(totalAnswers * R.patternMinShare)) {
    return {
      action: "reteach",
      headline: `Re-explain: ${top[1]} answers followed the pattern "${top[0]}"`,
      reason: `${top[1]} of ${totalAnswers} answers matched this error pattern, and ${pct}% of answers were correct overall. A pattern seen this often is worth a short re-teach with a picture before moving on. This is provisional: check a few answers yourself.`,
      sufficiency: "enough",
      teacherReviewRequired: true,
    };
  }
  if (rate >= R.moveOnAt) {
    return { action: "move_on", headline: "Most of the class has it. You can move on", reason: `${pct}% of answers were correct and no error pattern stood out. Plan a short check of the few who missed it.`, sufficiency: "enough", teacherReviewRequired: true };
  }
  if (rate >= R.practiseAt) {
    return { action: "practise", headline: "Mostly there. Give guided practice", reason: `${pct}% of answers were correct, but no single error pattern explains the rest. Worked examples and targeted practice should help.`, sufficiency: "enough", teacherReviewRequired: true };
  }
  return { action: "reteach", headline: "Many students are not there yet. Re-teach", reason: `Only ${pct}% of answers were correct and no single error pattern explains it. Go back to a picture or an earlier idea before moving on.`, sufficiency: "enough", teacherReviewRequired: true };
}
