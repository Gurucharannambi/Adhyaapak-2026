import { z } from "zod";
import { StudentPollDto } from "./polls";
import { Id } from "./common";
import { SelfConfidence } from "./evidence";
import { MasteryStatus } from "./mastery";
import { TeacherQuestionDto } from "./curriculum";

export const AssessmentType = z.enum(["diagnostic", "prerequisite_pulse", "follow_up", "practice"]);
export type AssessmentType = z.infer<typeof AssessmentType>;
export const AssessmentStatus = z.enum(["draft", "approved", "open", "closed"]);
export type AssessmentStatus = z.infer<typeof AssessmentStatus>;

// --- building an assessment (teacher) -------------------------------------

export const SuggestQuestionsRequest = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("diagnostic"), conceptIds: z.array(Id).min(1).max(5), count: z.number().int().min(2).max(5) }),
  z.object({ mode: z.literal("prerequisite_pulse"), targetConceptId: Id, count: z.number().int().min(2).max(5).default(3) }),
]);
export type SuggestQuestionsRequest = z.infer<typeof SuggestQuestionsRequest>;

export const QuestionWithConcept = TeacherQuestionDto.extend({ conceptId: Id, conceptTitle: z.string() });
export type QuestionWithConcept = z.infer<typeof QuestionWithConcept>;

export const SuggestQuestionsResponse = z.object({ questions: z.array(QuestionWithConcept) });
export type SuggestQuestionsResponse = z.infer<typeof SuggestQuestionsResponse>;

export const CreateAssessmentRequest = z.object({
  title: z.string().trim().min(1).max(120),
  type: AssessmentType,
  questionIds: z.array(Id).min(1).max(10),
});
export type CreateAssessmentRequest = z.infer<typeof CreateAssessmentRequest>;

export const AssessmentSummaryDto = z.object({
  id: Id,
  title: z.string(),
  type: AssessmentType,
  status: AssessmentStatus,
  questionCount: z.number().int(),
  submittedCount: z.number().int(),
  createdAt: z.string(),
});
export type AssessmentSummaryDto = z.infer<typeof AssessmentSummaryDto>;

export const OptionTally = z.object({ optionId: z.string(), count: z.number().int(), misconception: z.string().nullable() });
export const QuestionTally = z.object({ questionId: Id, answered: z.number().int(), options: z.array(OptionTally), insufficient: z.number().int() });

export const AssessmentDetailDto = z.object({
  id: Id,
  classId: Id,
  classJoinCode: z.string(),
  title: z.string(),
  type: AssessmentType,
  status: AssessmentStatus,
  questions: z.array(QuestionWithConcept),
  students: z.array(
    z.object({
      id: Id,
      name: z.string(),
      rosterNumber: z.number().int(),
      submitted: z.boolean(),
      /** Has this student joined on a device (an active classroom session)? */
      joined: z.boolean(),
      /** Live score for the teacher only: how many answers were right, and how many were answered at all. Null until submitted. */
      score: z.object({ correct: z.number().int(), answered: z.number().int(), total: z.number().int() }).nullable(),
    }),
  ),
  /** Set once the teacher has let students see their own results. */
  resultsReleased: z.boolean(),
  /** Per-question answer counts, from real stored responses. */
  tallies: z.array(QuestionTally),
});
export type AssessmentDetailDto = z.infer<typeof AssessmentDetailDto>;

// --- teacher entering paper answers (Fast Entry Grid) -----------------------

export const GridAnswer = z.union([
  z.object({ kind: z.literal("option"), optionId: z.string().min(1).max(10) }),
  z.object({ kind: z.literal("blank") }),
  z.object({ kind: z.literal("unreadable") }),
]);
export const GridEntryRequest = z.object({
  entries: z
    .array(
      z.object({
        studentId: Id,
        answers: z.array(z.object({ questionId: Id, answer: GridAnswer, confidence: SelfConfidence.optional() })).min(1),
      }),
    )
    .min(1)
    .max(120),
});
export type GridEntryRequest = z.infer<typeof GridEntryRequest>;

export const GridEntryResponse = z.object({
  saved: z.array(Id),
  alreadySubmitted: z.array(Id),
  failed: z.array(z.object({ studentId: Id, message: z.string() })),
});
export type GridEntryResponse = z.infer<typeof GridEntryResponse>;

// --- student side (join code + roster number) -------------------------------

