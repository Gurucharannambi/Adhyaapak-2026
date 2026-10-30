import { and, asc, eq, inArray } from "drizzle-orm";
import type { AssignRequest, AssignResponse, FollowUpRequest, InterventionDto } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { assessmentAttempts, assessmentEvidence, concepts, interventions, questionResponses, questions, studentProfiles } from "../../db/schema";
import { AppError, conflict, notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";
import { recordAudit } from "../audit/audit.service";
import { loadAccessibleClass } from "../classes/class.access";
import { advanceAssessment, createAssessment } from "../learning/assessment/assessment.repo";
import { selectDiagnosticQuestions } from "../learning/assessment/selection";
import { evaluateIntervention } from "../learning/adaptation/effectiveness";
import { groupFor } from "../learning/adaptation/groups";
import { POLICY_VERSION } from "../learning/adaptation/policy";
import { isUniqueViolation } from "../learning/persistence/db-types";
import { loadBankQuestions, loadEvidenceForStudents } from "../learning/persistence/loaders";
import { defaultEstimator } from "../learning/persistence/mastery.service";
import { DEFAULT_ACTIVITY, computeRecommendations } from "./board.service";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/**
 * Records the teacher's decisions. The server recomputes each recommendation itself, so the client
 * cannot invent a reason or evidence. A student moved to a different lane needs a stated reason.
 */
export async function assignInterventions(db: Db, actor: Actor, classId: string, req: AssignRequest, requestId?: string): Promise<AssignResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const { recs } = await computeRecommendations(db, cls.id, req.conceptId);
  const byStudent = new Map(recs.map((r) => [r.studentId, r]));

  // Moving someone away from the recommendation must be explained; check everything before saving anything.
  const unexplained = req.assignments.filter((a) => {
    const r = byStudent.get(a.studentId);
    return r && a.groupKey !== groupFor(r.rec.activity.type) && !a.movedReason;
  });
  if (unexplained.length) {
    throw new AppError(
      "validation_error",
      `Please say why you moved: ${unexplained.map((a) => byStudent.get(a.studentId)!.name).join(", ")}.`,
      unexplained.map((a) => ({ path: `assignments.${a.studentId}.movedReason`, message: "Required when you change the suggested group." })),
    );
  }

  const out: AssignResponse = { assigned: [], skipped: [] };
  for (const a of req.assignments) {
    const r = byStudent.get(a.studentId);
    if (!r) {
      out.skipped.push({ studentId: a.studentId, message: "This student is not in the class." });
      continue;
    }
    const recGroup = groupFor(r.rec.activity.type);
    const asRecommended = a.groupKey === recGroup;
    const activityType = asRecommended ? r.rec.activity.type : DEFAULT_ACTIVITY[a.groupKey];
    const targetConceptId = asRecommended ? r.rec.conceptId : req.conceptId;
    const snapshot = r.mastery.get(targetConceptId) ?? { status: "not_enough_evidence" as const, estimate: 0.5, evidenceCount: 0, evidenceIds: [] };
    try {
      const [row] = await db
        .insert(interventions)
        .values({
          classId: cls.id,
          studentId: a.studentId,
          conceptId: req.conceptId,
          targetConceptId,
          groupKey: a.groupKey,
          recommendedGroupKey: recGroup,
          activityType,
          recommendedActivityType: r.rec.activity.type,
          movedReason: asRecommended ? null : (a.movedReason ?? null),
          reason: r.rec.reason,
          evidenceIds: r.rec.evidenceIds,
          prerequisiteConceptIds: asRecommended ? r.rec.prerequisiteConceptIds : [],
          statusAtAssignment: snapshot.status,
          estimateAtAssignment: snapshot.estimate,
          evidenceCountAtAssignment: snapshot.evidenceCount,
          policyVersion: POLICY_VERSION,
          teacherNote: a.note ?? null,
          assignedBy: actor.id,
        })
        .returning({ id: interventions.id });
      out.assigned.push({ studentId: a.studentId, interventionId: row!.id });
    } catch (err) {
      if (isUniqueViolation(err)) out.skipped.push({ studentId: a.studentId, message: "Already has an active activity for this concept." });
      else throw err;
    }
  }
  if (out.assigned.length) {
    await recordAudit(db, { actorId: actor.id, action: "intervention.assign", entityType: "class", entityId: cls.id, metadata: { conceptId: req.conceptId, count: out.assigned.length, moved: req.assignments.filter((a) => a.movedReason).length }, requestId });
  }
  return out;
}

/**
 * Interventions for a class with a derived "did it help?" for each. Nothing here is stored:
 * it is recomputed from the evidence ledger, comparing the snapshot taken at assignment with
 * counted answers observed afterwards.
 */
