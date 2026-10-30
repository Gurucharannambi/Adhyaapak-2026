import type { Diagnosis, DiagnosisOutcome, EvidenceConfidence, EvidenceResult, EvidenceReviewStatus, MisconceptionStatus, SelfConfidence } from "@adhyaapak/shared";
import { DEFAULT_LEARNING_CONFIG, type LearningConfig } from "../config";
import type { MisconceptionRule } from "./rules";

/** An earlier response by the same student that matched the same rule. */
export interface PriorSignal {
  questionId: string;
  evidenceId: string;
  selfConfidence?: SelfConfidence | undefined;
  /** A teacher-rejected observation is ignored; a confirmed one keeps the diagnosis confirmed. */
  status: MisconceptionStatus;
}

export interface DiagnoseInput {
  studentId: string;
  conceptId: string;
  current: {
    questionId: string;
    evidenceId: string;
    result: EvidenceResult;
    selfConfidence?: SelfConfidence | undefined;
    evidenceConfidence: EvidenceConfidence;
    evidenceReviewStatus: EvidenceReviewStatus;
    /** The rule this wrong answer matched, if any. */
    rule?: MisconceptionRule | undefined;
  };
  /** Earlier matches of the same rule for this student (not including `current`). */
  priorSignals: readonly PriorSignal[];
  /** The follow-up question for the matched rule, resolved from its key. */
  followUp?: { questionId: string; questionKey: string } | undefined;
  /** True if the student has already answered that follow-up correctly. */
  followUpAnsweredCorrectly: boolean;
  /** True if the student has already been asked that follow-up (right or wrong). */
  followUpAlreadyAsked: boolean;
  config?: LearningConfig["misconception"];
}

export interface DiagnosisResult extends Diagnosis {
  /** Status to store on this response's misconception observation. */
  observationStatus?: MisconceptionStatus;
}

const OUTCOME_BY_CATEGORY: Record<MisconceptionRule["trigger"]["category"], DiagnosisOutcome> = {
  conceptual: "likely_conceptual_misconception",
  procedural: "likely_procedural_error",
  arithmetic: "possible_arithmetic_error",
  reading: "possible_reading_error",
};

/**
 * Turns one response plus history into a provisional diagnosis (CLAUDE.md §7 workflow).
 * Rules this function enforces:
 *  - one wrong answer is never a "likely" misconception: it needs corroboration from
 *    `minDistinctSignals` different questions (or one plus a wrong follow-up, which is a second question);
 *  - an answer the student marked as a guess does not count toward corroboration;
 *  - unclear, unreviewed or low-confidence evidence yields "insufficient evidence", never a label;
 *  - "confirmed" is only ever set by a teacher; this function never produces it.
 */
export function diagnose(input: DiagnoseInput): DiagnosisResult {
  const cfg = input.config ?? DEFAULT_LEARNING_CONFIG.misconception;
  const { current } = input;
  const base = { studentId: input.studentId, conceptId: input.conceptId };

  if (current.result === "correct") {
    return {
      ...base,
      outcome: "correct_targeted_skill",
      evidenceIds: [current.evidenceId],
      explanation: "The response is correct for this concept.",
      reviewRequired: false,
    };
  }

  const unclear = current.result === "insufficient" || current.evidenceReviewStatus === "pending" || current.evidenceReviewStatus === "rejected" || (current.evidenceConfidence === "low" && current.evidenceReviewStatus !== "approved");
  if (unclear) {
    return {
      ...base,
      outcome: "insufficient_evidence",
      evidenceIds: [current.evidenceId],
      explanation: "The response was blank, unreadable or not yet reviewed, so it cannot show what the student understands. Ask them to answer again or review it.",
      reviewRequired: true,
    };
  }

  const rule = current.rule;
  if (!rule) {
    return {
      ...base,
      outcome: "insufficient_evidence",
      evidenceIds: [current.evidenceId],
      explanation: "The answer is incorrect but does not match a known error pattern. Ask the student to explain their working before drawing any conclusion.",
      reviewRequired: false,
    };
  }

  const counts = (sc: SelfConfidence | undefined) => cfg.guessCountsAsSignal || sc !== "guess";
  const live = input.priorSignals.filter((s) => s.status !== "rejected" && s.questionId !== current.questionId);
  const confirmed = live.find((s) => s.status === "confirmed");

  const distinct = new Map<string, string>(); // questionId -> evidenceId
  for (const s of live) if (counts(s.selfConfidence)) distinct.set(s.questionId, s.evidenceId);
  if (counts(current.selfConfidence)) distinct.set(current.questionId, current.evidenceId);
  const evidenceIds = [...new Set([...distinct.values(), current.evidenceId])];

  const outcome = OUTCOME_BY_CATEGORY[rule.trigger.category];
  const withRule = { ...base, misconceptionPatternId: rule.id };

  if (confirmed) {
    return {
      ...withRule,
      outcome,
      misconceptionStatus: "confirmed",
      observationStatus: "confirmed",
      evidenceIds,
      explanation: `Again matches "${rule.name}", which the teacher has already confirmed for this student.`,
      reviewRequired: false,
    };
  }

  if (distinct.size >= cfg.minDistinctSignals) {
    return {
      ...withRule,
      outcome,
      misconceptionStatus: "likely",
      observationStatus: "likely",
      evidenceIds,
      explanation: `${distinct.size} different questions show the same pattern: "${rule.name}". Please confirm or reject this.`,
      reviewRequired: true,
    };
  }

  if (input.followUpAnsweredCorrectly) {
    return {
      ...withRule,
      outcome: "insufficient_evidence",
      misconceptionStatus: "candidate",
      observationStatus: "candidate",
      evidenceIds,
      explanation: `One answer matched "${rule.name}", but the student then answered the follow-up correctly. It may have been a slip.`,
      reviewRequired: false,
    };
  }

  const askFollowUp = input.followUp && !input.followUpAlreadyAsked && input.followUp.questionId !== current.questionId;
  const guessed = !counts(current.selfConfidence);
  return {
    ...withRule,
    outcome: "insufficient_evidence",
    misconceptionStatus: "candidate",
    observationStatus: "candidate",
    evidenceIds,
    ...(askFollowUp ? { followUpQuestionId: input.followUp!.questionId } : {}),
    explanation: guessed
      ? `The answer matches "${rule.name}" but the student marked it as a guess, so it is not counted yet.`
      : `One answer matches "${rule.name}". One answer is not enough to say; ${askFollowUp ? "a follow-up question is suggested" : "more evidence is needed"}.`,
    reviewRequired: false,
  };
}
