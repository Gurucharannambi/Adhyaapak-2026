import type { EvidenceSource, SelfConfidence } from "@adhyaapak/shared";

/**
 * Every threshold and weight the learning engines use. These are documented defaults,
 * judgement calls rather than measured truths (docs/ADAPTIVE-LEARNING.md). Change them here,
 * never inline in logic (principle 12).
 */
export interface LearningConfig {
  mastery: {
    /** Weight of the neutral starting belief; keeps one answer from swinging the estimate to 0 or 1. */
    priorWeight: number;
    priorEstimate: number;
    /** Evidence loses half its weight after this many days. */
    halfLifeDays: number;
    /** Weight by question difficulty 1..5. */
    difficultyWeights: readonly [number, number, number, number, number];
    selfConfidenceWeights: {
      correct: Record<SelfConfidence, number>;
      incorrect: Record<SelfConfidence, number>;
    };
    sourceWeights: Record<EvidenceSource, number>;
    thresholds: {
      minItems: number;
      minEffectiveWeight: number;
      needsFoundationBelow: number;
      secureAtLeast: number;
      secureMinItems: number;
      challengeAtLeast: number;
      challengeMinItems: number;
      /** A correct, non-guessed answer at or above this difficulty is needed to be "ready for challenge". */
      challengeMinHardDifficulty: number;
    };
  };
  misconception: {
    /** Distinct questions that must show the same error pattern before it is called "likely". */
    minDistinctSignals: number;
    /** If false, an answer the student marked as a guess does not count toward corroboration. */
    guessCountsAsSignal: boolean;
  };
  adaptation: {
    /** Same activity on the same concept this many times without improvement escalates to the teacher. */
    maxActivityRepeats: number;
    /** How far up the prerequisite chain to look for a gap. */
    maxPrerequisiteDepth: number;
  };
  selection: {
    minQuestions: number;
    maxQuestions: number;
  };
  revisit: {
    /** A secure concept with no new evidence for this many days is worth a quick look again. */
    afterDays: number;
    /** Starter questions offered per concept. */
    maxQuestions: number;
  };
}

export const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  mastery: {
    priorWeight: 1,
    priorEstimate: 0.5,
    halfLifeDays: 30,
    difficultyWeights: [0.8, 1, 1.2, 1.4, 1.6],
    selfConfidenceWeights: {
      // A correct answer the student guessed says little about mastery.
      correct: { sure: 1, unsure: 0.8, guess: 0.5 },
      // A confident wrong answer is the strongest sign of a real misunderstanding.
      incorrect: { sure: 1, unsure: 0.8, guess: 0.6 },
    },
    sourceWeights: {
      device_response: 1,
      teacher_entered: 1,
      paper_reviewed: 1,
      offline_synced: 1,
      practice_activity: 0.8,
    },
    thresholds: {
      minItems: 2,
      minEffectiveWeight: 1.5,
      needsFoundationBelow: 0.4,
      secureAtLeast: 0.7,
      secureMinItems: 3,
      challengeAtLeast: 0.85,
      challengeMinItems: 4,
      challengeMinHardDifficulty: 3,
    },
  },
  misconception: { minDistinctSignals: 2, guessCountsAsSignal: false },
  adaptation: { maxActivityRepeats: 2, maxPrerequisiteDepth: 2 },
  selection: { minQuestions: 2, maxQuestions: 5 },
  revisit: { afterDays: 14, maxQuestions: 2 },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** Returns the defaults with `overrides` applied. Arrays and primitives are replaced, objects merged. */
export function withLearningConfig(overrides: DeepPartial<LearningConfig> = {}): LearningConfig {
  const merge = (base: unknown, over: unknown): unknown => {
    if (over === undefined) return base;
    if (base && over && typeof base === "object" && typeof over === "object" && !Array.isArray(base)) {
      const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
      for (const [k, v] of Object.entries(over as Record<string, unknown>)) out[k] = merge(out[k], v);
      return out;
    }
    return over;
  };
  return merge(DEFAULT_LEARNING_CONFIG, overrides) as LearningConfig;
}
