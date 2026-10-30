import { and, asc, count, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type {
  AssessmentDetailDto,
  AssessmentSummaryDto,
  CreateAssessmentRequest,
  GridEntryRequest,
  GridEntryResponse,
  QuestionWithConcept,
  SuggestQuestionsRequest,
} from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { assessmentAttempts, assessmentQuestions, assessments, classEnrolments, classes, concepts, misconceptionPatterns, questionResponses, questions, studentProfiles, studentSessions } from "../../db/schema";
import { publish } from "../live/hub";
import { AppError, conflict, notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";
import { recordAudit } from "../audit/audit.service";
import { canAccessClass, loadAccessibleClass } from "../classes/class.access";
import { advanceAssessment, createAssessment } from "../learning/assessment/assessment.repo";
import { normalizeAnswer } from "../learning/assessment/evaluate";
import { prerequisitePulse, selectDiagnosticQuestions } from "../learning/assessment/selection";
import { loadConceptGraph } from "../learning/graph/graph.repo";
import { isUniqueViolation } from "../learning/persistence/db-types";
import { loadBankQuestions } from "../learning/persistence/loaders";
import { submitAttempt } from "../learning/persistence/attempt.service";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/** Loads an assessment only if the actor may access its class. Others get 404 (no probing of ids). */
export async function loadAccessibleAssessment(db: Db, actor: Actor, assessmentId: string) {
  if (!isUuid(assessmentId)) throw notFound("Activity not found.");
  const [row] = await db.select({ a: assessments, teacherId: classes.teacherId }).from(assessments).innerJoin(classes, eq(classes.id, assessments.classId)).where(eq(assessments.id, assessmentId));
  if (!row || !canAccessClass(actor, { teacherId: row.teacherId })) throw notFound("Activity not found.");
  return row.a;
}

async function toTeacherQuestions(db: Db, ids: readonly string[]): Promise<QuestionWithConcept[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ q: questions, conceptTitle: concepts.title })
    .from(questions)
    .innerJoin(concepts, eq(concepts.id, questions.conceptId))
    .where(inArray(questions.id, [...ids]));
  const byId = new Map(rows.map((r) => [r.q.id, r]));
  return ids.map((id) => {
    const { q, conceptTitle } = byId.get(id)!;
    return {
      id: q.id,
      key: q.key,
      role: q.role,
      difficulty: q.difficulty,
      stem: q.stem,
      options: q.options,
      correctOptionId: q.correctOptionId,
      explanation: q.explanation,
      reviewStatus: q.reviewStatus,
      conceptId: q.conceptId,
      conceptTitle,
    };
  });
}

/** Suggests questions for a diagnostic or a Prerequisite Pulse. The teacher edits before creating anything. */
export async function suggestQuestions(db: Db, actor: Actor, classId: string, req: SuggestQuestionsRequest): Promise<QuestionWithConcept[]> {
  await loadAccessibleClass(db, actor, classId);
  const anchorId = req.mode === "diagnostic" ? req.conceptIds[0]! : req.targetConceptId;
  const [anchor] = await db.select().from(concepts).where(eq(concepts.id, anchorId));
  if (!anchor) throw notFound("Concept not found.");
  const graph = await loadConceptGraph(db, anchor.curriculumVersionId);

  const wantedConcepts = req.mode === "diagnostic" ? req.conceptIds : graph.directPrerequisites(req.targetConceptId);
  for (const id of wantedConcepts) if (!graph.has(id)) throw new AppError("validation_error", "A concept is not part of the same curriculum.");
  if (wantedConcepts.length === 0) return [];

  const rows = await db.select({ id: questions.id }).from(questions).where(inArray(questions.conceptId, [...wantedConcepts]));
  const bank = [...(await loadBankQuestions(db, rows.map((r) => r.id))).values()];

  const picked = req.mode === "diagnostic" ? selectDiagnosticQuestions(req.conceptIds, bank, { count: req.count }) : prerequisitePulse(graph, req.targetConceptId, bank, { count: req.count });
  return toTeacherQuestions(db, picked.map((p) => p.id));
}

export async function createClassAssessment(db: Db, actor: Actor, classId: string, input: CreateAssessmentRequest, requestId?: string) {
  const cls = await loadAccessibleClass(db, actor, classId);
  const a = await createAssessment(db, { classId: cls.id, teacherId: actor.id, title: input.title, type: input.type, questionIds: input.questionIds });
  await recordAudit(db, { actorId: actor.id, action: "assessment.create", entityType: "assessment", entityId: a.id, metadata: { classId: cls.id, type: input.type }, requestId });
  return a;
}

