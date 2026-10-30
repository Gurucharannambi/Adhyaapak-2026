import { canAffectMastery, type AssessmentEvidence, type ConceptMastery, type MasteryEstimator, type MasteryStatus } from "@adhyaapak/shared";
import { DEFAULT_LEARNING_CONFIG, type LearningConfig } from "../config";

export interface EvidenceContribution {
  evidenceId: string;
  /** 1 correct, 0.5 partial, 0 incorrect. */
  score: number;
  /** Final weight = decay × difficulty × self-confidence × source. */
  weight: number;
  factors: { decay: number; difficulty: number; selfConfidence: number; source: number };
}

export interface MasteryExplanation {
  estimate: number;
  status: MasteryStatus;
  evidenceCount: number;
  evidenceIds: string[];
  /** Sum of contribution weights. Low values mean "not enough recent evidence". */
  totalWeight: number;
  contributions: EvidenceContribution[];
}

const MS_PER_DAY = 86_400_000;
const round4 = (n: number) => Math.round(n * 10_000) / 10_000;
const SCORE = { correct: 1, partial: 0.5, incorrect: 0, insufficient: 0 } as const;

/**
 * Explainable baseline (docs/ADAPTIVE-LEARNING.md). A weighted average of reviewed evidence,
 * pulled toward a neutral prior so a single answer cannot decide anything:
 *
 *   estimate = (priorWeight × priorEstimate + Σ weight × score) / (priorWeight + Σ weight)
 *   weight   = decay(age) × difficulty × self-confidence × source
 *
 * The estimate is an internal number for ordering and thresholds. It is NOT a probability of mastery.
 * Same evidence + same `now` + same config always gives the same output.
 */
export class BaselineMasteryEstimator implements MasteryEstimator {
  readonly version = "baseline-1.0.0";

  constructor(private readonly config: LearningConfig["mastery"] = DEFAULT_LEARNING_CONFIG.mastery) {}

  explain(input: { evidence: ReadonlyArray<AssessmentEvidence>; now: Date }): MasteryExplanation {
    const c = this.config;
    const eligible = input.evidence
      .filter((e) => canAffectMastery(e))
      // Stable order so the result never depends on the order rows came back from the database.
      .slice()
      .sort((a, b) => a.observedAt.localeCompare(b.observedAt) || a.id.localeCompare(b.id));

    const contributions: EvidenceContribution[] = eligible.map((e) => {
      const ageDays = Math.max(0, (input.now.getTime() - new Date(e.observedAt).getTime()) / MS_PER_DAY);
      const decay = 0.5 ** (ageDays / c.halfLifeDays);
      const difficulty = c.difficultyWeights[e.difficulty - 1] ?? 1;
      const side = e.result === "incorrect" ? c.selfConfidenceWeights.incorrect : c.selfConfidenceWeights.correct;
      const selfConfidence = e.selfConfidence ? side[e.selfConfidence] : 1;
      const source = c.sourceWeights[e.source];
      return {
        evidenceId: e.id,
        score: SCORE[e.result],
        weight: decay * difficulty * selfConfidence * source,
        factors: { decay, difficulty, selfConfidence, source },
      };
    });

    const totalWeight = contributions.reduce((s, x) => s + x.weight, 0);
    const weightedScore = contributions.reduce((s, x) => s + x.weight * x.score, 0);
    const estimate = (c.priorWeight * c.priorEstimate + weightedScore) / (c.priorWeight + totalWeight);

    const t = c.thresholds;
    const hasHardCorrect = eligible.some((e) => e.result === "correct" && e.difficulty >= t.challengeMinHardDifficulty && e.selfConfidence !== "guess");
    const n = eligible.length;

    let status: MasteryStatus;
    if (n < t.minItems || totalWeight < t.minEffectiveWeight) status = "not_enough_evidence";
    else if (estimate < t.needsFoundationBelow) status = "needs_foundation";
    else if (estimate >= t.challengeAtLeast && n >= t.challengeMinItems && hasHardCorrect) status = "ready_for_challenge";
    else if (estimate >= t.secureAtLeast && n >= t.secureMinItems) status = "likely_secure";
    else status = "developing";

    return {
      estimate: round4(estimate),
      status,
      evidenceCount: n,
      evidenceIds: eligible.map((e) => e.id),
      totalWeight: round4(totalWeight),
      contributions,
    };
  }

  estimate(input: { evidence: ReadonlyArray<AssessmentEvidence>; now: Date }): Pick<ConceptMastery, "estimate" | "status" | "evidenceCount" | "evidenceIds"> {
    const { estimate, status, evidenceCount, evidenceIds } = this.explain(input);
    return { estimate, status, evidenceCount, evidenceIds };
  }
}
