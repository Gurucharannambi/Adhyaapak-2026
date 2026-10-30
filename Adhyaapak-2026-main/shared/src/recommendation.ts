import { z } from "zod";
import { Id } from "./common";
import { MasteryStatus } from "./mastery";

export const ActivityType = z.enum([
  "prerequisite_diagnostic",
  "foundation_activity",
  "guided_practice",
  "challenge_activity",
  "follow_up_assessment",
  "revisit_question",
  "teacher_review",
]);
export type ActivityType = z.infer<typeof ActivityType>;

export const EvidenceSufficiency = z.enum(["insufficient", "limited", "sufficient"]);
export type EvidenceSufficiency = z.infer<typeof EvidenceSufficiency>;

/**
 * Recommendation Contract (CLAUDE.md §7). Every adaptive recommendation has this shape.
 * `scope` is either one student or a class group; both are traceable to evidence.
 */
export const Recommendation = z.object({
  scope: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("student"), studentId: Id }),
    z.object({ kind: z.literal("group"), classId: Id, studentIds: z.array(Id).min(1) }),
  ]),
  conceptId: Id,
  currentStatus: MasteryStatus.optional(),
  activity: z.object({
    type: ActivityType,
    resourceId: Id.optional(),
    suggestedMinutes: z.number().int().positive().optional(),
  }),
  prerequisiteConceptIds: z.array(Id),
  evidenceIds: z.array(Id),
  /** Plain-language reason a teacher can verify. */
  reason: z.string(),
  evidenceSufficiency: EvidenceSufficiency,
  /** Ordinal uncertainty note, not a probability. */
  uncertainty: z.enum(["low", "medium", "high"]),
  teacherReviewRequired: z.boolean(),
  /** Version of the policy that produced it, so results are reproducible. */
  policyVersion: z.string(),
});
export type Recommendation = z.infer<typeof Recommendation>;