export async function listAssessments(db: Db, actor: Actor, classId: string): Promise<AssessmentSummaryDto[]> {
  const cls = await loadAccessibleClass(db, actor, classId);
  // A student's own practice sets are private to them and are not class activities.
  const list = await db.select().from(assessments).where(and(eq(assessments.classId, cls.id), isNull(assessments.ownerStudentId))).orderBy(desc(assessments.createdAt));
  if (list.length === 0) return [];
  const ids = list.map((a) => a.id);
  const qCounts = await db.select({ id: assessmentQuestions.assessmentId, n: count() }).from(assessmentQuestions).where(inArray(assessmentQuestions.assessmentId, ids)).groupBy(assessmentQuestions.assessmentId);
  const sCounts = await db.select({ id: assessmentAttempts.assessmentId, n: count() }).from(assessmentAttempts).where(inArray(assessmentAttempts.assessmentId, ids)).groupBy(assessmentAttempts.assessmentId);
  return list.map((a) => ({
    id: a.id,
    title: a.title,
    type: a.type,
    status: a.status,
    questionCount: qCounts.find((c) => c.id === a.id)?.n ?? 0,
    submittedCount: sCounts.find((c) => c.id === a.id)?.n ?? 0,
    createdAt: a.createdAt.toISOString(),
  }));
}

