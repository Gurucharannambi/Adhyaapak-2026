import { z } from "zod";
import { Id } from "./common";

/** Provisional classifications from CLAUDE.md §7. Never a claim about a student's ability. */
export const DiagnosisOutcome = z.enum([
  "likely_conceptual_misconception",
  "likely_procedural_error",
  "possible_arithmetic_error",
  "possible_reading_error",
  "insufficient_evidence",
  "correct_targeted_skill",
]);
export type DiagnosisOutcome = z.infer<typeof DiagnosisOutcome>;

/** "inconclusive": the teacher looked and the answers did not settle it. It still counts as an earlier answer, so new evidence can reopen it. */
export const MisconceptionStatus = z.enum(["candidate", "likely", "confirmed", "rejected", "inconclusive"]);
export type MisconceptionStatus = z.infer<typeof MisconceptionStatus>;

export const Diagnosis = z.object({
  studentId: Id,
  conceptId: Id,
  outcome: DiagnosisOutcome,
  misconceptionPatternId: Id.optional(),
  misconceptionStatus: MisconceptionStatus.optional(),
  /** Evidence rows supporting this diagnosis. Must be non-empty unless outcome is insufficient_evidence. */
  evidenceIds: z.array(Id),
  /** Short, verifiable explanation for the teacher. No hidden model reasoning. */
  explanation: z.string(),
  followUpQuestionId: Id.optional(),
  reviewRequired: z.boolean(),
});
export type Diagnosis = z.infer<typeof Diagnosis>;
