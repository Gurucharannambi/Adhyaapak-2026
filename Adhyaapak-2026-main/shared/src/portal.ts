import { z } from "zod";
import { Id } from "./common";

/**
 * What a student may see. Everything here is deliberately plain: friendly progress words instead of
 * diagnostic labels, no scores, no other students, no answer keys until a question has been answered.
 */
export const ProgressWord = z.enum(["just_starting", "keep_practising", "getting_there", "going_well", "ready_for_more"]);
export type ProgressWord = z.infer<typeof ProgressWord>;

export const StudentHomeResponse = z.object({
  studentName: z.string(),
  /** A teacher-started activity is waiting. */
  activityOpen: z.boolean(),
  next: z
    .object({
      kind: z.enum(["practice", "revisit", "wait_for_teacher"]),
      conceptId: Id.nullable(),
      /** How the practice is pitched. Chosen from the same policy the teacher's board uses. */
      mode: z.enum(["foundation", "guided", "challenge", "revisit"]).nullable(),
      title: z.string(),
      /** Why, in simple words. */
      why: z.string(),
      /** Roughly how long it takes. */
      minutes: z.number().int().nullable(),
    })
    .nullable(),
  progress: z.array(z.object({ conceptId: Id, title: z.string(), word: ProgressWord })),
  /** Things learned a while ago that are worth a quick look again. */
  revisit: z.array(z.object({ conceptId: Id, title: z.string() })),
});
export type StudentHomeResponse = z.infer<typeof StudentHomeResponse>;

export const PracticeSetResponse = z.object({
  setId: Id,
  title: z.string(),
  conceptTitle: z.string(),
  /** No answers and no tags. */
  questions: z.array(z.object({ id: Id, stem: z.string(), options: z.array(z.object({ id: z.string(), text: z.string() })) })),
});
export type PracticeSetResponse = z.infer<typeof PracticeSetResponse>;

export const HintResponse = z.object({ level: z.number().int().min(1).max(3), text: z.string(), more: z.boolean() });
export type HintResponse = z.infer<typeof HintResponse>;

export const SubmitPracticeRequest = z.object({
  answers: z
    .array(
      z.object({
        questionId: Id,
        optionId: z.string().min(1).max(10).nullable(),
        /** How far up the hint ladder the student went (0 = none). Used only to count the answer as weaker evidence. */
        hintLevel: z.number().int().min(0).max(3),
      }),
    )
    .min(1)
    .max(10),
});
export type SubmitPracticeRequest = z.infer<typeof SubmitPracticeRequest>;

export const PracticeResultResponse = z.object({
  /** Revealed only now, after answering. */
  results: z.array(z.object({ questionId: Id, correct: z.boolean().nullable(), correctOptionId: z.string(), explanation: z.string().nullable() })),
  message: z.string(),
});
export type PracticeResultResponse = z.infer<typeof PracticeResultResponse>;

export const SetPortalRequest = z.object({ portalEnabled: z.boolean() });
export type SetPortalRequest = z.infer<typeof SetPortalRequest>;
