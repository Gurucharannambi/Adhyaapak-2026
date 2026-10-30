import { z } from "zod";
import { Grade, Id, Language, Provenance, ReviewStatus } from "./common";

export const TeachingLevel = z.enum(["foundation", "guided", "challenge"]);
export type TeachingLevel = z.infer<typeof TeachingLevel>;

export const CurriculumVersionDto = z.object({
  id: Id,
  title: z.string(),
  board: z.string(),
  academicYear: z.string(),
  grade: Grade,
  subject: z.string(),
  language: Language,
  version: z.number().int(),
  reviewStatus: ReviewStatus,
});
export type CurriculumVersionDto = z.infer<typeof CurriculumVersionDto>;

export const ChapterDto = z.object({
  id: Id,
  title: z.string(),
  order: z.number().int(),
  conceptCount: z.number().int(),
  /** Our own summary of the chapter, if it has one. */
  summary: z.string().nullable(),
  keyIdeas: z.array(z.string()),
});
export type ChapterDto = z.infer<typeof ChapterDto>;

export const ConceptSummaryDto = z.object({
  id: Id,
  key: z.string(),
  title: z.string(),
  learningObjective: z.string(),
  /** Concept IDs that must be understood first. */
  prerequisiteIds: z.array(Id),
});
export type ConceptSummaryDto = z.infer<typeof ConceptSummaryDto>;

/** Instructional resource. `content` shape depends on `level`; see docs/CONTENT-PROVENANCE.md. */
export const ResourceDto = z.object({
  id: Id,
  type: z.enum(["explanation", "worked_example", "teacher_note"]),
  level: TeachingLevel.nullable(),
  title: z.string(),
  language: Language,
  content: z.record(z.string(), z.unknown()),
  provenance: Provenance,
  reviewStatus: ReviewStatus,
});
export type ResourceDto = z.infer<typeof ResourceDto>;

export const QuestionOptionDto = z.object({
  id: z.string(),
  text: z.string(),
  /** Misconception this wrong option points to. Teacher-only. */
  misconceptionKey: z.string().optional(),
});
export type QuestionOptionDto = z.infer<typeof QuestionOptionDto>;

/** Teacher view of a question, including the answer. Student-facing views (Phase 4) omit `correctOptionId`. */
export const TeacherQuestionDto = z.object({
  id: Id,
  key: z.string(),
  role: z.enum(["diagnostic", "guided", "challenge"]),
  difficulty: z.number().int().min(1).max(5),
  stem: z.string(),
  options: z.array(QuestionOptionDto),
  correctOptionId: z.string(),
  explanation: z.string(),
  reviewStatus: ReviewStatus,
});
export type TeacherQuestionDto = z.infer<typeof TeacherQuestionDto>;

export const MisconceptionDto = z.object({
  id: Id,
  key: z.string(),
  name: z.string(),
  description: z.string(),
  exampleWrongAnswers: z.array(z.string()),
  recommendedExplanation: z.string(),
  reviewStatus: ReviewStatus,
});
export type MisconceptionDto = z.infer<typeof MisconceptionDto>;

export const ConceptDetailDto = z.object({
  id: Id,
  key: z.string(),
  title: z.string(),
  description: z.string(),
  learningObjective: z.string(),
  chapter: z.object({ id: Id, title: z.string() }),
  prerequisites: z.array(z.object({ id: Id, title: z.string() })),
  dependents: z.array(z.object({ id: Id, title: z.string() })),
  resources: z.array(ResourceDto),
  questions: z.array(TeacherQuestionDto),
  misconceptions: z.array(MisconceptionDto),
  provenance: Provenance,
  reviewStatus: ReviewStatus,
});
export type ConceptDetailDto = z.infer<typeof ConceptDetailDto>;
