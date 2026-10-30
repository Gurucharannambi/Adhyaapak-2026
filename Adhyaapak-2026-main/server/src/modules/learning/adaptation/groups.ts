import type { ActivityType, Recommendation } from "@adhyaapak/shared";

/**
 * Temporary instructional groups, not ability labels (CLAUDE.md Feature 10).
 * `follow_up` is the lane for students who need more evidence or teacher attention. They are not "struggling".
 */
export type GroupKey = "foundation" | "guided" | "challenge" | "follow_up";

export interface GroupMember {
  studentId: string;
  conceptId: string;
  activity: ActivityType;
  reason: string;
  teacherReviewRequired: boolean;
}

const GROUP_BY_ACTIVITY: Record<ActivityType, GroupKey> = {
  foundation_activity: "foundation",
  prerequisite_diagnostic: "foundation",
  guided_practice: "guided",
  challenge_activity: "challenge",
  follow_up_assessment: "follow_up",
  teacher_review: "follow_up",
  revisit_question: "guided",
};

export function groupFor(activity: ActivityType): GroupKey {
  return GROUP_BY_ACTIVITY[activity];
}

/** Proposes groups from per-student recommendations. The teacher can move anyone; this is a starting point. */
export function proposeGroups(recommendations: readonly Recommendation[]): Record<GroupKey, GroupMember[]> {
  const groups: Record<GroupKey, GroupMember[]> = { foundation: [], guided: [], challenge: [], follow_up: [] };
  for (const r of recommendations) {
    if (r.scope.kind !== "student") continue;
    groups[groupFor(r.activity.type)].push({
      studentId: r.scope.studentId,
      conceptId: r.conceptId,
      activity: r.activity.type,
      reason: r.reason,
      teacherReviewRequired: r.teacherReviewRequired,
    });
  }
  for (const list of Object.values(groups)) list.sort((a, b) => a.studentId.localeCompare(b.studentId));
  return groups;
}
