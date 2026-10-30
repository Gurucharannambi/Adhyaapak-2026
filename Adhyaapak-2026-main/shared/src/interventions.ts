import { z } from "zod";
import { Id } from "./common";
import { MasteryStatus } from "./mastery";
import { ActivityType } from "./recommendation";

/** Temporary instructional groups, not ability labels. `follow_up` = needs more evidence or teacher attention. */
export const GroupKey = z.enum(["foundation", "guided", "challenge", "follow_up"]);
export type GroupKey = z.infer<typeof GroupKey>;

export const InterventionStatus = z.enum(["assigned", "completed", "dismissed"]);
export type InterventionStatus = z.infer<typeof InterventionStatus>;

export const EffectOutcome = z.enum(["improved", "no_change", "declined", "not_enough_evidence", "evidence_gathered"]);
export type EffectOutcome = z.infer<typeof EffectOutcome>;

export const BoardCard = z.object({
  studentId: Id,
  name: z.string(),
  rosterNumber: z.number().int(),
  status: MasteryStatus,
  evidenceCount: z.number().int(),
  activity: ActivityType,
  targetConceptId: Id,
  targetConceptTitle: z.string(),
  /** Earlier concepts the recommendation is about, by name. */
  prerequisiteTitles: z.array(z.string()),
  reason: z.string(),
  uncertainty: z.enum(["low", "medium", "high"]),
  teacherReviewRequired: z.boolean(),
  suggestedMinutes: z.number().int(),
  /** Set when the student already has an active activity for this concept. */
  assigned: z.object({ interventionId: Id, groupKey: GroupKey, followUpAssessmentId: Id.nullable() }).nullable(),
});
export type BoardCard = z.infer<typeof BoardCard>;

export const BranchBoardResponse = z.object({
  conceptId: Id.nullable(),
  conceptTitle: z.string().nullable(),
  /** Concepts that have evidence in this class, for the concept picker. */
  concepts: z.array(z.object({ id: Id, title: z.string() })),
  lanes: z.object({ foundation: z.array(BoardCard), guided: z.array(BoardCard), challenge: z.array(BoardCard), follow_up: z.array(BoardCard) }),
});
export type BranchBoardResponse = z.infer<typeof BranchBoardResponse>;

export const AssignRequest = z.object({
  conceptId: Id,
  assignments: z
    .array(
      z.object({
        studentId: Id,
        /** The lane the teacher wants the student in (may differ from the recommendation). */
        groupKey: GroupKey,
        /** Required when `groupKey` differs from the recommended lane. */
        movedReason: z.string().trim().min(3).max(300).optional(),
        note: z.string().trim().max(300).optional(),
      }),
    )
    .min(1)
    .max(120),
});
export type AssignRequest = z.infer<typeof AssignRequest>;

export const AssignResponse = z.object({
  assigned: z.array(z.object({ studentId: Id, interventionId: Id })),
  skipped: z.array(z.object({ studentId: Id, message: z.string() })),
});
export type AssignResponse = z.infer<typeof AssignResponse>;

export const InterventionDto = z.object({
  id: Id,
  studentId: Id,
  studentName: z.string(),
  groupKey: GroupKey,
  recommendedGroupKey: GroupKey,
  movedReason: z.string().nullable(),
  activity: ActivityType,
  targetConceptId: Id,
  targetConceptTitle: z.string(),
  reason: z.string(),
  note: z.string().nullable(),
  status: InterventionStatus,
  assignedAt: z.string(),
  followUpAssessmentId: Id.nullable(),
  /** Derived from the evidence ledger when requested, never stored. */
  effect: z
    .object({
      outcome: EffectOutcome,
      explanation: z.string(),
      before: z.object({ status: MasteryStatus }),
      after: z.object({ status: MasteryStatus }),
      newEvidenceCount: z.number().int(),
    })
    .nullable(),
});
export type InterventionDto = z.infer<typeof InterventionDto>;

export const FollowUpRequest = z.object({
  conceptId: Id,
  interventionIds: z.array(Id).min(1).max(120),
});
export type FollowUpRequest = z.infer<typeof FollowUpRequest>;

export const StudentHistoryResponse = z.object({
  student: z.object({ id: Id, name: z.string(), rosterNumber: z.number().int() }),
  mastery: z.array(z.object({ conceptId: Id, title: z.string(), status: MasteryStatus, evidenceCount: z.number().int() })),
  timeline: z.array(
    z.object({
      at: z.string(),
      kind: z.enum(["answered", "pattern_seen", "pattern_reviewed", "activity_assigned", "activity_completed", "activity_dismissed"]),
      text: z.string(),
      link: z.object({ type: z.enum(["activity", "concept"]), id: Id }).optional(),
    }),
  ),
});
export type StudentHistoryResponse = z.infer<typeof StudentHistoryResponse>;
