import { z } from "zod";
import { GridAnswer } from "./assessments";
import { Id } from "./common";

/** What was read from (or entered for) one question on a paper sheet. Blank and unreadable are not "wrong". */
export const PaperReading = GridAnswer;
export type PaperReading = z.infer<typeof PaperReading>;

/** How sure the reader (the model, or the teacher by hand) is about a reading. Self-reported by the model, not calibrated. */
export const Legibility = z.enum(["clear", "unsure", "unreadable"]);
export type Legibility = z.infer<typeof Legibility>;

export const PaperStatus = z.enum(["uploaded", "needs_review", "approved", "rejected"]);
export type PaperStatus = z.infer<typeof PaperStatus>;

export const PaperItemDto = z.object({
  questionId: Id,
  position: z.number().int(),
  stem: z.string(),
  options: z.array(z.object({ id: z.string(), text: z.string() })),
  /** What the reader saw. Null when nothing has been read yet (manual entry). */
  extracted: z.object({ reading: PaperReading, legibility: Legibility, note: z.string().nullable() }).nullable(),
  /** The teacher's current decision for this question, if any. */
  reviewed: z.object({ reading: PaperReading, confirmed: z.boolean() }).nullable(),
  /** True when the teacher must look at this question before approval (not clearly read, or never read). */
  needsDecision: z.boolean(),
});
export type PaperItemDto = z.infer<typeof PaperItemDto>;

export const PaperSubmissionDto = z.object({
  id: Id,
  assessmentId: Id,
  studentId: Id,
  studentName: z.string(),
  rosterNumber: z.number().int().nullable(),
  status: PaperStatus,
  imageAvailable: z.boolean(),
  /** Metadata such as location and camera details was removed from the stored copy. */
  metadataStripped: z.boolean(),
  extraction: z.object({ extractor: z.string(), processingVersion: z.string(), status: z.enum(["ok", "failed"]), createdAt: z.string() }).nullable(),
  items: z.array(PaperItemDto),
  /** Why approval is not possible yet, in plain words. */
  blockers: z.array(z.string()),
  canApprove: z.boolean(),
  deleteAfter: z.string().nullable(),
  createdAt: z.string(),
});
export type PaperSubmissionDto = z.infer<typeof PaperSubmissionDto>;

export const PaperListResponse = z.object({ submissions: z.array(PaperSubmissionDto.omit({ items: true, blockers: true })) });
export type PaperListResponse = z.infer<typeof PaperListResponse>;

export const ProcessPaperRequest = z.object({
  /** The teacher acknowledges the photo is sent to the AI provider for reading. */
  confirmSendToAi: z.literal(true),
});
export type ProcessPaperRequest = z.infer<typeof ProcessPaperRequest>;

export const ReviewPaperRequest = z.object({
  items: z
    .array(z.object({ questionId: Id, reading: PaperReading, confirmed: z.boolean() }))
    .min(1)
    .max(40),
});
export type ReviewPaperRequest = z.infer<typeof ReviewPaperRequest>;

export const ApprovePaperResponse = z.object({
  attemptId: Id,
  alreadyApproved: z.boolean(),
});
export type ApprovePaperResponse = z.infer<typeof ApprovePaperResponse>;

/** Honest record of how often the reader's output had to be changed by a teacher. */
export const PaperAccuracyDto = z.object({
  sheetsReviewed: z.number().int(),
  answersReviewed: z.number().int(),
  answersAsRead: z.number().int(),
  answersCorrectedByTeacher: z.number().int(),
  /** Of the answers the reader called "clear": how many the teacher left unchanged. */
  clearReadings: z.number().int(),
  clearReadingsUnchanged: z.number().int(),
});
export type PaperAccuracyDto = z.infer<typeof PaperAccuracyDto>;
