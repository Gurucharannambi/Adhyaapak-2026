import type { ActivityType, EvidenceSufficiency, MasteryStatus, Recommendation } from "@adhyaapak/shared";
import { DEFAULT_LEARNING_CONFIG, type LearningConfig } from "../config";
import type { ConceptGraph } from "../graph/graph";

export const POLICY_VERSION = "policy-1.0.0";

export interface ConceptState {
  status: MasteryStatus;
  estimate: number;
  evidenceCount: number;
  evidenceIds: readonly string[];
}

export interface PastRecommendation {
  conceptId: string;
  activityType: ActivityType;
  /** The student's status on `conceptId` when it was assigned; used to see whether anything changed. */
  statusAtTime: MasteryStatus;
}

export interface RecommendInput {
  studentId: string;
  conceptId: string;
  graph: ConceptGraph;
  /** Concepts with no entry are treated as "no evidence yet". */
  masteryByConcept: ReadonlyMap<string, ConceptState>;
  /** Misconceptions with status likely or confirmed for this student on this concept. */
  misconceptions?: ReadonlyArray<{ patternId: string; name: string }>;
  history?: readonly PastRecommendation[];
  config?: LearningConfig["adaptation"];
}

const NO_EVIDENCE: ConceptState = { status: "not_enough_evidence", estimate: 0.5, evidenceCount: 0, evidenceIds: [] };

function sufficiency(count: number): EvidenceSufficiency {
  return count < 2 ? "insufficient" : count < 4 ? "limited" : "sufficient";
}

/**
 * Next-activity policy (CLAUDE.md §6 E, §7). Deterministic and explainable: every recommendation
 * carries a plain-language reason, the evidence it rests on, and whether a teacher must look at it.
 * It reads mastery statuses (which already require several items), so a single wrong answer can
 * never move a student into foundation work.
 */
export function recommendNextActivity(input: RecommendInput): Recommendation {
  const cfg = input.config ?? DEFAULT_LEARNING_CONFIG.adaptation;
  const state = input.masteryByConcept.get(input.conceptId) ?? NO_EVIDENCE;
  const misconceptions = input.misconceptions ?? [];
  const history = input.history ?? [];

  const build = (type: ActivityType, targetConceptId: string, reason: string, extra: { prerequisiteConceptIds?: string[]; evidenceIds?: readonly string[]; review: boolean; status?: MasteryStatus }): Recommendation => {
    // Anti-repetition: the same activity on the same concept with no change in status escalates to the teacher.
    const repeats = history.filter((h) => h.conceptId === targetConceptId && h.activityType === type && h.statusAtTime === state.status).length;
    const escalate = repeats >= cfg.maxActivityRepeats && type !== "teacher_review" && type !== "follow_up_assessment";
    const sufficient = sufficiency(state.evidenceCount);
    return {
      scope: { kind: "student", studentId: input.studentId },
      conceptId: targetConceptId,
      currentStatus: extra.status ?? state.status,
      activity: { type: escalate ? "teacher_review" : type },
      prerequisiteConceptIds: extra.prerequisiteConceptIds ?? [],
      evidenceIds: [...(extra.evidenceIds ?? state.evidenceIds)],
      reason: escalate ? `This activity has been assigned ${repeats} times with no change in understanding, so a different approach from the teacher is needed. (${reason})` : reason,
      evidenceSufficiency: sufficient,
      uncertainty: sufficient === "sufficient" ? "low" : sufficient === "limited" ? "medium" : "high",
      teacherReviewRequired: escalate || extra.review,
      policyVersion: POLICY_VERSION,
    };
  };

  // 1. Needs foundation: look for a supported prerequisite gap before blaming this concept.
  if (state.status === "needs_foundation") {
    const ancestors = input.graph.ancestors(input.conceptId, { maxDepth: cfg.maxPrerequisiteDepth });
    const statusOf = (id: string) => input.masteryByConcept.get(id)?.status ?? "not_enough_evidence";
    const supported = ancestors.filter((a) => statusOf(a.id) === "needs_foundation");
    const unknown = ancestors.filter((a) => statusOf(a.id) === "not_enough_evidence");
    const note = misconceptions.length ? ` Pattern seen: ${misconceptions.map((m) => m.name).join(", ")}.` : "";

    if (supported.length) {
      const deepest = supported.reduce((best, a) => (a.distance >= best.distance ? a : best));
      const prereq = input.masteryByConcept.get(deepest.id)!;
      return build("foundation_activity", deepest.id, `Several answers on this concept show difficulty, and the earlier concept it builds on also shows difficulty. Revisit that first.${note}`, {
        prerequisiteConceptIds: supported.map((a) => a.id),
        evidenceIds: [...prereq.evidenceIds, ...state.evidenceIds],
        review: true,
      });
    }
    if (unknown.length) {
      return build("prerequisite_diagnostic", unknown[0]!.id, `Several answers on this concept show difficulty, but there is not yet evidence about the concepts it builds on. Check those before assuming a gap.${note}`, {
        prerequisiteConceptIds: unknown.map((a) => a.id),
        review: false,
      });
    }
    return build("foundation_activity", input.conceptId, `Several answers show difficulty, and the concepts it builds on look fine. The difficulty seems to be in this concept itself.${note}`, { review: true });
  }

  // 2. A corroborated misconception: targeted practice, teacher confirms.
  if (misconceptions.length) {
    return build("guided_practice", input.conceptId, `Answers show a repeated pattern: ${misconceptions.map((m) => m.name).join(", ")}. Targeted worked examples that address it are suggested.`, { review: true });
  }

  switch (state.status) {
    case "not_enough_evidence":
      return build(
        "follow_up_assessment",
        input.conceptId,
        state.evidenceCount === 0 ? "There is no reviewed evidence on this concept yet." : `Only ${state.evidenceCount} reviewed answer(s) so far. One or two answers are not enough to say how well the concept is understood, so a short follow-up is suggested.`,
        { review: false },
      );
    case "developing":
      return build("guided_practice", input.conceptId, "Some answers are right and some are not. Worked examples and guided practice on this concept are suggested.", { review: false });
    case "likely_secure":
      return build("revisit_question", input.conceptId, "Recent answers suggest the concept is secure. A short question in a later lesson will check it stays that way.", { review: false });
    case "ready_for_challenge":
      return build("challenge_activity", input.conceptId, "Consistently correct answers, including a harder question. A more demanding application is suggested.", { review: false });
  }
}
