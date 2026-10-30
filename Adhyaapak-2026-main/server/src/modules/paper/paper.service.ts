import { createHash } from "node:crypto";
import { and, asc, desc, eq, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import type { ApprovePaperResponse, PaperAccuracyDto, PaperItemDto, PaperListResponse, PaperReading, PaperSubmissionDto, ReviewPaperRequest } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { assessmentAttempts, assessmentQuestions, assessments, classEnrolments, evaluationReviews, extractionResults, studentProfiles, submissionFiles } from "../../db/schema";
import { AppError, conflict, notFound } from "../../http/errors";
import type { LlmProvider } from "../ai/provider";
import { runAi } from "../ai/run-ai";
import type { Actor } from "../auth/permissions";
import { recordAudit } from "../audit/audit.service";
import { loadAccessibleAssessment } from "../classroom/assessment.service";
import type { StorageProvider } from "../files/storage";
import type { BankQuestion } from "../learning/assessment/types";
import { isUniqueViolation } from "../learning/persistence/db-types";
import { submitAttempt } from "../learning/persistence/attempt.service";
import { loadBankQuestions } from "../learning/persistence/loaders";
import { VisionExtractor, type ExtractedReading, type ResponseExtractor, type SheetQuestion, type SheetReadingOutput } from "./extractor";
import { validateAndCleanImage } from "./image";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const sha256 = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const DAY_MS = 24 * 60 * 60 * 1000;

type SubmissionRow = typeof submissionFiles.$inferSelect;
type StoredReading = { questionId: string; reading: Record<string, unknown>; legibility: string; note: string | null };
type StoredReview = { questionId: string; reading: Record<string, unknown>; confirmed: boolean };

// ---------------------------------------------------------------- loading

/** The sheet, with a 404 for anything the teacher does not own (never reveals that it exists). */
async function loadAccessible(db: Db, actor: Actor, id: string): Promise<{ row: SubmissionRow }> {
  if (!isUuid(id)) throw notFound("Sheet not found.");
  const [row] = await db.select().from(submissionFiles).where(eq(submissionFiles.id, id));
  if (!row) throw notFound("Sheet not found.");
  await loadAccessibleAssessment(db, actor, row.assessmentId); // throws 404 when not the class's teacher
  return { row };
}

async function sheetQuestions(db: Db, assessmentId: string): Promise<{ list: SheetQuestion[]; bank: Map<string, BankQuestion> }> {
  const links = await db.select().from(assessmentQuestions).where(eq(assessmentQuestions.assessmentId, assessmentId)).orderBy(asc(assessmentQuestions.sequenceOrder));
  const bank = await loadBankQuestions(db, links.map((l) => l.questionId));
  const list = links.map((l, i) => {
    const q = bank.get(l.questionId)!;
    return { questionId: q.id, number: i + 1, stem: q.stem, options: q.options.map((o) => ({ id: o.id, text: o.text })) };
  });
  return { list, bank };
}

const latestExtraction = async (db: Db, fileId: string) => (await db.select().from(extractionResults).where(eq(extractionResults.submissionFileId, fileId)).orderBy(desc(extractionResults.createdAt)).limit(1))[0];
const reviewOf = async (db: Db, fileId: string) => (await db.select().from(evaluationReviews).where(eq(evaluationReviews.submissionFileId, fileId)))[0];

/** A question needs the teacher's own decision unless it was read clearly as an actual answer or blank. */
export function needsDecision(extracted: StoredReading | undefined): boolean {
  if (!extracted) return true;
  return extracted.legibility !== "clear" || extracted.reading.kind === "unreadable";
}

const sameReading = (a: Record<string, unknown>, b: Record<string, unknown>) => a.kind === b.kind && a.optionId === b.optionId;

// ---------------------------------------------------------------- DTO

async function toDto(db: Db, row: SubmissionRow): Promise<PaperSubmissionDto> {
  const { list } = await sheetQuestions(db, row.assessmentId);
  const extraction = await latestExtraction(db, row.id);
  const review = await reviewOf(db, row.id);
  const [student] = await db
    .select({ name: studentProfiles.name, rosterNumber: classEnrolments.rosterNumber })
    .from(studentProfiles)
    .innerJoin(classEnrolments, eq(classEnrolments.studentId, studentProfiles.id))
    .innerJoin(assessments, eq(assessments.classId, classEnrolments.classId))
    .where(and(eq(studentProfiles.id, row.studentId), eq(assessments.id, row.assessmentId)))
    .limit(1);

  const exById = new Map((extraction?.status === "ok" ? (extraction.items as StoredReading[]) : []).map((i) => [i.questionId, i]));
  const rvById = new Map(((review?.items ?? []) as StoredReview[]).map((i) => [i.questionId, i]));

  const items: PaperItemDto[] = list.map((q) => {
    const ex = exById.get(q.questionId);
    const rv = rvById.get(q.questionId);
    return {
      questionId: q.questionId,
      position: q.number,
      stem: q.stem,
      options: q.options,
      extracted: ex ? { reading: ex.reading as PaperReading, legibility: ex.legibility as "clear" | "unsure" | "unreadable", note: ex.note } : null,
      reviewed: rv ? { reading: rv.reading as PaperReading, confirmed: rv.confirmed } : null,
      needsDecision: needsDecision(ex),
    };
  });

  const blockers = approvalBlockers(row, items);
  return {
    id: row.id,
    assessmentId: row.assessmentId,
    studentId: row.studentId,
    studentName: student?.name ?? "",
    rosterNumber: student?.rosterNumber ?? null,
    status: row.status,
    imageAvailable: !!row.storageKey,
    metadataStripped: row.metadataStripped,
    extraction: extraction ? { extractor: extraction.extractor, processingVersion: extraction.processingVersion, status: extraction.status, createdAt: extraction.createdAt.toISOString() } : null,
    items,
    blockers,
    canApprove: blockers.length === 0,
    deleteAfter: row.deleteAfter?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Why a sheet cannot be approved yet. Empty means the teacher may approve. */
function approvalBlockers(row: SubmissionRow, items: PaperItemDto[]): string[] {
  if (row.status === "approved") return ["This sheet has already been approved."];
  if (row.status === "rejected") return ["This sheet was rejected."];
  if (!row.storageKey) return ["The photo has been deleted, so it cannot be checked."];
  const blockers: string[] = [];
  const unreviewed = items.filter((i) => !i.reviewed);
  if (unreviewed.length > 0) blockers.push(`Check ${unreviewed.length === items.length ? "the answers" : `${unreviewed.length} more answer${unreviewed.length === 1 ? "" : "s"}`} against the photo and save your review.`);
  const open = items.filter((i) => i.reviewed && i.needsDecision && !i.reviewed.confirmed);
  if (open.length > 0) blockers.push(`${open.length} answer${open.length === 1 ? " was" : "s were"} not read clearly. Choose what the photo shows (or “unreadable”) for ${open.length === 1 ? "it" : "each"}.`);
  return blockers;
}

// ---------------------------------------------------------------- upload

export interface UploadInput {
  assessmentId: string;
  studentId: string;
  file: Buffer;
}

export async function uploadSheet(db: Db, storage: StorageProvider, actor: Actor, input: UploadInput, requestId?: string): Promise<PaperSubmissionDto> {
  const assessment = await loadAccessibleAssessment(db, actor, input.assessmentId);
  if (assessment.status !== "open" && assessment.status !== "closed") throw conflict("Start (or finish) the activity before adding paper answer sheets to it.");
  if (!isUuid(input.studentId)) throw new AppError("validation_error", "Choose a student.");

  const [enrolled] = await db
    .select({ id: classEnrolments.id })
    .from(classEnrolments)
    .where(and(eq(classEnrolments.classId, assessment.classId), eq(classEnrolments.studentId, input.studentId), eq(classEnrolments.status, "active")));
  if (!enrolled) throw new AppError("validation_error", "That student is not in this class.");

  const [existingAttempt] = await db.select({ id: assessmentAttempts.id }).from(assessmentAttempts).where(and(eq(assessmentAttempts.assessmentId, assessment.id), eq(assessmentAttempts.studentId, input.studentId)));
  if (existingAttempt) throw conflict("This student has already answered this activity.");

  const clean = validateAndCleanImage(input.file);
  const key = await storage.put(clean.bytes);
  try {
    const [row] = await db
      .insert(submissionFiles)
      .values({
        uploadedBy: actor.id,
        assessmentId: assessment.id,
        studentId: input.studentId,
        storageKey: key,
        fileType: clean.type,
        sizeBytes: clean.bytes.length,
        width: clean.width,
        height: clean.height,
        contentHash: sha256(clean.bytes),
        metadataStripped: clean.stripped,
      })
      .returning();
    await recordAudit(db, { actorId: actor.id, action: "paper.upload", entityType: "submission_file", entityId: row!.id, requestId });
    return toDto(db, row!);
  } catch (err) {
    await storage.delete(key).catch(() => undefined); // do not leave an orphaned private file behind
    if (isUniqueViolation(err)) throw conflict("This student already has a sheet waiting for review. Reject or delete it first.");
    throw err;
  }
}

export async function listSheets(db: Db, actor: Actor, assessmentId: string): Promise<PaperListResponse> {
  const a = await loadAccessibleAssessment(db, actor, assessmentId);
  const rows = await db.select().from(submissionFiles).where(eq(submissionFiles.assessmentId, a.id)).orderBy(desc(submissionFiles.createdAt));
  const out = [];
  for (const r of rows) {
    const { items: _items, blockers: _blockers, ...rest } = await toDto(db, r);
    out.push(rest);
  }
  return { submissions: out };
}

export async function getSheet(db: Db, actor: Actor, id: string): Promise<PaperSubmissionDto> {
  const { row } = await loadAccessible(db, actor, id);
  return toDto(db, row);
}

/** The photo itself, only for the class's teacher. The route sends it with no-store headers. */
export async function getSheetImage(db: Db, storage: StorageProvider, actor: Actor, id: string): Promise<{ bytes: Buffer; mimeType: string }> {
  const { row } = await loadAccessible(db, actor, id);
  if (!row.storageKey) throw notFound("The photo has been deleted.");
  return { bytes: await storage.get(row.storageKey), mimeType: row.fileType === "png" ? "image/png" : "image/jpeg" };
}

// ---------------------------------------------------------------- reading

/**
 * Asks the reader to read the photo. Only reads: nothing is judged and no evidence is created.
 * The photo is sent to the AI provider, so the route requires the teacher's explicit confirmation.
 * If reading fails the sheet stays usable: the teacher can enter the answers by hand from the photo.
 */
export async function processSheet(db: Db, ai: LlmProvider, storage: StorageProvider, actor: Actor, id: string, requestId?: string, extractorOverride?: ResponseExtractor): Promise<PaperSubmissionDto> {
  const { row } = await loadAccessible(db, actor, id);
  if (row.status !== "uploaded" && row.status !== "needs_review") throw conflict("This sheet has already been finished.");
  if (!row.storageKey) throw conflict("The photo has been deleted.");
  const { list } = await sheetQuestions(db, row.assessmentId);

  const extractor = extractorOverride ?? new VisionExtractor((req) => runAi<SheetReadingOutput>(db, ai, actor, null, req));
  const bytes = await storage.get(row.storageKey);
  let readings: ExtractedReading[] | undefined;
  let errorCode: string | undefined;
  try {
    readings = await extractor.extract({ mimeType: row.fileType === "png" ? "image/png" : "image/jpeg", base64: bytes.toString("base64") }, list);
  } catch (err) {
    errorCode = err instanceof AppError ? err.code : "unknown";
    await db.insert(extractionResults).values({ submissionFileId: row.id, extractor: extractor.name, processingVersion: extractor.version, status: "failed", errorCode, items: [] });
    await recordAudit(db, { actorId: actor.id, action: "paper.process_failed", entityType: "submission_file", entityId: row.id, metadata: { code: errorCode }, requestId });
    throw err instanceof AppError ? err : new AppError("processing_failed", "We could not read that photo. You can enter the answers by hand from the photo instead.");
  }

  await db.insert(extractionResults).values({ submissionFileId: row.id, extractor: extractor.name, processingVersion: extractor.version, status: "ok", items: readings.map((r) => ({ ...r })) });
  // A fresh reading replaces any earlier review draft: the old decisions were about different readings.
  await db.delete(evaluationReviews).where(and(eq(evaluationReviews.submissionFileId, row.id), isNull(evaluationReviews.approvedAt)));
  await db.update(submissionFiles).set({ status: "needs_review", updatedAt: new Date() }).where(eq(submissionFiles.id, row.id));
  await recordAudit(db, { actorId: actor.id, action: "paper.process", entityType: "submission_file", entityId: row.id, requestId });
  return getSheet(db, actor, row.id);
}

// ---------------------------------------------------------------- review

export async function saveReview(db: Db, actor: Actor, id: string, req: ReviewPaperRequest, requestId?: string): Promise<PaperSubmissionDto> {
  const { row } = await loadAccessible(db, actor, id);
  if (row.status === "approved" || row.status === "rejected") throw conflict("This sheet has already been finished.");
  const { list } = await sheetQuestions(db, row.assessmentId);
  const byId = new Map(list.map((q) => [q.questionId, q]));

  const seen = new Set<string>();
  for (const item of req.items) {
    const q = byId.get(item.questionId);
    if (!q) throw new AppError("validation_error", "An answer is for a question that is not on this sheet.");
    if (seen.has(item.questionId)) throw new AppError("validation_error", "A question appears more than once.");
    seen.add(item.questionId);
    if (item.reading.kind === "option" && !q.options.some((o) => o.id === (item.reading as { optionId: string }).optionId)) throw new AppError("validation_error", "That is not one of this question's options.");
  }

  const extraction = await latestExtraction(db, row.id);
  const exById = new Map((extraction?.status === "ok" ? (extraction.items as StoredReading[]) : []).map((i) => [i.questionId, i]));
  // Changing what the reader saw is itself the teacher's decision, so it counts as confirmed.
  const items: StoredReview[] = req.items.map((i) => {
    const ex = exById.get(i.questionId);
    const changed = !ex || !sameReading(ex.reading, i.reading);
    return { questionId: i.questionId, reading: { ...i.reading }, confirmed: i.confirmed || (!!ex && changed) };
  });

  const now = new Date();
  await db
    .insert(evaluationReviews)
    .values({ submissionFileId: row.id, extractionResultId: extraction?.status === "ok" ? extraction.id : null, items, reviewedBy: actor.id })
    .onConflictDoUpdate({ target: evaluationReviews.submissionFileId, set: { items, extractionResultId: extraction?.status === "ok" ? extraction.id : null, reviewedBy: actor.id, updatedAt: now } });
  await db.update(submissionFiles).set({ status: "needs_review", updatedAt: now }).where(eq(submissionFiles.id, row.id));
  await recordAudit(db, { actorId: actor.id, action: "paper.review_saved", entityType: "submission_file", entityId: row.id, requestId });
  return getSheet(db, actor, row.id);
}

// ---------------------------------------------------------------- approval

/**
 * The only way paper becomes evidence. The teacher's reviewed answers go through the same
 * transactional, idempotent attempt pipeline as everything else, evaluated by the ordinary
 * deterministic answer check. Unreadable and blank answers are recorded as "no evidence", never "wrong".
 */
export async function approveSheet(db: Db, actor: Actor, id: string, retentionDays: number, requestId?: string): Promise<ApprovePaperResponse> {
  const { row } = await loadAccessible(db, actor, id);
  if (row.status === "approved" && row.attemptId) return { attemptId: row.attemptId, alreadyApproved: true };
  const dto = await toDto(db, row);
  if (dto.blockers.length > 0) throw conflict(dto.blockers.join(" "));

  const review = await reviewOf(db, row.id);
  if (!review) throw conflict("Save your review first.");
  const stored = review.items as StoredReview[];

  const result = await submitAttempt(db, {
    assessmentId: row.assessmentId,
    studentId: row.studentId,
    source: "paper_reviewed",
    idempotencyKey: `paper:${row.id}`,
    responses: stored.map((i) => ({ questionId: i.questionId, response: i.reading as never })),
    actorId: actor.id,
    ...(requestId ? { requestId } : {}),
  });

  const now = new Date();
  await db.update(evaluationReviews).set({ approvedAt: now, updatedAt: now }).where(eq(evaluationReviews.id, review.id));
  await db
    .update(submissionFiles)
    .set({ status: "approved", attemptId: result.attemptId, deleteAfter: new Date(now.getTime() + retentionDays * DAY_MS), updatedAt: now })
    .where(eq(submissionFiles.id, row.id));
  await recordAudit(db, { actorId: actor.id, action: "paper.approve", entityType: "submission_file", entityId: row.id, metadata: { attemptId: result.attemptId }, requestId });
  return { attemptId: result.attemptId, alreadyApproved: false };
}

/** A rejected sheet never becomes evidence, and its photo is deleted straight away. */
export async function rejectSheet(db: Db, storage: StorageProvider, actor: Actor, id: string, requestId?: string): Promise<void> {
  const { row } = await loadAccessible(db, actor, id);
  if (row.status === "approved") throw conflict("An approved sheet cannot be rejected. Its answers are already part of the record.");
  if (row.status === "rejected") return;
  await db.update(submissionFiles).set({ status: "rejected", updatedAt: new Date() }).where(eq(submissionFiles.id, row.id));
  await removeImage(db, storage, row);
  await recordAudit(db, { actorId: actor.id, action: "paper.reject", entityType: "submission_file", entityId: row.id, requestId });
}

// ---------------------------------------------------------------- retention

async function removeImage(db: Db, storage: StorageProvider, row: Pick<SubmissionRow, "id" | "storageKey">) {
  if (!row.storageKey) return;
  await storage.delete(row.storageKey);
  await db.update(submissionFiles).set({ storageKey: null, imageDeletedAt: new Date(), updatedAt: new Date() }).where(eq(submissionFiles.id, row.id));
}

/** Teacher-requested deletion of the photo. A sheet still waiting for review is rejected (it cannot be checked without its photo). */
export async function deleteSheetImage(db: Db, storage: StorageProvider, actor: Actor, id: string, requestId?: string): Promise<void> {
  const { row } = await loadAccessible(db, actor, id);
  if (row.status === "uploaded" || row.status === "needs_review") {
    await db.update(submissionFiles).set({ status: "rejected", updatedAt: new Date() }).where(eq(submissionFiles.id, row.id));
  }
  await removeImage(db, storage, row);
  await recordAudit(db, { actorId: actor.id, action: "paper.delete_image", entityType: "submission_file", entityId: row.id, requestId });
}

/** Deletes photos whose retention period has ended. Safe to run repeatedly. Returns how many were deleted. */
export async function purgeExpiredImages(db: Db, storage: StorageProvider, now = new Date()): Promise<number> {
  const due = await db
    .select({ id: submissionFiles.id, storageKey: submissionFiles.storageKey })
    .from(submissionFiles)
    .where(and(isNotNull(submissionFiles.storageKey), lte(submissionFiles.deleteAfter, now)));
  for (const row of due) await removeImage(db, storage, row);
  return due.length;
}

// ---------------------------------------------------------------- accuracy log

/**
 * How often a teacher had to change what the reader saw, over this teacher's approved sheets. This is
 * the honest measure of reading quality; it says nothing about students.
 */
export async function readingAccuracy(db: Db, actor: Actor): Promise<PaperAccuracyDto> {
  const sheets = await db
    .select({ id: submissionFiles.id })
    .from(submissionFiles)
    .where(and(eq(submissionFiles.uploadedBy, actor.id), eq(submissionFiles.status, "approved")));
  const out: PaperAccuracyDto = { sheetsReviewed: 0, answersReviewed: 0, answersAsRead: 0, answersCorrectedByTeacher: 0, clearReadings: 0, clearReadingsUnchanged: 0 };
  if (sheets.length === 0) return out;
  const reviews = await db.select().from(evaluationReviews).where(inArray(evaluationReviews.submissionFileId, sheets.map((s) => s.id)));
  for (const review of reviews) {
    if (!review.extractionResultId) continue; // entered by hand: nothing was read, so nothing to measure
    const [ex] = await db.select().from(extractionResults).where(eq(extractionResults.id, review.extractionResultId));
    if (!ex || ex.status !== "ok") continue;
    out.sheetsReviewed++;
    const exById = new Map((ex.items as StoredReading[]).map((i) => [i.questionId, i]));
    for (const item of review.items as StoredReview[]) {
      const read = exById.get(item.questionId);
      if (!read) continue;
      out.answersReviewed++;
      const unchanged = sameReading(read.reading, item.reading);
      if (unchanged) out.answersAsRead++;
      else out.answersCorrectedByTeacher++;
      if (read.legibility === "clear") {
        out.clearReadings++;
        if (unchanged) out.clearReadingsUnchanged++;
      }
    }
  }
  return out;
}
