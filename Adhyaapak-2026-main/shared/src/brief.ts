import { z } from "zod";
import { Id } from "./common";

/**
 * Tomorrow's Teaching Brief. Every line is built by code from stored records, never written freely by a model:
 * measured lines state a count and point to the records behind it; inferred lines are suggestions that name
 * the measured lines they rest on. That makes an unsupported claim structurally impossible.
 */
export const BriefSection = z.enum(["secure", "revision", "patterns", "assess", "challenge", "revisit", "activity", "follow_up", "carry_over"]);
export type BriefSection = z.infer<typeof BriefSection>;

export const BriefItemStatus = z.enum(["proposed", "accepted", "dismissed", "done"]);
export type BriefItemStatus = z.infer<typeof BriefItemStatus>;

export const EvidenceRef = z.object({
  type: z.enum(["concept_status", "misconception", "student_status", "revisit", "earlier_brief"]),
  /** Where the teacher can see the records, e.g. the learning map for a concept. */
  conceptId: Id.optional(),
  label: z.string(),
});
export type EvidenceRef = z.infer<typeof EvidenceRef>;

export const BriefItem = z.object({
  id: z.string(),
  section: BriefSection,
  /** "measured": a count from stored records. "inferred": a suggestion built on measured lines. */
  kind: z.enum(["measured", "inferred"]),
  text: z.string(),
  evidence: z.array(EvidenceRef),
  /** For inferred lines, the ids of the measured lines they rest on. */
  basedOn: z.array(z.string()),
  status: BriefItemStatus,
  /** The teacher's own wording, if they edited it. */
  editedText: z.string().nullable(),
  /** Roll numbers only, so a printed brief does not carry more than a roll book would. */
  rollNumbers: z.array(z.number().int()),
});
export type BriefItem = z.infer<typeof BriefItem>;

export const TeachingBriefDto = z.object({
  id: Id,
  classId: Id,
  className: z.string(),
  createdAt: z.string(),
  /** How much was there to go on. A brief from little evidence says so. */
  basis: z.object({ students: z.number().int(), conceptsWithEvidence: z.number().int(), answersRecorded: z.number().int() }),
  items: z.array(BriefItem),
});
export type TeachingBriefDto = z.infer<typeof TeachingBriefDto>;

export const BriefListResponse = z.object({ briefs: z.array(z.object({ id: Id, createdAt: z.string(), items: z.number().int(), accepted: z.number().int() })) });
export type BriefListResponse = z.infer<typeof BriefListResponse>;

export const UpdateBriefItemRequest = z
  .object({
    status: BriefItemStatus.optional(),
    editedText: z.string().trim().min(1).max(500).nullable().optional(),
  })
  .refine((v) => v.status !== undefined || v.editedText !== undefined, { message: "Nothing to change." });
export type UpdateBriefItemRequest = z.infer<typeof UpdateBriefItemRequest>;

// --- Home note (stretch): a plain-language page for a family ----------------

export const HomeNoteDto = z.object({
  studentFirstName: z.string(),
  className: z.string(),
  goingWell: z.array(z.string()),
  practise: z.array(z.object({ topic: z.string(), tryThese: z.array(z.string()) })),
  note: z.string(),
});
export type HomeNoteDto = z.infer<typeof HomeNoteDto>;