/** Every class check across the teacher's classes, newest first, with the class it belongs to. */
export async function listAllAssessments(db: Db, actor: Actor): Promise<Array<AssessmentSummaryDto & { classId: string; className: string }>> {
  const mine = await db.select({ id: classes.id, name: classes.name }).from(classes).where(actor.role === "admin" ? undefined : eq(classes.teacherId, actor.id));
  const out: Array<AssessmentSummaryDto & { classId: string; className: string }> = [];
  for (const c of mine) for (const a of await listAssessments(db, actor, c.id)) out.push({ ...a, classId: c.id, className: c.name });
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getAssessmentDetail(db: Db, actor: Actor, assessmentId: string): Promise<AssessmentDetailDto> {
  const a = await loadAccessibleAssessment(db, actor, assessmentId);
  const [cls] = await db.select().from(classes).where(eq(classes.id, a.classId));

  const links = await db.select().from(assessmentQuestions).where(eq(assessmentQuestions.assessmentId, a.id)).orderBy(asc(assessmentQuestions.sequenceOrder));
  const qs = await toTeacherQuestions(db, links.map((l) => l.questionId));

  const roster = await db
    .select({ id: studentProfiles.id, name: studentProfiles.name, rosterNumber: classEnrolments.rosterNumber })
    .from(classEnrolments)
    .innerJoin(studentProfiles, eq(studentProfiles.id, classEnrolments.studentId))
    .where(and(eq(classEnrolments.classId, a.classId), eq(classEnrolments.status, "active")))
    .orderBy(asc(classEnrolments.rosterNumber));
  const attempts = await db.select({ id: assessmentAttempts.id, studentId: assessmentAttempts.studentId }).from(assessmentAttempts).where(eq(assessmentAttempts.assessmentId, a.id));
  const submitted = new Set(attempts.map((x) => x.studentId));
  const sessions = await db.select({ studentId: studentSessions.studentId }).from(studentSessions).where(and(eq(studentSessions.classId, a.classId), gt(studentSessions.expiresAt, new Date())));
  const joined = new Set(sessions.map((s) => s.studentId));

  // Per-question counts from the stored responses (only active-roster students are counted).
  const responses = attempts.length
    ? await db.select().from(questionResponses).where(inArray(questionResponses.attemptId, attempts.map((x) => x.id)))
    : [];
  const patterns = await db.select({ key: misconceptionPatterns.key, name: misconceptionPatterns.name }).from(misconceptionPatterns);
  const nameByKey = new Map(patterns.map((p) => [p.key, p.name]));
  const tallies = qs.map((q) => {
    const mine = responses.filter((r) => r.questionId === q.id);
    const options = q.options.map((o) => ({
      optionId: o.id,
      count: mine.filter((r) => chosenOptionId(q, r.responseData) === o.id).length,
      misconception: o.misconceptionKey ? (nameByKey.get(o.misconceptionKey) ?? o.misconceptionKey) : null,
    }));
    return { questionId: q.id, answered: options.reduce((s, o) => s + o.count, 0), options, insufficient: mine.filter((r) => r.result === "insufficient").length };
  });

  return {
    id: a.id,
    classId: a.classId,
    classJoinCode: cls!.joinCode,
    title: a.title,
    type: a.type,
    status: a.status,
    questions: qs,
    students: roster.map((s) => {
      const attempt = attempts.find((x) => x.studentId === s.id);
      const mine = attempt ? responses.filter((r) => r.attemptId === attempt.id) : [];
      // Live score, teacher-only. "Insufficient" (blank or unreadable) is no evidence, so it is neither right nor wrong.
      const score = attempt ? { correct: mine.filter((r) => r.result === "correct").length, answered: mine.filter((r) => r.result !== "insufficient").length, total: qs.length } : null;
      return { ...s, submitted: submitted.has(s.id), joined: joined.has(s.id) || submitted.has(s.id), score };
    }),
    resultsReleased: !!a.resultsReleasedAt,
    tallies,
  };
}

function chosenOptionId(q: QuestionWithConcept, data: Record<string, unknown>): string | undefined {
  if (data.kind === "option" && typeof data.optionId === "string") return data.optionId;
  if (data.kind === "text" && typeof data.text === "string") {
    const wanted = normalizeAnswer(data.text);
    return q.options.find((o) => normalizeAnswer(o.text) === wanted)?.id;
  }
  return undefined;
}

/**
 * Lets the students of the class see their own results (right or not yet, with the explanation). Only a closed check
 * can be released, so nobody sees an answer key while others are still answering. Safe to repeat.
 */
export async function releaseResults(db: Db, actor: Actor, assessmentId: string, requestId?: string): Promise<{ released: true }> {
  const a = await loadAccessibleAssessment(db, actor, assessmentId);
  if (a.status !== "closed") throw conflict("Close the check first. Results are shown to students only after it has closed.");
  if (!a.resultsReleasedAt) {
    await db.update(assessments).set({ resultsReleasedAt: new Date() }).where(eq(assessments.id, a.id));
    await recordAudit(db, { actorId: actor.id, action: "assessment.release_results", entityType: "assessment", entityId: a.id, requestId });
    publish(a.classId, { kind: "released", assessmentId: a.id });
  }
  return { released: true };
}

export async function changeAssessmentStatus(db: Db, actor: Actor, assessmentId: string, to: "approved" | "open" | "closed", requestId?: string) {
  const a = await loadAccessibleAssessment(db, actor, assessmentId);
  try {
    const updated = await advanceAssessment(db, a.id, to);
    await recordAudit(db, { actorId: actor.id, action: `assessment.${to}`, entityType: "assessment", entityId: a.id, requestId });
    if (to === "open" || to === "closed") publish(a.classId, { kind: to === "open" ? "opened" : "closed", assessmentId: a.id });
    return updated;
  } catch (err) {
    // The partial unique index allows only one open activity per class.
    if (isUniqueViolation(err)) throw conflict("Another activity is already open for this class. Close it first.");
    throw err;
  }
}

/**
 * Fast Entry Grid: the teacher keys in answers from paper or hand-raising. Each student is saved
 * on its own, so one problem row never blocks the rest. Re-submitting a saved student is a no-op.
 */
export async function enterGridAnswers(db: Db, actor: Actor, assessmentId: string, req: GridEntryRequest, requestId?: string): Promise<GridEntryResponse> {
  const a = await loadAccessibleAssessment(db, actor, assessmentId);
  const out: GridEntryResponse = { saved: [], alreadySubmitted: [], failed: [] };

  for (const entry of req.entries) {
    try {
      const result = await submitAttempt(db, {
        assessmentId: a.id,
        studentId: entry.studentId,
        source: "teacher_entered",
        idempotencyKey: `grid:${a.id}:${entry.studentId}`,
        responses: entry.answers.map((x) => ({ questionId: x.questionId, response: x.answer, ...(x.confidence ? { selfConfidence: x.confidence } : {}) })),
        actorId: actor.id,
        ...(requestId ? { requestId } : {}),
      });
      (result.duplicate ? out.alreadySubmitted : out.saved).push(entry.studentId);
      if (!result.duplicate) publish(a.classId, { kind: "answers", assessmentId: a.id });
    } catch (err) {
      if (err instanceof AppError && err.code === "conflict" && /already submitted/.test(err.message)) out.alreadySubmitted.push(entry.studentId);
      else out.failed.push({ studentId: entry.studentId, message: err instanceof AppError ? err.message : "Could not save this row." });
    }
  }
  return out;
}
