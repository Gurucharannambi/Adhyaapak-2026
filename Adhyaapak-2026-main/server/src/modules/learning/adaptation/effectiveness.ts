import type { MasteryStatus } from "@adhyaapak/shared";

export type EffectOutcome = "improved" | "no_change" | "declined" | "not_enough_evidence" | "evidence_gathered";

export interface EffectInput {
  /** The student's state on the target concept when the activity was assigned. */
  before: { status: MasteryStatus; estimate: number };
  /** The state now, recomputed from the evidence ledger. */
  after: { status: MasteryStatus; estimate: number };
  /** Counted (eligible) evidence on the target concept observed AFTER the assignment. */
  newEvidenceCount: number;
}

export interface EffectConfig {
  /** New counted answers needed before any claim about change is made. */
  minNewEvidence: number;
  /** Change in the internal estimate that counts as real movement within the same status. */
  estimateDelta: number;
}

export const DEFAULT_EFFECT_CONFIG: EffectConfig = { minNewEvidence: 2, estimateDelta: 0.15 };

// not_enough_evidence is not on this scale: it means "no judgement yet", not "lowest".
const RANK: Record<Exclude<MasteryStatus, "not_enough_evidence">, number> = { needs_foundation: 0, developing: 1, likely_secure: 2, ready_for_challenge: 3 };

/**
 * "Did the intervention work?" (CLAUDE.md §4). Deliberately conservative:
 *  - fewer than `minNewEvidence` new counted answers → "not enough evidence", never a claim of improvement;
 *  - a student with no earlier judgement who now has one → "evidence gathered" (we learned something, nothing changed);
 *  - otherwise compare status, then the estimate if the status did not move.
 */
export function evaluateIntervention(input: EffectInput, config: EffectConfig = DEFAULT_EFFECT_CONFIG): { outcome: EffectOutcome; explanation: string } {
  const { before, after, newEvidenceCount } = input;
  if (newEvidenceCount < config.minNewEvidence) {
    return {
      outcome: "not_enough_evidence",
      explanation: `Only ${newEvidenceCount} new counted answer${newEvidenceCount === 1 ? "" : "s"} since the activity. At least ${config.minNewEvidence} are needed before saying whether it helped.`,
    };
  }
  if (after.status === "not_enough_evidence") {
    return { outcome: "not_enough_evidence", explanation: "Recent answers are too few or too old to give a status. Ask a short follow-up." };
  }
  if (before.status === "not_enough_evidence") {
    return { outcome: "evidence_gathered", explanation: "There was no earlier judgement to compare with. The new answers give a starting point." };
  }
  const b = RANK[before.status];
  const a = RANK[after.status];
  if (a > b) return { outcome: "improved", explanation: "The status moved up, based on new answers." };
  if (a < b) return { outcome: "declined", explanation: "The status moved down, based on new answers." };
  const delta = after.estimate - before.estimate;
  if (delta >= config.estimateDelta) return { outcome: "improved", explanation: "Same status, but answers are noticeably stronger than before." };
  if (delta <= -config.estimateDelta) return { outcome: "declined", explanation: "Same status, but answers are noticeably weaker than before." };
  return { outcome: "no_change", explanation: "New answers look similar to before." };
}
