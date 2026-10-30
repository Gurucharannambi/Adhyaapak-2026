import { eq, inArray } from "drizzle-orm";
import type { AssessmentEvidence } from "@adhyaapak/shared";
import { assessmentEvidence, misconceptionPatterns, questionConcepts, questions } from "../../../db/schema";
import type { BankQuestion } from "../assessment/types";
import { parseRule, type MisconceptionRule } from "../misconception/rules";
import type { Exec } from "./db-types";

/** Loads questions by id as pure-logic objects, including the extra concepts each one also assesses. */
export async function loadBankQuestions(db: Exec, questionIds: readonly string[]): Promise<Map<string, BankQuestion>> {
  if (questionIds.length === 0) return new Map();
  const rows = await db.select().from(questions).where(inArray(questions.id, [...questionIds]));
  const links = await db.select().from(questionConcepts).where(inArray(questionConcepts.questionId, [...questionIds]));
  return new Map(
    rows.map((q) => [
      q.id,
      {
        id: q.id,
        key: q.key,
        conceptId: q.conceptId,
        role: q.role,
        difficulty: q.difficulty,
        stem: q.stem,
        options: q.options,
        correctOptionId: q.correctOptionId,
        reviewStatus: q.reviewStatus,
        alsoAssesses: links.filter((l) => l.questionId === q.id).map((l) => l.conceptId),
      },
    ]),
  );
}

/** All misconception rules, validated. A malformed rule throws rather than being skipped. */
export async function loadRules(db: Exec): Promise<MisconceptionRule[]> {
  const rows = await db.select().from(misconceptionPatterns);
  return rows.map((r) =>
    parseRule({ id: r.id, key: r.key, conceptId: r.conceptId, name: r.name, triggerDefinition: r.triggerDefinition, followUpDefinition: r.followUpDefinition, reviewStatus: r.reviewStatus }),
  );
}

/** Evidence ledger rows for several students, in the shared shape the estimator expects. */
export async function loadEvidenceForStudents(db: Exec, studentIds: readonly string[]): Promise<AssessmentEvidence[]> {
  if (studentIds.length === 0) return [];
  const rows = await db.select().from(assessmentEvidence).where(inArray(assessmentEvidence.studentId, [...studentIds]));
  return rows.map(toSharedEvidence);
}

/** Evidence ledger rows for one student and concept. */
export async function loadEvidence(db: Exec, studentId: string, conceptId: string): Promise<AssessmentEvidence[]> {
  const rows = await db.select().from(assessmentEvidence).where(eq(assessmentEvidence.studentId, studentId));
  return rows.filter((r) => r.conceptId === conceptId).map(toSharedEvidence);
}

type EvidenceRow = typeof assessmentEvidence.$inferSelect;
function toSharedEvidence(r: EvidenceRow): AssessmentEvidence {
  return {
    id: r.id,
    studentId: r.studentId,
    conceptId: r.conceptId,
    questionResponseId: r.questionResponseId,
    source: r.source,
    result: r.result,
    difficulty: r.difficulty,
    ...(r.selfConfidence ? { selfConfidence: r.selfConfidence } : {}),
    confidence: r.confidence,
    reviewStatus: r.reviewStatus,
    ...(r.matchedMisconceptionPatternId ? { matchedMisconceptionPatternId: r.matchedMisconceptionPatternId } : {}),
    observedAt: r.observedAt.toISOString(),
  };
}
