import { z } from "zod";
import { Id } from "./common";
import { MasteryStatus } from "./mastery";

/**
 * Insights for one class, computed from the persisted evidence ledger and the mastery records it produces. Every number
 * says what it counts; "not enough evidence" is reported as such and never as a weakness.
 */

/** Growth and recognition groups. Private to the teacher, never a ranking, and only from recorded answers. */
export const GrowthKey = z.enum(["ready_for_challenge", "recently_secure", "improved", "practice", "needs_explanation"]);
export type GrowthKey = z.infer<typeof GrowthKey>;

/** The rules behind the growth groups, so the page can state them exactly. */
export const GROWTH_RULES = {
  /** "Recently secure" and "consistent practice" look at this many days. */
  recentDays: 14,
  /** "Improved" needs at least this many counted answers on the concept. */
  improvedMinAnswers: 4,
  /** "May benefit from another explanation" needs at least this many counted answers. */
  needsMinAnswers: 2,
  /** "Consistent practice" needs at least this many practice sets in the recent window. */
  practiceMinSets: 3,
  maxPerGroup: 8,
} as const;

export const GrowthEntry = z.object({
  studentId: Id,
  name: z.string(),
  conceptId: Id.nullable(),
  conceptTitle: z.string().nullable(),
  /** The evidence behind the entry, in a sentence a teacher can check. */
  why: z.string(),
});
export type GrowthEntry = z.infer<typeof GrowthEntry>;

export const GrowthGroup = z.object({ key: GrowthKey, students: z.array(GrowthEntry) });
export type GrowthGroup = z.infer<typeof GrowthGroup>;

const Rate = z.object({ date: z.string(), title: z.string(), right: z.number().int(), of: z.number().int() });

export const InsightsResponse = z.object({
  classId: Id,
  className: z.string(),
  studentCount: z.number().int(),
  /** Lessons of this class's textbook recorded as taught. */
  coverage: z.object({ bookTitle: z.string().nullable(), taught: z.number().int(), total: z.number().int() }),
  /**
   * Student-and-concept pairs, by mastery status, over the concepts this class has any evidence on. `cells` is the
   * denominator (students × those concepts); pairs with no answers count as "not enough evidence".
   */
  distribution: z.object({ cells: z.number().int(), concepts: z.number().int(), byStatus: z.record(MasteryStatus, z.number().int()) }),
  concepts: z.array(
    z.object({
      id: Id,
      title: z.string(),
      /** Students with at least one counted answer on the concept. */
      assessed: z.number().int(),
      counts: z.record(MasteryStatus, z.number().int()),
      /** Students with a likely or teacher-confirmed error pattern on this concept. */
      patternStudents: z.number().int(),
      /** Right answers in the two most recent class checks that assessed this concept (different questions, so compare with care). */
      trend: z.object({ latest: Rate, previous: Rate.nullable() }).nullable(),
    }),
  ),
  growth: z.array(GrowthGroup),
  /** Whether any practice sets exist for this class; "consistent practice" is only shown when they do. */
  practiceRecorded: z.boolean(),
});
export type InsightsResponse = z.infer<typeof InsightsResponse>;
