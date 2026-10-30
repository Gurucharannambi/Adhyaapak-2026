import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { OfflinePackDto, PackListResponse } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { assessmentAttempts, assessmentQuestions, assessments, classEnrolments, classes, concepts, offlinePacks, questions } from "../../db/schema";
import { AppError, notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";
import { recordAudit } from "../audit/audit.service";
import { loadAccessibleClass } from "../classes/class.access";
import { changeAssessmentStatus, createClassAssessment, suggestQuestions } from "../classroom/assessment.service";
import { getPresentation } from "../lessons/lesson.service";
import { loadBankQuestions } from "../learning/persistence/loaders";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/**
 * The version of an activity's question set. Offline work is recorded against it, and the server
 * refuses to merge work whose version no longer matches (it goes to the teacher as a conflict).
 */
export async function assessmentVersion(db: Db, assessmentId: string): Promise<string> {
  const links = await db.select({ q: assessmentQuestions.questionId }).from(assessmentQuestions).where(eq(assessmentQuestions.assessmentId, assessmentId)).orderBy(asc(assessmentQuestions.sequenceOrder));
  return createHash("sha256").update(links.map((l) => l.q).join("|")).digest("hex").slice(0, 16);
}

const OFFLINE_NOTES = [
  "Works offline: the lesson explanations, the check questions, printing the worksheet, answer key and response sheet, and recording students' answers on this device.",
  "Needs a connection: marking and results, the learning map and recommendations, AI drafts, reading photographed sheets, and saving your records to the school's server.",
  "Answers recorded offline stay on this device until you sync. Sync before clearing your browser data or handing the device to someone else.",
];

async function toDto(db: Db, pack: typeof offlinePacks.$inferSelect): Promise<OfflinePackDto> {
  const [a] = await db.select().from(assessments).where(eq(assessments.id, pack.assessmentId));
  const [cls] = await db.select().from(classes).where(eq(classes.id, pack.classId));
  const [concept] = await db.select().from(concepts).where(eq(concepts.id, pack.conceptId));
  if (!a || !cls || !concept) throw notFound("Pack not found.");

  const links = await db.select().from(assessmentQuestions).where(eq(assessmentQuestions.assessmentId, a.id)).orderBy(asc(assessmentQuestions.sequenceOrder));
  const bank = await loadBankQuestions(db, links.map((l) => l.questionId));
  const ordered = links.map((l) => bank.get(l.questionId)!);
  const roster = await db
    .select({ n: classEnrolments.rosterNumber })
    .from(classEnrolments)
    .where(and(eq(classEnrolments.classId, cls.id), eq(classEnrolments.status, "active")))
    .orderBy(asc(classEnrolments.rosterNumber));
  const explained = ordered.length ? await db.select({ id: questions.id, explanation: questions.explanation }).from(questions).where(inArray(questions.id, ordered.map((o) => o.id))) : [];
  const explainBy = new Map(explained.map((e) => [e.id, e.explanation]));

  return {
    id: pack.id,
    version: pack.contentHash,
    builtAt: pack.createdAt.toISOString(),
    language: concept.language,
    className: cls.name,
    classId: cls.id,
    assessmentId: a.id,
    conceptId: concept.id,
    conceptTitle: concept.title,
    presentation: await getPresentation(db, concept.id),
    // Student-facing: no key, no misconception tags.
    questions: ordered.map((q) => ({ id: q.id, stem: q.stem, options: q.options.map((o) => ({ id: o.id, text: o.text })) })),
    answerKey: ordered.map((q) => ({ questionId: q.id, correctOptionId: q.correctOptionId, explanation: explainBy.get(q.id) ?? null })),
    rollNumbers: roster.map((r) => r.n),
    offlineNotes: OFFLINE_NOTES,
  };
}

/**
 * Prepares a lesson pack: picks approved diagnostic questions, creates the check as an approved (not yet open)
 * activity so answers recorded offline have somewhere to land, and returns everything needed to work without a connection.
 * Building again for the same lesson reuses an unused check instead of piling up copies.
 */
export async function buildPack(db: Db, actor: Actor, conceptId: string, req: { classId: string; questionCount: number }, requestId?: string): Promise<OfflinePackDto> {
  const cls = await loadAccessibleClass(db, actor, req.classId);
  if (!isUuid(conceptId)) throw notFound("Concept not found.");
  const [concept] = await db.select().from(concepts).where(eq(concepts.id, conceptId));
  if (!concept) throw notFound("Concept not found.");

  const existing = await db.select().from(offlinePacks).where(and(eq(offlinePacks.classId, cls.id), eq(offlinePacks.conceptId, conceptId))).orderBy(desc(offlinePacks.createdAt)).limit(1);
  if (existing[0]) {
    const [a] = await db.select().from(assessments).where(eq(assessments.id, existing[0].assessmentId));
    const used = await db.select({ id: assessmentAttempts.id }).from(assessmentAttempts).where(eq(assessmentAttempts.assessmentId, existing[0].assessmentId)).limit(1);
    if (a && (a.status === "approved" || a.status === "open") && used.length === 0) return toDto(db, existing[0]);
  }

  const suggested = await suggestQuestions(db, actor, cls.id, { mode: "diagnostic", conceptIds: [conceptId], count: req.questionCount });
  if (suggested.length === 0) throw new AppError("validation_error", "This lesson has no approved questions yet, so there is nothing to put in a pack.");
  const a = await createClassAssessment(db, actor, cls.id, { title: `Offline check: ${concept.title}`, type: "diagnostic", questionIds: suggested.map((q) => q.id) }, requestId);
  await changeAssessmentStatus(db, actor, a.id, "approved", requestId);

  const [pack] = await db
    .insert(offlinePacks)
    .values({ teacherId: actor.id, classId: cls.id, conceptId, assessmentId: a.id, contentHash: await assessmentVersion(db, a.id) })
    .returning();
  await recordAudit(db, { actorId: actor.id, action: "offline.pack_built", entityType: "offline_pack", entityId: pack!.id, metadata: { classId: cls.id, conceptId }, requestId });
  return toDto(db, pack!);
}

async function loadAccessible(db: Db, actor: Actor, packId: string) {
  if (!isUuid(packId)) throw notFound("Pack not found.");
  const [pack] = await db.select().from(offlinePacks).where(eq(offlinePacks.id, packId));
  if (!pack) throw notFound("Pack not found.");
  await loadAccessibleClass(db, actor, pack.classId); // 404 for anyone but the class's teacher
  return pack;
}

export async function getPack(db: Db, actor: Actor, packId: string): Promise<OfflinePackDto> {
  return toDto(db, await loadAccessible(db, actor, packId));
}

export async function listPacks(db: Db, actor: Actor, classId: string): Promise<PackListResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const rows = await db.select().from(offlinePacks).where(eq(offlinePacks.classId, cls.id)).orderBy(desc(offlinePacks.createdAt));
  const titles = rows.length ? await db.select({ id: concepts.id, title: concepts.title }).from(concepts).where(inArray(concepts.id, rows.map((r) => r.conceptId))) : [];
  return { packs: rows.map((r) => ({ id: r.id, conceptTitle: titles.find((t) => t.id === r.conceptId)?.title ?? "", assessmentId: r.assessmentId, builtAt: r.createdAt.toISOString(), version: r.contentHash })) };
}
