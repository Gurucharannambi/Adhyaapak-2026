import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { AttentionItem } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { assessments, classEnrolments, classes, concepts, lessonRuns, misconceptionObservations, submissionFiles } from "../../db/schema";
import type { Actor } from "../auth/permissions";

/**
 * "Needs you": the few things that are waiting on this teacher, built only from stored records.
 * A check left open, a closed check nobody wrapped up, answer-sheet photos to review, and patterns awaiting a decision.
 */
export async function getAttention(db: Db, actor: Actor): Promise<AttentionItem[]> {
  const mine = await db.select({ id: classes.id, name: classes.name }).from(classes).where(actor.role === "admin" ? undefined : eq(classes.teacherId, actor.id));
  if (mine.length === 0) return [];
  const ids = mine.map((c) => c.id);
  const nameOf = new Map(mine.map((c) => [c.id, c.name]));
  const out: AttentionItem[] = [];

  // A check still open, and closed checks that were never wrapped up.
  const runs = await db
    .select({ run: lessonRuns, status: assessments.status, concept: concepts.title })
    .from(lessonRuns)
    .innerJoin(assessments, eq(assessments.id, lessonRuns.assessmentId))
    .innerJoin(concepts, eq(concepts.id, lessonRuns.conceptId))
    .where(and(inArray(lessonRuns.classId, ids), isNotNull(lessonRuns.assessmentId), isNull(lessonRuns.wrappedAt)));
  for (const r of runs) {
    const link = `/classes/${r.run.classId}/lessons/${r.run.conceptId}`;
    if (r.status === "closed") out.push({ kind: "needs_wrap", text: `Wrap up "${r.concept}" in ${nameOf.get(r.run.classId)}: the check is finished.`, href: `${link}?step=wrap`, count: 1 });
    else out.push({ kind: "check_open", text: `A check is still open for "${r.concept}" in ${nameOf.get(r.run.classId)}.`, href: `${link}?step=check`, count: 1 });
  }

  // Answer-sheet photos waiting for review.
  const sheets = await db
    .select({ id: submissionFiles.id, assessmentId: submissionFiles.assessmentId })
    .from(submissionFiles)
    .innerJoin(assessments, eq(assessments.id, submissionFiles.assessmentId))
    .where(and(inArray(assessments.classId, ids), eq(submissionFiles.status, "needs_review")));
  if (sheets.length > 0) out.push({ kind: "paper_review", text: `${sheets.length} answer sheet${sheets.length === 1 ? "" : "s"} to review.`, href: sheets.length === 1 ? `/paper/${sheets[0]!.id}` : `/activities/${sheets[0]!.assessmentId}/paper`, count: sheets.length });

  // Patterns that have two separate signals and wait for the teacher to confirm or reject.
  const likely = await db
    .select({ student: misconceptionObservations.studentId, pattern: misconceptionObservations.patternId, classId: classEnrolments.classId })
    .from(misconceptionObservations)
    .innerJoin(classEnrolments, and(eq(classEnrolments.studentId, misconceptionObservations.studentId), eq(classEnrolments.status, "active")))
    .where(and(eq(misconceptionObservations.status, "likely"), inArray(classEnrolments.classId, ids)));
  const distinct = new Map(likely.map((l) => [`${l.student}:${l.pattern}`, l.classId]));
  if (distinct.size > 0) {
    const firstClass = [...distinct.values()][0]!;
    out.push({ kind: "pattern_confirm", text: `${distinct.size} error pattern${distinct.size === 1 ? "" : "s"} waiting for your decision.`, href: `/classes/${firstClass}/map`, count: distinct.size });
  }
  return out.slice(0, 6);
}