export async function listInterventions(db: Db, actor: Actor, classId: string, conceptId?: string, now = new Date()): Promise<InterventionDto[]> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const rows = await db
    .select({ i: interventions, studentName: studentProfiles.name, targetTitle: concepts.title })
    .from(interventions)
    .innerJoin(studentProfiles, eq(studentProfiles.id, interventions.studentId))
    .innerJoin(concepts, eq(concepts.id, interventions.targetConceptId))
    .where(and(eq(interventions.classId, cls.id), conceptId && isUuid(conceptId) ? eq(interventions.conceptId, conceptId) : undefined))
    .orderBy(asc(studentProfiles.name), asc(interventions.assignedAt));
  if (rows.length === 0) return [];

  const evidence = await loadEvidenceForStudents(db, [...new Set(rows.map((r) => r.i.studentId))]);
  return rows.map(({ i, studentName, targetTitle }) => {
    const mine = evidence.filter((e) => e.studentId === i.studentId && e.conceptId === i.targetConceptId);
    const after = defaultEstimator.explain({ evidence: mine, now });
    const counted = new Set(after.evidenceIds);
    const newCounted = mine.filter((e) => counted.has(e.id) && new Date(e.observedAt) > i.assignedAt).length;
    const verdict = evaluateIntervention({ before: { status: i.statusAtAssignment, estimate: i.estimateAtAssignment }, after: { status: after.status, estimate: after.estimate }, newEvidenceCount: newCounted });
    return {
      id: i.id,
      studentId: i.studentId,
      studentName,
      groupKey: i.groupKey,
      recommendedGroupKey: i.recommendedGroupKey,
      movedReason: i.movedReason,
      activity: i.activityType,
      targetConceptId: i.targetConceptId,
      targetConceptTitle: targetTitle,
      reason: i.reason,
      note: i.teacherNote,
      status: i.status,
      assignedAt: i.assignedAt.toISOString(),
      followUpAssessmentId: i.followUpAssessmentId,
      effect: { ...verdict, before: { status: i.statusAtAssignment }, after: { status: after.status }, newEvidenceCount: newCounted },
    };
  });
}

/** Marks an activity as done or dismissed. Only an active one can change. */
export async function finishIntervention(db: Db, actor: Actor, interventionId: string, to: "completed" | "dismissed", requestId?: string) {
  if (!isUuid(interventionId)) throw notFound("Activity not found.");
  const [row] = await db.select().from(interventions).where(eq(interventions.id, interventionId));
  if (!row) throw notFound("Activity not found.");
  const cls = await loadAccessibleClass(db, actor, row.classId).catch(() => undefined);
  if (!cls) throw notFound("Activity not found.");
  if (row.status !== "assigned") throw conflict(`This activity is already ${row.status}.`);
  await db.update(interventions).set({ status: to, completedAt: new Date() }).where(and(eq(interventions.id, row.id), eq(interventions.status, "assigned")));
  await recordAudit(db, { actorId: actor.id, action: `intervention.${to}`, entityType: "intervention", entityId: row.id, requestId });
  return { id: row.id, status: to };
}

/**
 * Creates a follow-up check for the chosen interventions, from questions none of these students
 * has answered yet, and links it so the result can judge the intervention. The teacher still opens it.
 */
export async function createFollowUp(db: Db, actor: Actor, classId: string, req: FollowUpRequest, requestId?: string): Promise<{ assessmentId: string; questionCount: number }> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const rows = await db.select().from(interventions).where(and(eq(interventions.classId, cls.id), inArray(interventions.id, req.interventionIds)));
  if (rows.length !== new Set(req.interventionIds).size) throw notFound("Activity not found.");
  if (rows.some((r) => r.status !== "assigned")) throw conflict("Follow-ups can only be made for activities that are still active.");

  const studentIds = [...new Set(rows.map((r) => r.studentId))];
  const targetIds = [...new Set(rows.map((r) => r.targetConceptId))];

  // Never repeat an item any of these students has already seen.
  const seen = await db
    .select({ key: questions.key })
    .from(questionResponses)
    .innerJoin(assessmentAttempts, eq(assessmentAttempts.id, questionResponses.attemptId))
    .innerJoin(questions, eq(questions.id, questionResponses.questionId))
    .where(inArray(assessmentAttempts.studentId, studentIds));
  const exclude = new Set(seen.map((s) => s.key));

  const bankRows = await db.select({ id: questions.id }).from(questions).where(inArray(questions.conceptId, targetIds));
  const bank = [...(await loadBankQuestions(db, bankRows.map((b) => b.id))).values()];
  const picked = selectDiagnosticQuestions(targetIds, bank, { count: 3, roles: ["diagnostic", "guided"], excludeKeys: exclude });
  if (picked.length < 2) {
    throw new AppError("validation_error", "There are not enough new questions on this concept to make a fair follow-up. Add questions or use a different activity.");
  }

  const [target] = await db.select({ title: concepts.title }).from(concepts).where(eq(concepts.id, targetIds[0]!));
  const a = await createAssessment(db, { classId: cls.id, teacherId: actor.id, title: `Follow-up: ${target?.title ?? "check"}`, type: "follow_up", questionIds: picked.map((p) => p.id) });
  await advanceAssessment(db, a.id, "approved");
  await db.update(interventions).set({ followUpAssessmentId: a.id }).where(inArray(interventions.id, rows.map((r) => r.id)));
  await recordAudit(db, { actorId: actor.id, action: "intervention.follow_up", entityType: "assessment", entityId: a.id, metadata: { interventions: rows.length }, requestId });
  return { assessmentId: a.id, questionCount: picked.length };
}

