import { z } from "zod";
import { Id } from "./common";
import { TeachingLevel } from "./curriculum";

export const GenerateQuestionsRequest = z.object({
  count: z.number().int().min(1).max(3).default(2),
  /** Aim for this difficulty (1 easiest, 5 hardest). Omit to let the AI vary it. */
  difficulty: z.number().int().min(1).max(5).optional(),
});
export type GenerateQuestionsRequest = z.infer<typeof GenerateQuestionsRequest>;

export const GenerateExplanationRequest = z.object({ level: TeachingLevel });
export type GenerateExplanationRequest = z.infer<typeof GenerateExplanationRequest>;

/** Result of our own deterministic checks on a draft. `failed` blocks approval. */
export const DraftCheck = z.object({
  status: z.enum(["verified", "failed", "not_applicable"]),
  issues: z.array(z.string()),
});
export type DraftCheck = z.infer<typeof DraftCheck>;

export const DraftOption = z.object({ id: z.string(), text: z.string(), misconceptionKey: z.string().nullable() });
export type DraftOption = z.infer<typeof DraftOption>;

export const DraftQuestionDto = z.object({
  id: Id,
  key: z.string(),
  role: z.enum(["diagnostic", "guided", "challenge"]),
  difficulty: z.number().int(),
  stem: z.string(),
  options: z.array(DraftOption),
  correctOptionId: z.string(),
  explanation: z.string(),
  provenanceNote: z.string(),
  createdAt: z.string(),
  check: DraftCheck,
  /** True when nothing blocks approval right now. */
  approvable: z.boolean(),
});
export type DraftQuestionDto = z.infer<typeof DraftQuestionDto>;

export const DraftResourceContent = z.object({
  summary: z.string(),
  steps: z.array(z.string()),
  workedExample: z.object({ problem: z.string(), steps: z.array(z.string()) }).nullable(),
  commonError: z.string().nullable(),
  prompt: z.string().nullable(),
});
export type DraftResourceContent = z.infer<typeof DraftResourceContent>;

export const DraftResourceDto = z.object({
  id: Id,
  key: z.string(),
  level: TeachingLevel,
  title: z.string(),
  content: DraftResourceContent,
  provenanceNote: z.string(),
  createdAt: z.string(),
  check: DraftCheck,
  approvable: z.boolean(),
});
export type DraftResourceDto = z.infer<typeof DraftResourceDto>;

export const DraftsResponse = z.object({
  aiAvailable: z.boolean(),
  /** How many question drafts you can still ask for on this concept before reviewing some. */
  questionSlotsLeft: z.number().int(),
  questions: z.array(DraftQuestionDto),
  resources: z.array(DraftResourceDto),
});
export type DraftsResponse = z.infer<typeof DraftsResponse>;

export const GenerateQuestionsResponse = z.object({
  drafts: z.array(DraftQuestionDto),
  /** Drafts our checks threw away, with the reason. Nothing discarded is saved. */
  discarded: z.array(z.object({ reason: z.string() })),
});
export type GenerateQuestionsResponse = z.infer<typeof GenerateQuestionsResponse>;

export const UpdateQuestionDraftRequest = z.object({
  stem: z.string().trim().min(5).max(300),
  options: z.array(z.object({ id: z.string().min(1).max(5), text: z.string().trim().min(1).max(80), misconceptionKey: z.string().nullable() })).min(2).max(5),
  correctOptionId: z.string().min(1).max(5),
  difficulty: z.number().int().min(1).max(5),
  role: z.enum(["diagnostic", "guided", "challenge"]),
  explanation: z.string().trim().min(1).max(400),
});
export type UpdateQuestionDraftRequest = z.infer<typeof UpdateQuestionDraftRequest>;

export const UpdateResourceDraftRequest = z.object({
  title: z.string().trim().min(1).max(120),
  content: DraftResourceContent,
});
export type UpdateResourceDraftRequest = z.infer<typeof UpdateResourceDraftRequest>;

export const ReviewDraftRequest = z.object({
  decision: z.enum(["approve", "reject"]),
  /**
   * Required to approve anything the code could not verify itself (check status "not_applicable").
   * It is the teacher's statement that they read the answer and every option and found them correct.
   */
  checkedByHand: z.boolean().optional(),
});
export type ReviewDraftRequest = z.infer<typeof ReviewDraftRequest>;
