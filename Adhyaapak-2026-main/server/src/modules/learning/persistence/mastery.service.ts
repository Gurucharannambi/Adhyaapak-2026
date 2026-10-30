import { and, eq, inArray } from "drizzle-orm";
import type { MasteryEstimator } from "@adhyaapak/shared";
import { assessmentEvidence, conceptMastery } from "../../../db/schema";
import { BaselineMasteryEstimator } from "../mastery/baseline-estimator";
import type { ConceptState } from "../adaptation/policy";
import type { Exec } from "./db-types";
import { loadEvidence } from "./loaders";

export const defaultEstimator = new BaselineMasteryEstimator();

/**
 * Recomputes one student's mastery for one concept from the evidence ledger and stores it.
 * `concept_mastery` is only a cache of this calculation (principle 9).
 */
export async function recomputeMastery(db: Exec, studentId: string, conceptId: string, opts: { now?: Date; estimator?: MasteryEstimator } = {}) {
  const estimator = opts.estimator ?? defaultEstimator;
  const now = opts.now ?? new Date();
  const evidence = await loadEvidence(db, studentId, conceptId);
  const result = estimator.estimate({ evidence, now });
  const lastEvidenceAt = evidence.length ? new Date(Math.max(...evidence.map((e) => new Date(e.observedAt).getTime()))) : null;

  const values = {
    studentId,
    conceptId,
    estimate: result.estimate,
    status: result.status,
    evidenceCount: result.evidenceCount,
    evidenceIds: result.evidenceIds,
    algorithmVersion: estimator.version,
    lastEvidenceAt,
    updatedAt: now,
  };
  await db
    .insert(conceptMastery)
    .values(values)
    .onConflictDoUpdate({ target: [conceptMastery.studentId, conceptMastery.conceptId], set: { ...values } });
  return result;
}

/**
 * Replay tool: rebuilds every stored mastery record from raw evidence. Run it after changing the
 * algorithm or its thresholds; no evidence is touched.
 */
export async function recomputeAllMastery(db: Exec, opts: { now?: Date; estimator?: MasteryEstimator } = {}): Promise<number> {
  const pairs = await db.selectDistinct({ studentId: assessmentEvidence.studentId, conceptId: assessmentEvidence.conceptId }).from(assessmentEvidence);
  for (const p of pairs) await recomputeMastery(db, p.studentId, p.conceptId, opts);
  return pairs.length;
}

/** Stored mastery for a student as a map the adaptation policy can read. */
export async function loadMasteryMap(db: Exec, studentId: string, conceptIds?: readonly string[]): Promise<Map<string, ConceptState>> {
  const rows = await db
    .select()
    .from(conceptMastery)
    .where(conceptIds ? and(eq(conceptMastery.studentId, studentId), inArray(conceptMastery.conceptId, [...conceptIds])) : eq(conceptMastery.studentId, studentId));
  return new Map(rows.map((r) => [r.conceptId, { status: r.status, estimate: r.estimate, evidenceCount: r.evidenceCount, evidenceIds: r.evidenceIds }]));
}
