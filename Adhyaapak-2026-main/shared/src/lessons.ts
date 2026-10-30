import { z } from "zod";
import { Id } from "./common";
import { MasteryStatus } from "./mastery";
import { StudentQuestionDto } from "./assessments";
import { QuestionWithConcept } from "./assessments";
import { ConceptDetailDto, TeachingLevel } from "./curriculum";

export const FlowSegmentKey = z.enum(["hook", "teach", "check", "practise", "exit_ticket"]);
export type FlowSegmentKey = z.infer<typeof FlowSegmentKey>;

export const FlowSegment = z.object({
  key: FlowSegmentKey,
  minutes: z.number().int(),
  /** Questions used in this segment (ids from the concept's question bank). Empty means none available. */
  questionIds: z.array(Id),
});
export type FlowSegment = z.infer<typeof FlowSegment>;

export const LessonResponse = z.object({
  classId: Id,
  concept: ConceptDetailDto,
  /** The textbook chapter this lesson belongs to, with our own summary of it. */
  chapter: z.object({ title: z.string(), order: z.number().int(), summary: z.string().nullable(), keyIdeas: z.array(z.string()) }),
  questions: z.array(QuestionWithConcept),
  flow: z.array(FlowSegment),
  taught: z.object({ at: z.string() }).nullable(),
  /** Private class insight for this concept. Never sent to presentation mode. */
  insights: z.object({
    studentCount: z.number().int(),
    counts: z.record(MasteryStatus, z.number().int()),
    patterns: z.array(z.object({ name: z.string(), studentCount: z.number().int() })),
  }),
});
export type LessonResponse = z.infer<typeof LessonResponse>;

export const CoverageResponse = z.object({
  taughtCount: z.number().int(),
  total: z.number().int(),
  concepts: z.array(z.object({ id: Id, title: z.string(), taughtAt: z.string().nullable(), studentsWithEvidence: z.number().int() })),
});
export type CoverageResponse = z.infer<typeof CoverageResponse>;

export const MarkTaughtRequest = z.object({ taught: z.boolean() });
export type MarkTaughtRequest = z.infer<typeof MarkTaughtRequest>;

/**
 * What a projector may show: teaching content only. No answer keys, no misconception tags, no
 * teacher notes, no class or student data. The server builds this shape, so the page cannot display more.
 */
export const PresentationResponse = z.object({
  title: z.string(),
  /** Stable slug of the concept, so the projector can offer a matching interactive canvas. */
  conceptKey: z.string().optional(),
  learningObjective: z.string(),
  levels: z.array(
    z.object({
      level: TeachingLevel,
      title: z.string(),
      summary: z.string().nullable(),
      steps: z.array(z.string()),
      workedExample: z.object({ problem: z.string(), steps: z.array(z.string()) }).nullable(),
      commonError: z.string().nullable(),
      prompt: z.string().nullable(),
      manipulative: z.record(z.string(), z.unknown()).nullable(),
    }),
  ),
  questions: z.array(StudentQuestionDto),
});
export type PresentationResponse = z.infer<typeof PresentationResponse>;
