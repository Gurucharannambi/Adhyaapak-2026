import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { GROWTH_RULES, canAffectMastery, type InsightsResponse, type MasteryStatus } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { assessmentAttempts, assessmentEvidence, assessments, conceptMastery, concepts, misconceptionObservations, questionResponses } from "../../db/schema";
import type { Actor } from "../auth/permissions";
import { loadAccessibleClass } from "../classes/class.access";
import { activeRoster } from "../classroom/map.service";
import { loadEvidenceForStudents } from "../learning/persistence/loaders";
import { getTimetable } from "../timetable/timetable.service";
import { growthGroups } from "./growth";

const STATUSES: MasteryStatus[] = ["not_enough_evidence", "needs_foundation", "developing", "likely_secure", "ready_for_challenge"];
const zero = () => Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<MasteryStatus, number>;

/**
 * One class's learning picture, from the same evidence ledger and mastery records as the class map, the Atlas and the
 * student history, so the numbers agree everywhere. No figure is estimated or filled in.
 */
export async function getInsights(db: Db, actor: Actor, classId: string, now = new Date()): Promise<InsightsResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const roster = await activeRoster(db, cls.id);
  const ids = roster.map((s) => s.id);
  const tt = await getTimetable(db, actor, cls.id);
  const coverage = { bookTitle: tt.bookTitle, taught: tt.lessonsTaught, total: tt.lessonsTotal };
  const empty: InsightsResponse = { classId: cls.id, className: cls.name, studentCount: ids.length, coverage, distribution: { cells: 0, concepts: 0, byStatus: zero() }, concepts: [], growth: growthGroups({ students: [], conceptTitle: new Map(), mastery: [], evidence: [], practiceSets: new Map(), now }), practiceRecorded: false };
  if (ids.length === 0) return empty;

  const mastery = await db.select().from(conceptMastery).where(inArray(conceptMastery.studentId, ids));
  const evidence = await loadEvidenceForStudents(db, ids);
  // Concepts this class has any evidence on, in book order. Untaught concepts are not counted as gaps.
  const conceptIds = [...new Set(evidence.map((e) => e.conceptId))];
  const conceptRows = conceptIds.length ? await db.select({ id: concepts.id, title: concepts.title, order: concepts.conceptOrder }).from(concepts).where(inArray(concepts.id, conceptIds)) : [];
  conceptRows.sort((a, b) => a.order - b.order);
  const conceptTitle = new Map(conceptRows.map((c) => [c.id, c.title]));

  const patternRows = conceptIds.length
    ? await db
        .selectDistinct({ studentId: misconceptionObservations.studentId, conceptId: misconceptionObservations.conceptId })
        .from(misconceptionObservations)
        .where(and(inArray(misconceptionObservations.studentId, ids), inArray(misconceptionObservations.status, ["likely", "confirmed"])))
    : [];

  // Right answers per concept per class check: which check each counted answer came from.
  const perCheck = await db
    .select({ conceptId: assessmentEvidence.conceptId, result: assessmentEvidence.result, reviewStatus: assessmentEvidence.reviewStatus, confidence: assessmentEvidence.confidence, relationship: assessmentEvidence.relationship, assessmentId: assessments.id, title: assessments.title, createdAt: assessments.createdAt })
    .from(assessmentEvidence)
    .innerJoin(questionResponses, eq(questionResponses.id, assessmentEvidence.questionResponseId))
    .innerJoin(assessmentAttempts, eq(assessmentAttempts.id, questionResponses.attemptId))
    .innerJoin(assessments, eq(assessments.id, assessmentAttempts.assessmentId))
    .where(and(inArray(assessmentEvidence.studentId, ids), eq(assessments.classId, cls.id)));

  const byStatus = zero();
  const conceptsOut = conceptRows.map((c) => {
    const counts = zero();
    let assessed = 0;
    for (const s of ids) {
      const m = mastery.find((x) => x.studentId === s && x.conceptId === c.id);
      counts[m?.status ?? "not_enough_evidence"]++;
      if (m && m.evidenceCount > 0) assessed++;
    }
    for (const st of STATUSES) byStatus[st] += counts[st];
    const checks = new Map<string, { date: string; title: string; right: number; of: number; at: number }>();
    for (const r of perCheck) {
      if (r.conceptId !== c.id || r.relationship !== "primary" || !canAffectMastery(r)) continue;
      const k = checks.get(r.assessmentId) ?? { date: r.createdAt.toISOString(), title: r.title, right: 0, of: 0, at: r.createdAt.getTime() };
      k.of++;
      if (r.result === "correct") k.right++;
      checks.set(r.assessmentId, k);
    }
    const [latest, previous] = [...checks.values()].sort((a, b) => b.at - a.at);
    const strip = (x: typeof latest) => (x ? { date: x.date, title: x.title, right: x.right, of: x.of } : null);
    return {
      id: c.id,
      title: c.title,
      assessed,
      counts,
      patternStudents: new Set(patternRows.filter((p) => p.conceptId === c.id).map((p) => p.studentId)).size,
      trend: latest ? { latest: strip(latest)!, previous: strip(previous) } : null,
    };
  });

  // Practice sets are a student's own sets from the practice portal; only those count as "practice".
  const recentFrom = new Date(now.getTime() - GROWTH_RULES.recentDays * 86_400_000);
  const practiceAll = await db
    .select({ studentId: assessmentAttempts.studentId, submittedAt: assessmentAttempts.submittedAt })
    .from(assessmentAttempts)
    .innerJoin(assessments, eq(assessments.id, assessmentAttempts.assessmentId))
    .where(and(inArray(assessmentAttempts.studentId, ids), isNotNull(assessments.ownerStudentId), eq(assessments.classId, cls.id)));
  const practiceSets = new Map<string, number>();
  for (const p of practiceAll) if (p.submittedAt && p.submittedAt >= recentFrom) practiceSets.set(p.studentId, (practiceSets.get(p.studentId) ?? 0) + 1);

  return {
    ...empty,
    distribution: { cells: ids.length * conceptRows.length, concepts: conceptRows.length, byStatus },
    concepts: conceptsOut,
    growth: growthGroups({ students: roster, conceptTitle, mastery: mastery.filter((m) => conceptTitle.has(m.conceptId)), evidence, practiceSets, now }),
    practiceRecorded: practiceAll.length > 0,
  };
}

