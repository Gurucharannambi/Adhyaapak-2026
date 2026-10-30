import { z } from "zod";
import { Id } from "./common";

/** What the student said about their own certainty (standout feature 2). */
export const SelfConfidence = z.enum(["sure", "unsure", "guess"]);
export type SelfConfidence = z.infer<typeof SelfConfidence>;

/**
 * Outcome of a single response with respect to one concept.
 * `insufficient` is a real result (principle 1): unreadable, ambiguous or unreviewed work.
 */
export const EvidenceResult = z.enum(["correct", "partial", "incorrect", "insufficient"]);
export type EvidenceResult = z.infer<typeof EvidenceResult>;

/** How the evidence was obtained, so different formats can be weighted differently. */
export const EvidenceSource = z.enum([
  "device_response",
  "teacher_entered",
  "paper_reviewed",
  "offline_synced",
  "practice_activity",
]);
export type EvidenceSource = z.infer<typeof EvidenceSource>;

/**
 * Evidence confidence is ORDINAL, not a probability (CLAUDE.md §10).
 *  - high:   deterministic check or teacher-confirmed
 *  - medium: rule-based match without confirmation
 *  - low:    machine-extracted or ambiguous; must be reviewed before it can affect mastery
 */
export const EvidenceConfidence = z.enum(["low", "medium", "high"]);
export type EvidenceConfidence = z.infer<typeof EvidenceConfidence>;

export const EvidenceReviewStatus = z.enum(["not_required", "pending", "approved", "rejected"]);
export type EvidenceReviewStatus = z.infer<typeof EvidenceReviewStatus>;

/** One row of the evidence ledger (principle 2). Immutable once written. */
export const AssessmentEvidence = z.object({
  id: Id,
  studentId: Id,
  conceptId: Id,
  questionResponseId: Id,
  source: EvidenceSource,
  result: EvidenceResult,
  /** Question difficulty, 1 (easiest) to 5. */
  difficulty: z.number().int().min(1).max(5),
  selfConfidence: SelfConfidence.optional(),
  confidence: EvidenceConfidence,
  reviewStatus: EvidenceReviewStatus,
  /** Set when the chosen option or pattern matched a known error pattern. */
  matchedMisconceptionPatternId: Id.optional(),
  observedAt: z.iso.datetime(),
});
export type AssessmentEvidence = z.infer<typeof AssessmentEvidence>;

/** Only reviewed, non-low-confidence evidence may update mastery (CLAUDE.md §7, §11). */
export function canAffectMastery(e: Pick<AssessmentEvidence, "confidence" | "reviewStatus" | "result">): boolean {
  if (e.result === "insufficient") return false;
  if (e.reviewStatus === "pending" || e.reviewStatus === "rejected") return false;
  if (e.confidence === "low" && e.reviewStatus !== "approved") return false;
  return true;
}
