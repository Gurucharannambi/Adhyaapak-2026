import { and, asc, eq } from "drizzle-orm";
import type { StudentHistoryResponse } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { assessmentAttempts, assessments, classEnrolments, conceptMastery, concepts, interventions, misconceptionObservations, misconceptionPatterns, studentProfiles } from "../../db/schema";
import { notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";
import { loadAccessibleClass } from "../classes/class.access";

const ACTIVITY_LABEL: Record<string, string> = {
  prerequisite_diagnostic: "a check on an earlier concept",
  foundation_activity: "a foundation activity",
  guided_practice: "guided practice",
  challenge_activity: "a challenge activity",
  follow_up_assessment: "a follow-up check",
  revisit_question: "a revisit question",
  teacher_review: "a teacher review",
};

/** A student's learning story for the teacher: where they are now and what has happened, from stored records. */
export async function getStudentHistory(db: Db, actor: Actor, classId: string, studentId: string): Promise<StudentHistoryResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) throw notFound("Student not found.");
  const [member] = await db
    .select({ id: studentProfiles.id, name: studentProfiles.name, rosterNumber: classEnrolments.rosterNumber })
    .from(classEnrolments)
    .innerJoin(studentProfiles, eq(studentProfiles.id, classEnrolments.studentId))
    .where(and(eq(classEnrolments.classId, cls.id), eq(classEnrolments.studentId, studentId)));
  if (!member) throw notFound("Student not found.");

  const mastery = await db
    .select({ conceptId: concepts.id, title: concepts.title, status: conceptMastery.status, evidenceCount: conceptMastery.evidenceCount })
    .from(conceptMastery)
    .innerJoin(concepts, eq(concepts.id, conceptMastery.conceptId))
    .where(eq(conceptMastery.studentId, studentId))
    .orderBy(asc(concepts.conceptOrder));

  const attempts = await db
    .select({ at: assessmentAttempts.submittedAt, startedAt: assessmentAttempts.startedAt, id: assessments.id, title: assessments.title, source: assessmentAttempts.submissionSource })
    .from(assessmentAttempts)
    .innerJoin(assessments, eq(assessments.id, assessmentAttempts.assessmentId))
    .where(and(eq(assessmentAttempts.studentId, studentId), eq(assessments.classId, cls.id)));

  const obs = await db
    .select({ createdAt: misconceptionObservations.createdAt, reviewedAt: misconceptionObservations.reviewedAt, status: misconceptionObservations.status, name: misconceptionPatterns.name })
    .from(misconceptionObservations)
    .innerJoin(misconceptionPatterns, eq(misconceptionPatterns.id, misconceptionObservations.patternId))
    .where(eq(misconceptionObservations.studentId, studentId));

  const acts = await db
    .select({ i: interventions, title: concepts.title })
    .from(interventions)
    .innerJoin(concepts, eq(concepts.id, interventions.targetConceptId))
    .where(and(eq(interventions.studentId, studentId), eq(interventions.classId, cls.id)));

  const timeline: StudentHistoryResponse["timeline"] = [];
  for (const a of attempts) {
    timeline.push({ at: (a.at ?? a.startedAt).toISOString(), kind: "answered", text: `Answered “${a.title}”${a.source === "teacher_entered" ? " (entered by the teacher)" : ""}.`, link: { type: "activity", id: a.id } });
  }
  for (const o of obs) {
    if (o.status !== "rejected" || o.reviewedAt) timeline.push({ at: o.createdAt.toISOString(), kind: "pattern_seen", text: `An answer matched the pattern “${o.name}”.` });
    if (o.reviewedAt && (o.status === "confirmed" || o.status === "rejected")) {
      timeline.push({ at: o.reviewedAt.toISOString(), kind: "pattern_reviewed", text: `Teacher ${o.status === "confirmed" ? "confirmed" : "ruled out"} the pattern “${o.name}”.` });
    }
  }
  for (const { i, title } of acts) {
    const label = ACTIVITY_LABEL[i.activityType] ?? "an activity";
    timeline.push({ at: i.assignedAt.toISOString(), kind: "activity_assigned", text: `Given ${label} on “${title}”${i.movedReason ? ` (moved from the suggested group: ${i.movedReason})` : ""}.`, link: { type: "concept", id: i.targetConceptId } });
    if (i.completedAt) timeline.push({ at: i.completedAt.toISOString(), kind: i.status === "dismissed" ? "activity_dismissed" : "activity_completed", text: `${i.status === "dismissed" ? "Dismissed" : "Completed"}: ${label} on “${title}”.` });
  }
  timeline.sort((a, b) => b.at.localeCompare(a.at));

  return { student: member, mastery, timeline };
}
