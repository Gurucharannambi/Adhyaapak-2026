import { z } from "zod";
import { Id } from "./common";

/**
 * Labels from CLAUDE.md §8. They are derived from explicit, configurable rules
 * and are not a measured probability.
 */
export const MasteryStatus = z.enum([
  "not_enough_evidence",
  "needs_foundation",
  "developing",
  "likely_secure",
  "ready_for_challenge",
]);
export type MasteryStatus = z.infer<typeof MasteryStatus>;

/** Derived cache. The evidence ledger is the source of truth (principle 9). */
export const ConceptMastery = z.object({
  studentId: Id,
  conceptId: Id,
  /** 0..1 internal estimate. Do NOT present as "% mastery". */
  estimate: z.number().min(0).max(1),
  status: MasteryStatus,
  evidenceCount: z.number().int().min(0),
  /** Evidence rows that produced this record, for the "Why?" drill-down. */
  evidenceIds: z.array(Id),
  algorithmVersion: z.string(),
  lastEvidenceAt: z.iso.datetime().optional(),
  updatedAt: z.iso.datetime(),
});
export type ConceptMastery = z.infer<typeof ConceptMastery>;

/** Mastery estimation sits behind this interface so BKT can replace the baseline later (CLAUDE.md §8). */
export interface MasteryEstimator {
  readonly version: string;
  estimate(input: {
    evidence: ReadonlyArray<import("./evidence").AssessmentEvidence>;
    now: Date;
  }): Pick<ConceptMastery, "estimate" | "status" | "evidenceCount" | "evidenceIds">;
}
