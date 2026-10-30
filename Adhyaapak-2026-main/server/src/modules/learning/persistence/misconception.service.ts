import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { classEnrolments, classes, misconceptionObservations, misconceptionPatterns } from "../../../db/schema";
import { AppError, conflict, notFound } from "../../../http/errors";
import type { Actor } from "../../auth/permissions";
import { recordAudit } from "../../audit/audit.service";

/** A teacher may act on a student only if that student is (or was) in one of the teacher's classes. */
export async function canAccessStudent(db: Db, actor: Actor, studentId: string): Promise<boolean> {
  if (actor.role === "admin") return true;
  if (actor.role !== "teacher") return false;
  const rows = await db
    .select({ id: classEnrolments.id })
    .from(classEnrolments)
    .innerJoin(classes, eq(classes.id, classEnrolments.classId))
    .where(and(eq(classEnrolments.studentId, studentId), eq(classes.teacherId, actor.id)))
    .limit(1);
  return rows.length > 0;
}

/** "inconclusive": the answers do not settle it either way. The evidence is kept and new answers can reopen it. */
export type ReviewDecision = "confirm" | "reject" | "inconclusive";

/**
 * Teacher decision on a misconception for one student (CLAUDE.md §7: only a completed
 * confirmation workflow can mark a misconception confirmed).
 *  - confirm: allowed only when the pattern is "likely" (corroborated by several questions)
 *  - reject: allowed while candidate or likely; rejected observations stop counting as evidence
 * Applies to every open observation of that pattern for that student, since they form one diagnosis.
 * The decision is kept as signal (principle 4) and counted in `misconceptionStats`.
 */
export async function reviewMisconception(
  db: Db,
  actor: Actor,
  input: { studentId: string; patternId: string; decision: ReviewDecision; requestId?: string },
): Promise<{ updated: number }> {
  // Unknown student and "not your student" look identical, so ids cannot be probed.
  if (!(await canAccessStudent(db, actor, input.studentId))) throw notFound("Student not found.");

  return db.transaction(async (tx) => {
    const open = await tx
      .select()
      .from(misconceptionObservations)
      .where(and(eq(misconceptionObservations.studentId, input.studentId), eq(misconceptionObservations.patternId, input.patternId), inArray(misconceptionObservations.status, ["candidate", "likely"])));
    if (open.length === 0) throw notFound("There is no open observation of this pattern for this student.");

    if (input.decision === "confirm" && !open.some((o) => o.status === "likely")) {
      throw conflict("Only a pattern seen in several different questions can be confirmed. Gather more evidence first.");
    }
    if (input.decision !== "confirm" && input.decision !== "reject" && input.decision !== "inconclusive") throw new AppError("validation_error", "Decision must be confirm, reject or inconclusive.");

    const status = input.decision === "confirm" ? "confirmed" : input.decision === "reject" ? "rejected" : "inconclusive";
    await tx
      .update(misconceptionObservations)
      .set({ status, reviewedBy: actor.id, reviewedAt: new Date() })
      .where(inArray(misconceptionObservations.id, open.map((o) => o.id)));

    await recordAudit(tx, {
      actorId: actor.id,
      action: `misconception.${input.decision}`,
      entityType: "student",
      entityId: input.studentId,
      metadata: { patternId: input.patternId, observations: open.length },
      ...(input.requestId ? { requestId: input.requestId } : {}),
    });
    return { updated: open.length };
  });
}

export interface MisconceptionStat {
  patternId: string;
  key: string;
  name: string;
  studentsObserved: number;
  likely: number;
  confirmed: number;
  rejected: number;
  /** confirmed / (confirmed + rejected), or null until a teacher has decided on at least one. */
  confirmRate: number | null;
}

/**
 * Per-rule counts for the Misconception Atlas (standout feature 7). The confirm rate is an
 * honest usefulness signal from teachers, not proof the rule is scientifically valid.
 * Counts students, not individual wrong answers.
 */
export async function misconceptionStats(db: Db): Promise<MisconceptionStat[]> {
  const rows = await db
    .select({
      patternId: misconceptionPatterns.id,
      key: misconceptionPatterns.key,
      name: misconceptionPatterns.name,
      studentsObserved: sql<number>`count(distinct ${misconceptionObservations.studentId})`.mapWith(Number),
      likely: sql<number>`count(distinct ${misconceptionObservations.studentId}) filter (where ${misconceptionObservations.status} = 'likely')`.mapWith(Number),
      confirmed: sql<number>`count(distinct ${misconceptionObservations.studentId}) filter (where ${misconceptionObservations.status} = 'confirmed')`.mapWith(Number),
      rejected: sql<number>`count(distinct ${misconceptionObservations.studentId}) filter (where ${misconceptionObservations.status} = 'rejected')`.mapWith(Number),
    })
    .from(misconceptionPatterns)
    .leftJoin(misconceptionObservations, eq(misconceptionObservations.patternId, misconceptionPatterns.id))
    .groupBy(misconceptionPatterns.id)
    .orderBy(misconceptionPatterns.key);
  return rows.map((r) => ({ ...r, confirmRate: r.confirmed + r.rejected === 0 ? null : r.confirmed / (r.confirmed + r.rejected) }));
}
