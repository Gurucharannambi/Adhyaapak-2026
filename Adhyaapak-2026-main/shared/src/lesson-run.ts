import { z } from "zod";
import { Id } from "./common";
import { QuestionWithConcept } from "./assessments";
import { GroupKey } from "./interventions";

/**
 * Where a period is in its lesson flow. Derived from the lesson run and the status of its check:
 * not_started → teaching → checking ⇄ paused → needs_wrap → done.
 */
export const RunState = z.enum(["not_started", "teaching", "checking", "paused", "needs_wrap", "done"]);
export type RunState = z.infer<typeof RunState>;

export const LessonRunDto = z.object({
  state: RunState,
  runDate: z.string(),
  assessmentId: Id.nullable(),
  startedAt: z.string().nullable(),
  wrappedAt: z.string().nullable(),
});
export type LessonRunDto = z.infer<typeof LessonRunDto>;

// --- Prepare ---------------------------------------------------------------

export const RunRecap = z.object({
  studentCount: z.number().int(),
  /** The most recent lesson wrapped up for this class, and the patterns its check showed. */
  previous: z
    .object({
      lessonTitle: z.string(),
      date: z.string(),
      patterns: z.array(z.object({ name: z.string(), studentCount: z.number().int() })),
    })
    .nullable(),
  /** Earlier ideas this lesson builds on, and how many students are not yet secure in each (from recorded answers only). */
  prerequisites: z.array(
    z.object({
      conceptId: Id,
      title: z.string(),
      assessed: z.number().int(),
      notSecure: z.number().int(),
    }),
  ),
});
export type RunRecap = z.infer<typeof RunRecap>;

// --- Check -----------------------------------------------------------------

export const StartCheckRequest = z.object({
  /** Questions chosen by the teacher (for "swap"). Left out, the server suggests three from the approved bank. */
  questionIds: z.array(Id).min(1).max(5).optional(),
});
export type StartCheckRequest = z.infer<typeof StartCheckRequest>;

export const StartCheckResponse = z.object({
  run: LessonRunDto,
  assessmentId: Id,
  questions: z.array(QuestionWithConcept),
});
export type StartCheckResponse = z.infer<typeof StartCheckResponse>;

// --- Wrap up ---------------------------------------------------------------

/**
 * What the teacher is advised to do next. Rules are deterministic and explained in `reason`; the teacher always
 * decides (CLAUDE.md §7). `sufficiency` says whether enough students answered to say anything.
 */
export const RunRecommendation = z.object({
  action: z.enum(["reteach", "practise", "move_on", "need_more_evidence"]),
  headline: z.string(),
  reason: z.string(),
  sufficiency: z.enum(["none", "thin", "enough"]),
  teacherReviewRequired: z.literal(true),
});
export type RunRecommendation = z.infer<typeof RunRecommendation>;

export const RunSummary = z.object({
  run: LessonRunDto,
  conceptId: Id,
  conceptTitle: z.string(),
  checkTitle: z.string().nullable(),
  /** Students who have answered the check, out of the active roster. */
  answered: z.number().int(),
  studentCount: z.number().int(),
  questions: z.array(
    z.object({
      questionId: Id,
      stem: z.string(),
      answered: z.number().int(),
      noEvidence: z.number().int(),
      options: z.array(z.object({ optionId: z.string(), text: z.string(), count: z.number().int(), correct: z.boolean(), pattern: z.string().nullable() })),
    }),
  ),
  patterns: z.array(z.object({ name: z.string(), studentCount: z.number().int() })),
  recommendation: RunRecommendation.nullable(),
  /** Suggested temporary groups for the next activity, from the same rules as the Branch Board. */
  groups: z.array(
    z.object({
      key: GroupKey,
      students: z.array(
        z.object({
          studentId: Id,
          rosterNumber: z.number().int(),
          name: z.string(),
          assigned: z.boolean(),
          /** Why the rules suggest this branch, from the student's recorded answers. */
          reason: z.string(),
          /** Earlier ideas the suggestion is about (for a foundation branch), by name. */
          prerequisiteTitles: z.array(z.string()),
        }),
      ),
    }),
  ),
  taught: z.boolean(),
  /** True once the teacher has let students see their own results for this check. */
  resultsReleased: z.boolean(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const WrapRequest = z.object({
  markTaught: z.boolean().default(true),
  /** Turn the suggested groups into assignments for the next period (the teacher can still change them on the Branch Board). */
  assignGroups: z.boolean().default(false),
});
export type WrapRequest = z.infer<typeof WrapRequest>;

export const WrapResponse = z.object({ run: LessonRunDto, assigned: z.number().int() });
export type WrapResponse = z.infer<typeof WrapResponse>;

// --- Needs you ---------------------------------------------------------------

export const AttentionItem = z.object({
  kind: z.enum(["paper_review", "pattern_confirm", "check_open", "needs_wrap"]),
  text: z.string(),
  /** In-app link to deal with it. */
  href: z.string(),
  count: z.number().int(),
});
export type AttentionItem = z.infer<typeof AttentionItem>;
