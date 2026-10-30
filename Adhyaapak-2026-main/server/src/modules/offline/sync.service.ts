import { and, asc, count, desc, eq, max } from "drizzle-orm";
import { RecordResponsesPayload, type ConflictDto, type ConflictListResponse, type ConflictReason, type SyncOperation, type SyncResponse, type SyncResult, type SyncStatusResponse } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { assessmentAttempts, assessmentQuestions, assessments, classEnrolments, studentProfiles, syncOperations } from "../../db/schema";
import { AppError, conflict, notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";
import { recordAudit } from "../audit/audit.service";
import { canAccessClass } from "../classes/class.access";
import { classes } from "../../db/schema";
import { submitAttempt } from "../learning/persistence/attempt.service";
import { assessmentVersion } from "./pack.service";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

const EXPLANATIONS: Record<ConflictReason, string> = {
  pack_stale: "The questions in this activity changed after the pack was prepared, so these answers may not match the questions anymore.",
  already_answered: "The server already has answers from this student for this activity. Recorded-offline answers never overwrite them.",
};

type Row = typeof syncOperations.$inferSelect;

function resultFromRow(row: Row, duplicate: boolean): SyncResult {
  const base = { idempotencyKey: row.idempotencyKey };
  switch (row.status) {
    case "applied":
      return { ...base, status: duplicate ? "duplicate" : "applied", ...(row.attemptId ? { attemptId: row.attemptId } : {}) };
    case "conflict":
      return { ...base, status: "conflict", conflictId: row.id, message: row.message ?? EXPLANATIONS[row.reasonCode as ConflictReason] };
    case "discarded":
      return { ...base, status: "duplicate", message: "This was set aside by the teacher." };
    default:
      return { ...base, status: "rejected", message: row.message ?? "This could not be saved." };
  }
}

/** Does this actor own the class an assessment belongs to? (Offline work is only ever merged by that class's teacher.) */
async function loadAssessmentFor(db: Db, actor: Actor, assessmentId: string) {
  if (!isUuid(assessmentId)) return undefined;
  const [row] = await db.select({ a: assessments, teacherId: classes.teacherId }).from(assessments).innerJoin(classes, eq(classes.id, assessments.classId)).where(eq(assessments.id, assessmentId));
  return row && canAccessClass(actor, { teacherId: row.teacherId }) ? row.a : undefined;
}

/**
 * Applies a batch of queued operations in order. Each operation is decided on its own:
 *  - a key seen before returns its original outcome and writes nothing (safe to retry any number of times);
 *  - work for a changed question set, or for a student who already has answers, becomes a conflict for the
 *    teacher to resolve. It is never merged silently and never overwrites what the server holds;
 *  - everything else goes through the same transactional attempt pipeline as every other source.
 */
export async function processOperations(db: Db, actor: Actor, operations: SyncOperation[], requestId?: string): Promise<SyncResponse> {
  const results: SyncResult[] = [];
  for (const op of operations) results.push(await processOne(db, actor, op, requestId));
  return { results };
}

async function processOne(db: Db, actor: Actor, op: SyncOperation, requestId?: string): Promise<SyncResult> {
  const [seen] = await db.select().from(syncOperations).where(eq(syncOperations.idempotencyKey, op.idempotencyKey));
  if (seen) {
    if (seen.userId !== actor.id) return { idempotencyKey: op.idempotencyKey, status: "rejected", message: "This operation key is already in use." };
    return resultFromRow(seen, true);
  }

  const recordedAt = new Date(op.recordedAt);
  const save = async (status: Row["status"], extra: { reasonCode?: string; message?: string; attemptId?: string } = {}) => {
    try {
      const [row] = await db
        .insert(syncOperations)
        .values({
          idempotencyKey: op.idempotencyKey,
          userId: actor.id,
          operationType: op.type,
          baseVersion: op.baseVersion,
          payload: op.payload as Record<string, unknown>,
          status,
          reasonCode: extra.reasonCode ?? null,
          message: extra.message ?? null,
          attemptId: extra.attemptId ?? null,
          recordedAt: Number.isNaN(recordedAt.getTime()) ? new Date() : recordedAt,
          processedAt: new Date(),
        })
        .returning();
      return row!;
    } catch {
      // Two requests with the same key raced: the loser reports the winner's outcome.
      const [winner] = await db.select().from(syncOperations).where(eq(syncOperations.idempotencyKey, op.idempotencyKey));
      if (winner) return winner;
      throw new AppError("internal_error", "Could not record this operation.");
    }
  };
  const reject = async (message: string) => resultFromRow(await save("rejected", { reasonCode: "rejected", message }), false);

  const payload = RecordResponsesPayload.safeParse(op.payload);
  if (!payload.success) return reject("This record is not in a form the server understands.");
  const p = payload.data;

  const assessment = await loadAssessmentFor(db, actor, p.assessmentId);
  if (!assessment) return reject("This activity was not found, or it belongs to another teacher.");
  if (assessment.status === "draft") return reject("This activity has not been approved yet.");

  const [student] = await db
    .select({ id: studentProfiles.id })
    .from(classEnrolments)
    .innerJoin(studentProfiles, eq(studentProfiles.id, classEnrolments.studentId))
    .where(and(eq(classEnrolments.classId, assessment.classId), eq(classEnrolments.rosterNumber, p.rosterNumber), eq(classEnrolments.status, "active")));
  if (!student) return reject(`There is no active student with roll number ${p.rosterNumber} in this class.`);

  const toConflict = async (reason: ConflictReason) => resultFromRow(await save("conflict", { reasonCode: reason, message: EXPLANATIONS[reason] }), false);

  const [already] = await db.select({ id: assessmentAttempts.id }).from(assessmentAttempts).where(and(eq(assessmentAttempts.assessmentId, assessment.id), eq(assessmentAttempts.studentId, student.id)));
  if (already) return toConflict("already_answered");
  if (op.baseVersion !== (await assessmentVersion(db, assessment.id))) return toConflict("pack_stale");

  try {
    const done = await submitAttempt(db, {
      assessmentId: assessment.id,
      studentId: student.id,
      source: "offline_synced",
      idempotencyKey: `sync:${op.idempotencyKey}`,
      responses: p.responses.map((r) => ({ questionId: r.questionId, response: r.answer, ...(r.confidence ? { selfConfidence: r.confidence } : {}) })),
      observedAt: Number.isNaN(recordedAt.getTime()) ? new Date() : recordedAt,
      actorId: actor.id,
      ...(requestId ? { requestId } : {}),
    });
    const row = await save("applied", { attemptId: done.attemptId });
    await recordAudit(db, { actorId: actor.id, action: "sync.applied", entityType: "sync_operation", entityId: row.id, metadata: { assessmentId: assessment.id }, requestId });
    return resultFromRow(row, false);
  } catch (err) {
    if (err instanceof AppError && err.code === "conflict") return toConflict("already_answered");
    if (err instanceof AppError && err.code === "validation_error") return reject(err.message);
    throw err;
  }
}

export async function syncStatus(db: Db, actor: Actor): Promise<SyncStatusResponse> {
  const rows = await db.select({ status: syncOperations.status, n: count(), last: max(syncOperations.processedAt) }).from(syncOperations).where(eq(syncOperations.userId, actor.id)).groupBy(syncOperations.status);
  const n = (s: Row["status"]) => rows.find((r) => r.status === s)?.n ?? 0;
  const last = rows.find((r) => r.status === "applied")?.last ?? null;
  return { applied: n("applied"), conflicts: n("conflict"), rejected: n("rejected"), lastAppliedAt: last ? last.toISOString() : null };
}

export async function listConflicts(db: Db, actor: Actor): Promise<ConflictListResponse> {
  const rows = await db.select().from(syncOperations).where(and(eq(syncOperations.userId, actor.id), eq(syncOperations.status, "conflict"))).orderBy(desc(syncOperations.createdAt));
  const out: ConflictDto[] = [];
  for (const r of rows) {
    const p = RecordResponsesPayload.safeParse(r.payload);
    if (!p.success) continue;
    const [a] = await db.select().from(assessments).where(eq(assessments.id, p.data.assessmentId));
    if (!a) continue;
    const [s] = await db
      .select({ id: studentProfiles.id, name: studentProfiles.name })
      .from(classEnrolments)
      .innerJoin(studentProfiles, eq(studentProfiles.id, classEnrolments.studentId))
      .where(and(eq(classEnrolments.classId, a.classId), eq(classEnrolments.rosterNumber, p.data.rosterNumber)));
    const answered = s ? (await db.select({ id: assessmentAttempts.id }).from(assessmentAttempts).where(and(eq(assessmentAttempts.assessmentId, a.id), eq(assessmentAttempts.studentId, s.id)))).length > 0 : true;
    out.push({
      id: r.id,
      assessmentId: a.id,
      assessmentTitle: a.title,
      rosterNumber: p.data.rosterNumber,
      studentName: s?.name ?? null,
      reason: r.reasonCode as ConflictReason,
      explanation: EXPLANATIONS[r.reasonCode as ConflictReason] ?? "",
      responseCount: p.data.responses.length,
      recordedAt: r.recordedAt.toISOString(),
      canApply: !answered && r.reasonCode === "pack_stale",
    });
  }
  return { conflicts: out };
}

/**
 * The teacher's decision on a conflict. "Apply" merges only the answers whose questions are still in the
 * activity, and only if the server holds nothing for that student. "Discard" sets the recorded work aside
 * (it stays in the log). Neither can overwrite anything.
 */
export async function resolveConflict(db: Db, actor: Actor, id: string, action: "apply" | "discard", requestId?: string): Promise<{ status: "applied" | "discarded"; attemptId?: string }> {
  if (!isUuid(id)) throw notFound("Conflict not found.");
  const [row] = await db.select().from(syncOperations).where(and(eq(syncOperations.id, id), eq(syncOperations.userId, actor.id), eq(syncOperations.status, "conflict")));
  if (!row) throw notFound("Conflict not found.");

  if (action === "discard") {
    await db.update(syncOperations).set({ status: "discarded", processedAt: new Date() }).where(eq(syncOperations.id, row.id));
    await recordAudit(db, { actorId: actor.id, action: "sync.conflict_discarded", entityType: "sync_operation", entityId: row.id, requestId });
    return { status: "discarded" };
  }

  if (row.reasonCode !== "pack_stale") throw conflict("The server already has answers for this student, so these cannot be applied. Discard them instead.");
  const p = RecordResponsesPayload.parse(row.payload);
  const assessment = await loadAssessmentFor(db, actor, p.assessmentId);
  if (!assessment) throw notFound("Conflict not found.");
  const [student] = await db
    .select({ id: studentProfiles.id })
    .from(classEnrolments)
    .innerJoin(studentProfiles, eq(studentProfiles.id, classEnrolments.studentId))
    .where(and(eq(classEnrolments.classId, assessment.classId), eq(classEnrolments.rosterNumber, p.rosterNumber), eq(classEnrolments.status, "active")));
  if (!student) throw conflict("That roll number no longer belongs to an active student.");

  const current = await db.select({ q: assessmentQuestions.questionId }).from(assessmentQuestions).where(eq(assessmentQuestions.assessmentId, assessment.id)).orderBy(asc(assessmentQuestions.sequenceOrder));
  const stillThere = new Set(current.map((c) => c.q));
  const keep = p.responses.filter((r) => stillThere.has(r.questionId));
  if (keep.length === 0) throw conflict("None of these answers match the activity's current questions. Discard them instead.");

  const done = await submitAttempt(db, {
    assessmentId: assessment.id,
    studentId: student.id,
    source: "offline_synced",
    idempotencyKey: `sync:${row.idempotencyKey}`,
    responses: keep.map((r) => ({ questionId: r.questionId, response: r.answer, ...(r.confidence ? { selfConfidence: r.confidence } : {}) })),
    observedAt: row.recordedAt,
    actorId: actor.id,
    ...(requestId ? { requestId } : {}),
  });
  await db.update(syncOperations).set({ status: "applied", attemptId: done.attemptId, processedAt: new Date() }).where(eq(syncOperations.id, row.id));
  await recordAudit(db, { actorId: actor.id, action: "sync.conflict_applied", entityType: "sync_operation", entityId: row.id, requestId });
  return { status: "applied", attemptId: done.attemptId };
}
