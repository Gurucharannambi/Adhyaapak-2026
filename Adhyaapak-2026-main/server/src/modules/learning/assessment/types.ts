import type { EvidenceResult, ReviewStatus } from "@adhyaapak/shared";

export interface BankOption {
  id: string;
  text: string;
  misconceptionKey?: string;
}

/** A question as the pure learning logic sees it (no database types). */
export interface BankQuestion {
  id: string;
  key: string;
  conceptId: string;
  role: "diagnostic" | "guided" | "challenge";
  difficulty: number;
  stem: string;
  options: BankOption[];
  correctOptionId: string;
  reviewStatus: ReviewStatus;
  /** Extra concepts this question also assesses (credited on correct answers only). */
  alsoAssesses?: string[];
}

/**
 * What a student (or a teacher entering paper work) gave as an answer.
 * `blank` and `unreadable` are first-class: neither is evidence of a wrong answer (principle 1).
 */
export type StudentResponse =
  | { kind: "option"; optionId: string }
  | { kind: "text"; text: string }
  | { kind: "blank" }
  | { kind: "unreadable" };

export type EvaluationReason = "correct" | "wrong_option" | "invalid_option" | "blank" | "unreadable" | "unrecognised_text";

export interface Evaluation {
  result: EvidenceResult;
  reason: EvaluationReason;
  /** The option the response resolved to, when there is one. */
  chosenOptionId?: string;
}
