import { z } from "zod";
import { Id } from "./common";

/**
 * Misconception Atlas: the library of known error patterns per concept, with how often this teacher's own
 * confirmations have supported each one. The rule-quality signal is a usefulness check from teachers, not
 * proof that a rule is scientifically valid.
 */
export const RuleQuality = z.enum(["no_data", "too_few_decisions", "holding_up", "mixed", "often_rejected"]);
export type RuleQuality = z.infer<typeof RuleQuality>;

export const AtlasRule = z.object({
  patternId: Id,
  key: z.string(),
  name: z.string(),
  category: z.string().nullable(),
  description: z.string(),
  exampleWrongAnswers: z.array(z.string()),
  recommendedExplanation: z.string(),
  followUpQuestion: z.string().nullable(),
  /** Counts of this teacher's own students. Never other teachers' classes. */
  stats: z.object({ studentsObserved: z.number().int(), likely: z.number().int(), confirmed: z.number().int(), rejected: z.number().int(), confirmRate: z.number().nullable() }),
  quality: RuleQuality,
});
export type AtlasRule = z.infer<typeof AtlasRule>;

export const AtlasResponse = z.object({
  /** How many confirm-or-reject decisions a rule needs before its quality is described at all. */
  minDecisions: z.number().int(),
  concepts: z.array(z.object({ conceptId: Id, title: z.string(), rules: z.array(AtlasRule) })),
});
export type AtlasResponse = z.infer<typeof AtlasResponse>;

export const TranslationsResponse = z.object({
  language: z.string(),
  /** Languages that have at least one translation for this concept. */
  available: z.array(z.string()),
  levels: z.array(
    z.object({
      level: z.enum(["foundation", "guided", "challenge"]),
      original: z.object({ title: z.string(), content: z.record(z.string(), z.unknown()) }).nullable(),
      translations: z.array(z.object({ language: z.string(), title: z.string(), content: z.record(z.string(), z.unknown()), reviewStatus: z.string(), note: z.string().nullable() })),
    }),
  ),
});
export type TranslationsResponse = z.infer<typeof TranslationsResponse>;

// --- Atlas workspace: diagnosis to intervention, per class ---------------------------------------------------

/** What later evidence says after a student's latest observation of a pattern. A launched activity alone is never "resolved". */
export const TrackOutcome = z.enum(["demonstrated", "partial", "same_error", "other_error", "no_new_evidence"]);
export type TrackOutcome = z.infer<typeof TrackOutcome>;

/** The teacher's review of one student's observations of one pattern. `open` = not reviewed yet. */
export const ObservationReview = z.enum(["open", "confirmed", "dismissed", "inconclusive"]);
export type ObservationReview = z.infer<typeof ObservationReview>;

/**
 * How strong the evidence for a pattern is in this class: seen once per student, seen repeatedly (in different
 * questions), or confirmed by the teacher after looking at the answers.
 */
export const EvidenceStrength = z.enum(["single", "repeated", "confirmed"]);
export type EvidenceStrength = z.infer<typeof EvidenceStrength>;

export const AtlasRecord = z.object({
  patternId: Id,
  name: z.string(),
  description: z.string(),
  recommendedExplanation: z.string(),
  concept: z.object({ id: Id, title: z.string(), chapterTitle: z.string() }),
  prerequisites: z.array(z.object({ id: Id, title: z.string() })),
  /** Students with an observation that is not dismissed. */
  affected: z.number().int(),
  /** Students in the class with any answer on this concept: the denominator for `affected`. */
  answeredOnConcept: z.number().int(),
  /** Students seen with the pattern in more than one answer. */
  repeated: z.number().int(),
  checks: z.number().int(),
  firstSeen: z.string(),
  lastSeen: z.string(),
  strength: EvidenceStrength,
  review: z.record(ObservationReview, z.number().int()),
  /** Real answers that matched the pattern, newest first. */
  responses: z.array(z.object({ studentId: Id, studentName: z.string(), question: z.string(), answer: z.string(), expected: z.string(), check: z.string(), at: z.string() })),
  students: z.array(z.object({ id: Id, name: z.string(), observations: z.number().int(), review: ObservationReview, lastSeen: z.string(), outcome: TrackOutcome })),
  track: z.record(TrackOutcome, z.number().int()),
  interventions: z.object({ assigned: z.number().int(), completed: z.number().int() }),
});
export type AtlasRecord = z.infer<typeof AtlasRecord>;

export const AtlasWorkspaceResponse = z.object({
  classId: Id,
  className: z.string(),
  studentCount: z.number().int(),
  summary: z.object({
    /** Students with repeated (not dismissed) evidence of at least one pattern. */
    needsInvestigation: z.number().int(),
    /** Concepts with at least one pattern seen repeatedly or confirmed. */
    conceptsToRevisit: z.number().int(),
    /** Students with repeated evidence that the teacher has not reviewed yet. */
    awaitingReview: z.number().int(),
  }),
  records: z.array(AtlasRecord),
});
export type AtlasWorkspaceResponse = z.infer<typeof AtlasWorkspaceResponse>;