export const JoinRequest = z.object({
  joinCode: z
    .string()
    .transform((s) => s.replace(/[\s-]/g, "").toUpperCase())
    .pipe(z.string().length(6)),
  rosterNumber: z.coerce.number().int().min(1).max(999),
});
export type JoinRequest = z.infer<typeof JoinRequest>;

/** A question as a student sees it: no answer key, no misconception tags, no explanation. */
export const StudentQuestionDto = z.object({
  id: Id,
  stem: z.string(),
  options: z.array(z.object({ id: z.string(), text: z.string() })),
});
export type StudentQuestionDto = z.infer<typeof StudentQuestionDto>;

/**
 * A student's own results, shown only after the teacher releases them. Friendly words per question, never a score,
 * a percentage or anything about other students.
 */
export const StudentResultDto = z.object({
  title: z.string(),
  questions: z.array(
    z.object({
      stem: z.string(),
      /** What the student chose, or null if they left it blank. */
      yourAnswer: z.string().nullable(),
      correctAnswer: z.string(),
      outcome: z.enum(["right", "not_yet", "blank"]),
      explanation: z.string(),
    }),
  ),
});
export type StudentResultDto = z.infer<typeof StudentResultDto>;

export const StudentActivityResponse = z.object({
  studentName: z.string(),
  state: z.enum(["no_activity", "ready", "submitted", "results", "poll", "paused"]),
  assessment: z.object({ id: Id, title: z.string(), questions: z.array(StudentQuestionDto) }).optional(),
  /** A quick poll the teacher has opened. Only present when `state` is "poll". */
  poll: StudentPollDto.optional(),
  results: StudentResultDto.optional(),
});
export type StudentActivityResponse = z.infer<typeof StudentActivityResponse>;

export const StudentAnswersRequest = z.object({
  idempotencyKey: z.string().min(8).max(64),
  answers: z
    .array(z.object({ questionId: Id, optionId: z.string().min(1).max(10), confidence: SelfConfidence.optional() }))
    .min(1)
    .max(10),
});
export type StudentAnswersRequest = z.infer<typeof StudentAnswersRequest>;

// --- learning map -----------------------------------------------------------

export const MapCell = z.object({
  status: MasteryStatus,
  evidenceCount: z.number().int(),
  /** Name of a likely or confirmed misconception for this student on this concept, if any. */
  pattern: z.string().nullable(),
});
export type MapCell = z.infer<typeof MapCell>;

export const LearningMapResponse = z.object({
  classId: Id,
  concepts: z.array(z.object({ id: Id, title: z.string(), counts: z.record(MasteryStatus, z.number().int()) })),
  students: z.array(z.object({ id: Id, name: z.string(), rosterNumber: z.number().int(), cells: z.record(z.string(), MapCell) })),
});
export type LearningMapResponse = z.infer<typeof LearningMapResponse>;

export const EvidenceDrilldown = z.object({
  student: z.object({ id: Id, name: z.string() }),
  concept: z.object({ id: Id, title: z.string() }),
  mastery: z.object({ status: MasteryStatus, evidenceCount: z.number().int(), algorithmVersion: z.string(), totalWeight: z.number() }),
  rows: z.array(
    z.object({
      evidenceId: Id,
      observedAt: z.string(),
      question: z.string(),
      chosen: z.string().nullable(),
      result: z.string(),
      confidence: z.string().nullable(),
      difficulty: z.number().int(),
      counted: z.boolean(),
      weight: z.number().nullable(),
      misconception: z.string().nullable(),
    }),
  ),
});
export type EvidenceDrilldown = z.infer<typeof EvidenceDrilldown>;

export const ClassMisconceptionsResponse = z.object({
  classSize: z.number().int(),
  patterns: z.array(
    z.object({
      patternId: Id,
      key: z.string(),
      name: z.string(),
      conceptId: Id,
      conceptTitle: z.string(),
      studentCount: z.number().int(),
      students: z.array(z.object({ id: Id, name: z.string(), status: z.enum(["candidate", "likely", "confirmed"]) })),
      /** Plain count sentence built from real records. */
      summary: z.string(),
      /** Misconception Mirror: anonymous class discussion prompt, no student names. */
      mirror: z.object({ prompt: z.string(), whatToShow: z.string() }),
    }),
  ),
});
export type ClassMisconceptionsResponse = z.infer<typeof ClassMisconceptionsResponse>;

export const ReviewMisconceptionRequest = z.object({ studentId: Id, patternId: Id, decision: z.enum(["confirm", "reject", "inconclusive"]) });
export type ReviewMisconceptionRequest = z.infer<typeof ReviewMisconceptionRequest>;
