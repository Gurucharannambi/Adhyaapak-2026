import { and, asc, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "../../db/client";
import { classEnrolments, conceptMastery, concepts, questions } from "../../db/schema";
import { DEFAULT_LEARNING_CONFIG, type LearningConfig } from "../learning/config";

export interface RevisitDue {
  conceptId: string;
  title: string;
  studentIds: string[];
  /** The oldest evidence among those students, so the sentence "last answered X days ago" is true for all of them. */
  oldestEvidenceAt: Date;
  /** Starter questions, approved ones only, easiest first. */
  questionIds: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Revisit Queue: concepts a student looked secure on, with no newer evidence for a while. Spaced retrieval is
 * what keeps learning from fading, and the evidence ledger already says when a student last answered.
 * Purely a query over stored records (no AI). The threshold is `config.revisit.afterDays`.
 */
export async function revisitDue(db: Db, studentIds: readonly string[], now = new Date(), config: LearningConfig = DEFAULT_LEARNING_CONFIG): Promise<RevisitDue[]> {
  if (studentIds.length === 0) return [];
  const cutoff = new Date(now.getTime() - config.revisit.afterDays * DAY_MS);
  const rows = await db
    .select({ studentId: conceptMastery.studentId, conceptId: conceptMastery.conceptId, last: conceptMastery.lastEvidenceAt, title: concepts.title, order: concepts.conceptOrder })
    .from(conceptMastery)
    .innerJoin(concepts, eq(concepts.id, conceptMastery.conceptId))
    .where(and(inArray(conceptMastery.studentId, [...studentIds]), inArray(conceptMastery.status, ["likely_secure", "ready_for_challenge"]), lt(conceptMastery.lastEvidenceAt, cutoff)))
    .orderBy(asc(concepts.conceptOrder));

  const byConcept = new Map<string, { title: string; students: string[]; oldest: Date }>();
  for (const r of rows) {
    if (!r.last) continue;
    const e = byConcept.get(r.conceptId) ?? { title: r.title, students: [], oldest: r.last };
    e.students.push(r.studentId);
    if (r.last < e.oldest) e.oldest = r.last;
    byConcept.set(r.conceptId, e);
  }
  if (byConcept.size === 0) return [];

  const qs = await db
    .select({ id: questions.id, conceptId: questions.conceptId, difficulty: questions.difficulty, key: questions.key })
    .from(questions)
    .where(and(inArray(questions.conceptId, [...byConcept.keys()]), eq(questions.reviewStatus, "approved")))
    .orderBy(asc(questions.difficulty), asc(questions.key));

  return [...byConcept.entries()].map(([conceptId, e]) => ({
    conceptId,
    title: e.title,
    studentIds: e.students,
    oldestEvidenceAt: e.oldest,
    questionIds: qs.filter((q) => q.conceptId === conceptId && q.difficulty <= 3).slice(0, config.revisit.maxQuestions).map((q) => q.id),
  }));
}

export async function classStudentIds(db: Db, classId: string): Promise<string[]> {
  const rows = await db.select({ id: classEnrolments.studentId }).from(classEnrolments).where(and(eq(classEnrolments.classId, classId), eq(classEnrolments.status, "active")));
  return rows.map((r) => r.id);
}
