import { z } from "zod";
import { Grade, Id } from "./common";

export const PasteSyllabusRequest = z.object({
  title: z.string().trim().min(1).max(120),
  text: z.string().min(1).max(60_000),
});
export type PasteSyllabusRequest = z.infer<typeof PasteSyllabusRequest>;

export const SyllabusDocumentDto = z.object({
  id: Id,
  title: z.string(),
  originalFilename: z.string(),
  fileType: z.enum(["pdf", "text"]),
  pageCount: z.number().int().nullable(),
  characters: z.number().int(),
  /** The text contained wording that looks like instructions to an AI. It was still treated as plain data. */
  suspicious: z.boolean(),
  createdAt: z.string(),
  proposals: z.array(z.object({ id: Id, title: z.string(), status: z.enum(["draft", "published", "discarded"]) })),
});
export type SyllabusDocumentDto = z.infer<typeof SyllabusDocumentDto>;

export const UploadResponse = z.object({ document: SyllabusDocumentDto, alreadyUploaded: z.boolean() });
export type UploadResponse = z.infer<typeof UploadResponse>;

export const GenerateGraphRequest = z.object({
  title: z.string().trim().min(1).max(120),
  grade: Grade,
  subject: z.string().trim().min(1).max(60),
  board: z.string().trim().min(1).max(40),
  academicYear: z.string().trim().regex(/^\d{4}-\d{2}$/, "Use the form 2026-27"),
});
export type GenerateGraphRequest = z.infer<typeof GenerateGraphRequest>;

export const EdgeGrounding = z.enum(["document", "inferred", "teacher"]);
export const EdgeConfidence = z.enum(["high", "medium", "low"]);
export const EdgeDecision = z.enum(["pending", "accepted", "rejected"]);

export const ProposalConceptDto = z.object({
  id: Id,
  key: z.string(),
  title: z.string(),
  description: z.string(),
  learningObjective: z.string(),
  evidenceQuote: z.string().nullable(),
  grounded: z.boolean(),
  addedByTeacher: z.boolean(),
  position: z.number().int(),
});
export type ProposalConceptDto = z.infer<typeof ProposalConceptDto>;

export const ProposalEdgeDto = z.object({
  id: Id,
  prerequisiteConceptId: Id,
  dependentConceptId: Id,
  evidenceQuote: z.string().nullable(),
  grounding: EdgeGrounding,
  confidence: EdgeConfidence,
  decision: EdgeDecision,
});
export type ProposalEdgeDto = z.infer<typeof ProposalEdgeDto>;

export const ProposalDto = z.object({
  id: Id,
  documentId: Id,
  status: z.enum(["draft", "published", "discarded"]),
  title: z.string(),
  board: z.string(),
  academicYear: z.string(),
  grade: Grade,
  subject: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  /** What our own checks changed or dropped, in plain words. */
  notes: z.array(z.string()),
  suspiciousDocument: z.boolean(),
  concepts: z.array(ProposalConceptDto),
  edges: z.array(ProposalEdgeDto),
  /** Reasons the graph cannot be published yet. Empty when it can. */
  blockers: z.array(z.string()),
  canPublish: z.boolean(),
  publishedCurriculumVersionId: Id.nullable(),
});
export type ProposalDto = z.infer<typeof ProposalDto>;

const text = (max: number) => z.string().trim().min(1).max(max);
export const UpdateProposalConceptRequest = z.object({ title: text(80), description: text(300), learningObjective: text(200) });
export type UpdateProposalConceptRequest = z.infer<typeof UpdateProposalConceptRequest>;

export const AddProposalConceptRequest = z.object({ title: text(80), description: text(300).optional(), learningObjective: text(200).optional() });
export type AddProposalConceptRequest = z.infer<typeof AddProposalConceptRequest>;

export const DecideEdgeRequest = z.object({ decision: z.enum(["accepted", "rejected"]) });
export type DecideEdgeRequest = z.infer<typeof DecideEdgeRequest>;

export const AddEdgeRequest = z.object({ prerequisiteConceptId: Id, dependentConceptId: Id });
export type AddEdgeRequest = z.infer<typeof AddEdgeRequest>;

/** Publishing makes the curriculum visible to every teacher on this installation, so it needs an explicit yes. */
export const PublishRequest = z.object({ confirm: z.literal(true) });
export type PublishRequest = z.infer<typeof PublishRequest>;

export const PublishResponse = z.object({ curriculumVersionId: Id, version: z.number().int(), conceptCount: z.number().int(), edgeCount: z.number().int() });
export type PublishResponse = z.infer<typeof PublishResponse>;
