import type { FlowSegment } from "@adhyaapak/shared";

/** Suggested minutes per segment. A plan to adapt, not a rule. */
export const FLOW_MINUTES = { hook: 3, teach: 10, check: 5, practise: 10, exit_ticket: 3 } as const;

export interface FlowQuestion {
  id: string;
  key: string;
  role: "diagnostic" | "guided" | "challenge";
  difficulty: number;
  /** True if a wrong option on this question points to a known misconception. */
  revealsMisconception: boolean;
}

/**
 * Turns a concept's question bank into an ordered lesson plan: hook → teach → check → practise → exit ticket.
 * Deterministic, and no question appears twice. Segments that have no suitable question come back empty
 * (the screen says so), never padded with a repeat.
 */
export function buildLessonFlow(questions: readonly FlowQuestion[]): FlowSegment[] {
  const easyFirst = (a: FlowQuestion, b: FlowQuestion) => a.difficulty - b.difficulty || a.key.localeCompare(b.key);
  const diagnostic = questions.filter((q) => q.role === "diagnostic").sort(easyFirst);
  const guided = questions.filter((q) => q.role === "guided").sort(easyFirst);
  const challenge = questions.filter((q) => q.role === "challenge").sort(easyFirst);
  const used = new Set<string>();
  const take = (list: readonly FlowQuestion[], n: number, prefer?: (q: FlowQuestion) => boolean): string[] => {
    const pool = list.filter((q) => !used.has(q.id));
    const ordered = prefer ? [...pool.filter(prefer), ...pool.filter((q) => !prefer(q))] : pool;
    const picked = ordered.slice(0, n).map((q) => q.id);
    picked.forEach((id) => used.add(id));
    return picked;
  };

  // The starter is the gentlest question, so everyone can join in.
  const hook = take(diagnostic, 1);
  // The check is where wrong answers are informative, so prefer questions with tagged distractors.
  const check = take(diagnostic, 3, (q) => q.revealsMisconception);
  const practise = [...take(guided, 3), ...take(challenge, 2)];
  // The exit ticket must be unseen: a spare diagnostic question, else an unused guided one.
  const exit = take(diagnostic, 1).concat(take(guided, 1)).slice(0, 1);

  return [
    { key: "hook", minutes: FLOW_MINUTES.hook, questionIds: hook },
    { key: "teach", minutes: FLOW_MINUTES.teach, questionIds: [] },
    { key: "check", minutes: FLOW_MINUTES.check, questionIds: check },
    { key: "practise", minutes: FLOW_MINUTES.practise, questionIds: practise },
    { key: "exit_ticket", minutes: FLOW_MINUTES.exit_ticket, questionIds: exit },
  ];
}
