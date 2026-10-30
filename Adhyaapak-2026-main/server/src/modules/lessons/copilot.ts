import type { CopilotResponse, Suggestion } from "@adhyaapak/shared";
import { RECOMMENDATION_RULES } from "./run-recommendation";

export interface CopilotFacts {
  answered: number;
  studentCount: number;
  patterns: Array<{ name: string; studentCount: number }>;
  /** Share of recorded answers that were right across the check, 0 to 1. Null when nothing was answered. */
  correctRate: number | null;
  prerequisites: Array<{ conceptId: string; title: string; assessed: number; notSecure: number }>;
  levelsAvailable: Array<"foundation" | "guided" | "challenge">;
  challengeQuestion: { id: string; stem: string } | null;
  aiAvailable: boolean;
}

const R = RECOMMENDATION_RULES;

/**
 * Turns the facts of a check into suggestions, each with the evidence that supports it and how strong that evidence is.
 * This is plain rules, so the same answers always give the same suggestions and a teacher can check them by hand. The
 * AI plays no part in deciding what the evidence means.
 */
export function buildCopilot(f: CopilotFacts): CopilotResponse {
  const base = { answered: f.answered, studentCount: f.studentCount, aiAvailable: f.aiAvailable };

  if (f.answered === 0) {
    return { ...base, basis: "no_evidence", message: "There is not enough information yet: no student has answered. Run the check and key in or collect answers first.", suggestions: [] };
  }
  const tooFew = f.answered < R.minAnswered || f.answered < Math.ceil(f.studentCount * R.minRosterShare);
  if (tooFew) {
    return {
      ...base,
      basis: "thin",
      message: `There is not enough information yet: ${f.answered} of ${f.studentCount} students have answered. One or two answers can mislead.`,
      suggestions: [{ id: "collect-more", kind: "collect_more", title: "Collect more answers before deciding", why: `Only ${f.answered} of ${f.studentCount} students have answered.`, evidence: [`${f.answered} of ${f.studentCount} students answered`], certainty: "low", action: null }],
    };
  }

  const out: Suggestion[] = [];
  const halfAnswered = f.answered >= Math.ceil(f.studentCount / 2);
  const top = [...f.patterns].sort((a, b) => b.studentCount - a.studentCount)[0];
  const patternIsCommon = !!top && top.studentCount >= R.patternMinStudents && top.studentCount >= Math.ceil(f.answered * R.patternMinShare);
  const pct = f.correctRate === null ? null : Math.round(f.correctRate * 100);

  if (patternIsCommon && top) {
    const evidence = [`${top.studentCount} answers matched the pattern "${top.name}"`, `${f.answered} of ${f.studentCount} students answered`];
    if (pct !== null) evidence.push(`${pct}% of recorded answers were right`);
    if (f.levelsAvailable.includes("foundation")) {
      out.push({
        id: "visual-explanation",
        kind: "visual_explanation",
        title: "Show a simpler visual explanation",
        why: `Several answers followed "${top.name}". This is a possible misunderstanding, not a confirmed one. A picture-first explanation tests it.`,
        evidence,
        certainty: "medium",
        action: { type: "preview_resource", level: "foundation" },
      });
    }
    out.push({
      id: "parallel-example",
      kind: "parallel_example",
      title: "Prepare a parallel example",
      why: f.aiAvailable ? "A second example with different numbers shows whether the idea transfers. The AI can draft one; you review and edit it first." : "A second example with different numbers shows whether the idea transfers. AI drafting is not available right now, so use the lesson's own guided example.",
      evidence,
      certainty: "medium",
      action: f.aiAvailable ? { type: "prepare_ai_draft", level: "guided" } : f.levelsAvailable.includes("guided") ? { type: "preview_resource", level: "guided" } : null,
    });
  }

  const weakPrereq = f.prerequisites.filter((p) => p.assessed >= R.minAnswered && p.notSecure > 0).sort((a, b) => b.notSecure / b.assessed - a.notSecure / a.assessed)[0];
  if (weakPrereq && (patternIsCommon || (f.correctRate !== null && f.correctRate < R.moveOnAt))) {
    out.push({
      id: `prerequisite-${weakPrereq.conceptId}`,
      kind: "prerequisite_check",
      title: `Check the earlier idea: ${weakPrereq.title}`,
      why: `${weakPrereq.notSecure} of ${weakPrereq.assessed} assessed students are not yet secure on an idea this lesson builds on. A short check on it would show whether the gap is there.`,
      evidence: [`${weakPrereq.notSecure} of ${weakPrereq.assessed} not yet secure on ${weakPrereq.title}`],
      certainty: weakPrereq.assessed >= Math.ceil(f.studentCount / 2) ? "medium" : "low",
      action: { type: "launch_prerequisite_check", conceptId: weakPrereq.conceptId, conceptTitle: weakPrereq.title },
    });
  }

  if (!patternIsCommon && f.correctRate !== null && f.correctRate >= R.practiseAt && f.correctRate < R.moveOnAt && f.levelsAvailable.includes("guided")) {
    out.push({ id: "guided-practice", kind: "guided_practice", title: "Work through a guided example", why: `${pct}% of answers were right and no single error pattern explains the rest. Worked examples and targeted practice should help.`, evidence: [`${pct}% of recorded answers were right`, `${f.answered} of ${f.studentCount} students answered`], certainty: halfAnswered ? "medium" : "low", action: { type: "preview_resource", level: "guided" } });
  }

  if (!patternIsCommon && f.correctRate !== null && f.correctRate >= R.moveOnAt) {
    out.push({
      id: "move-on",
      kind: "move_on",
      title: "Most of the class has it: move on",
      why: `${pct}% of answers were right and no error pattern stood out.`,
      evidence: [`${pct}% of recorded answers were right`, `${f.answered} of ${f.studentCount} students answered`],
      certainty: halfAnswered ? "high" : "medium",
      action: null,
    });
    if (f.challengeQuestion) {
      out.push({ id: "extension", kind: "extension", title: "Offer an extension question", why: "The class is secure on the basics, so a harder application can stretch those who are ready.", evidence: [`${pct}% of recorded answers were right`], certainty: halfAnswered ? "medium" : "low", action: { type: "preview_question", questionId: f.challengeQuestion.id, stem: f.challengeQuestion.stem } });
    }
  }

  if (out.length === 0) {
    return { ...base, basis: "enough", message: "The answers do not point to a clear next step. Look at the individual answers on the class map before deciding.", suggestions: [] };
  }
  return { ...base, basis: "enough", message: "These suggestions come from the recorded answers. They are possibilities for you to judge, not findings.", suggestions: out };
}
