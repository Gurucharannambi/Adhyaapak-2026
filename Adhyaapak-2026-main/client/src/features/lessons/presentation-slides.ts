import type { PresentationResponse } from "@adhyaapak/shared";

export type Slide =
  | { kind: "title"; title: string; objective: string }
  | { kind: "text"; heading: string; text: string; manipulative?: Record<string, unknown> | null }
  /** The interactive canvas for a concept that has one, shown large for the whole class. */
  | { kind: "canvas"; heading: string }
  /** Items are revealed one at a time: `visible` of `items` are shown. */
  | { kind: "steps"; heading: string; lead?: string; items: string[]; visible: number; manipulative?: Record<string, unknown> | null }
  | { kind: "question"; number: number; total: number; stem: string; options: { id: string; text: string }[] };

type Level = PresentationResponse["levels"][number];

/**
 * Builds the projector slides for one teaching level. Steps appear one at a time so the class
 * follows the reasoning rather than reading ahead. Pure function: only teaching content goes in.
 */
export function levelSlides(level: Level): Slide[] {
  const out: Slide[] = [];
  if (level.summary) out.push({ kind: "text", heading: level.title, text: level.summary, manipulative: level.manipulative });
  else if (level.manipulative) out.push({ kind: "text", heading: level.title, text: "", manipulative: level.manipulative });

  // The picture stays on screen while the steps are revealed: the steps are how the class reads the picture.
  level.steps.forEach((_, i) => out.push({ kind: "steps", heading: level.title, items: level.steps, visible: i + 1, manipulative: level.manipulative }));

  if (level.workedExample) {
    const w = level.workedExample;
    out.push({ kind: "text", heading: "Worked example", text: w.problem });
    w.steps.forEach((_, i) => out.push({ kind: "steps", heading: "Worked example", lead: w.problem, items: w.steps, visible: i + 1 }));
  }
  if (level.commonError) out.push({ kind: "text", heading: "Watch out", text: level.commonError });
  if (level.prompt) out.push({ kind: "text", heading: "Try this", text: level.prompt });
  return out;
}

export function questionSlides(questions: PresentationResponse["questions"]): Slide[] {
  return questions.map((q, i) => ({ kind: "question", number: i + 1, total: questions.length, stem: q.stem, options: q.options }));
}

/** Title slide, then the chosen level, then the class questions. */
export function buildSlides(p: PresentationResponse, level: Level["level"]): Slide[] {
  const chosen = p.levels.find((l) => l.level === level) ?? p.levels[0];
  const canvas: Slide[] = p.conceptKey === "equivalent-fractions" ? [{ kind: "canvas", heading: "Try it" }] : [];
  return [{ kind: "title", title: p.title, objective: p.learningObjective }, ...canvas, ...(chosen ? levelSlides(chosen) : []), ...questionSlides(p.questions)];
}
