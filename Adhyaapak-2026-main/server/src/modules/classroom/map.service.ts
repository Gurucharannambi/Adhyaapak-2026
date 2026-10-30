import { and, asc, eq, inArray, ne } from "drizzle-orm";
import type { ClassMisconceptionsResponse, EvidenceDrilldown, LearningMapResponse, MapCell, MasteryStatus } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import {
  assessmentEvidence,
  assessmentQuestions,
  classEnrolments,
  conceptMastery,
  concepts,
  misconceptionObservations,
  misconceptionPatterns,
  questionConcepts,
  questionResponses,
  questions,
  studentProfiles,
} from "../../db/schema";
import { notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";
import { loadAccessibleClass } from "../classes/class.access";
import { normalizeAnswer } from "../learning/assessment/evaluate";
import { loadEvidence } from "../learning/persistence/loaders";
import { defaultEstimator } from "../learning/persistence/mastery.service";
import { loadAccessibleAssessment } from "./assessment.service";

const STATUSES: MasteryStatus[] = ["not_enough_evidence", "needs_foundation", "developing", "likely_secure", "ready_for_challenge"];
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export async function activeRoster(db: Db, classId: string) {
  return db
    .select({ id: studentProfiles.id, name: studentProfiles.name, rosterNumber: classEnrolments.rosterNumber })
    .from(classEnrolments)
    .innerJoin(studentProfiles, eq(studentProfiles.id, classEnrolments.studentId))
    .where(and(eq(classEnrolments.classId, classId), eq(classEnrolments.status, "active")))
    .orderBy(asc(classEnrolments.rosterNumber));
}

/**
 * Concept mastery for every active student in a class. Every number comes from stored records.
 * Students with no evidence on a concept appear as "not enough evidence", not as a score.
 * Filter by `conceptIds` or by `assessmentId` (the concepts that activity assessed).
 */
export async function getLearningMap(db: Db, actor: Actor, classId: string, filter: { conceptIds?: string[]; assessmentId?: string } = {}): Promise<LearningMapResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const roster = await activeRoster(db, cls.id);
  const ids = roster.map((s) => s.id);

  const mastery = ids.length ? await db.select().from(conceptMastery).where(inArray(conceptMastery.studentId, ids)) : [];

  let conceptIds: string[];
  if (filter.assessmentId) {
    const a = await loadAccessibleAssessment(db, actor, filter.assessmentId);
    if (a.classId !== cls.id) throw notFound("Activity not found.");
    const qids = (await db.select({ q: assessmentQuestions.questionId }).from(assessmentQuestions).where(eq(assessmentQuestions.assessmentId, a.id))).map((r) => r.q);
    const primary = qids.length ? await db.select({ c: questions.conceptId }).from(questions).where(inArray(questions.id, qids)) : [];
    const extra = qids.length ? await db.select({ c: questionConcepts.conceptId }).from(questionConcepts).where(inArray(questionConcepts.questionId, qids)) : [];
    conceptIds = [...new Set([...primary, ...extra].map((r) => r.c))];
  } else if (filter.conceptIds?.length) {
    conceptIds = filter.conceptIds.filter(isUuid);
  } else {
    conceptIds = [...new Set(mastery.map((m) => m.conceptId))];
  }

  const conceptRows = conceptIds.length ? await db.select().from(concepts).where(inArray(concepts.id, conceptIds)).orderBy(asc(concepts.conceptOrder)) : [];
  const shownIds = conceptRows.map((c) => c.id);

  const observations = ids.length && shownIds.length
    ? await db
        .select({ studentId: misconceptionObservations.studentId, conceptId: misconceptionObservations.conceptId, status: misconceptionObservations.status, name: misconceptionPatterns.name })
        .from(misconceptionObservations)
        .innerJoin(misconceptionPatterns, eq(misconceptionPatterns.id, misconceptionObservations.patternId))
        .where(and(inArray(misconceptionObservations.studentId, ids), inArray(misconceptionObservations.conceptId, shownIds), inArray(misconceptionObservations.status, ["likely", "confirmed"])))
    : [];

  const students = roster.map((s) => {
    const cells: Record<string, MapCell> = {};
    for (const c of conceptRows) {
      const m = mastery.find((x) => x.studentId === s.id && x.conceptId === c.id);
      const pattern = observations.find((o) => o.studentId === s.id && o.conceptId === c.id)?.name ?? null;
      cells[c.id] = { status: m?.status ?? "not_enough_evidence", evidenceCount: m?.evidenceCount ?? 0, pattern };
    }
    return { ...s, cells };
  });

  return {
    classId: cls.id,
    concepts: conceptRows.map((c) => {
      const counts = Object.fromEntries(STATUSES.map((st) => [st, 0])) as Record<MasteryStatus, number>;
      for (const s of students) counts[s.cells[c.id]!.status]++;
      return { id: c.id, title: c.title, counts };
    }),
    students,
  };
}

/** The "Why?" behind one map cell: every evidence row, whether it counted, and its weight. */
export async function getEvidenceDrilldown(db: Db, actor: Actor, classId: string, studentId: string, conceptId: string, now = new Date()): Promise<EvidenceDrilldown> {
  const cls = await loadAccessibleClass(db, actor, classId);
  if (!isUuid(studentId) || !isUuid(conceptId)) throw notFound("Not found.");
  const [member] = await db
    .select({ name: studentProfiles.name })
    .from(classEnrolments)
    .innerJoin(studentProfiles, eq(studentProfiles.id, classEnrolments.studentId))
    .where(and(eq(classEnrolments.classId, cls.id), eq(classEnrolments.studentId, studentId)));
  const [concept] = await db.select({ id: concepts.id, title: concepts.title }).from(concepts).where(eq(concepts.id, conceptId));
  if (!member || !concept) throw notFound("Not found.");

  const evidence = await loadEvidence(db, studentId, conceptId);
  const explained = defaultEstimator.explain({ evidence, now });
  const weights = new Map(explained.contributions.map((c) => [c.evidenceId, c.weight]));

  const rows = evidence.length
    ? await db
        .select({
          evidenceId: assessmentEvidence.id,
          observedAt: assessmentEvidence.observedAt,
          result: assessmentEvidence.result,
          selfConfidence: assessmentEvidence.selfConfidence,
          difficulty: assessmentEvidence.difficulty,
          stem: questions.stem,
          options: questions.options,
          responseData: questionResponses.responseData,
          pattern: misconceptionPatterns.name,
        })
        .from(assessmentEvidence)
        .innerJoin(questionResponses, eq(questionResponses.id, assessmentEvidence.questionResponseId))
        .innerJoin(questions, eq(questions.id, questionResponses.questionId))
        .leftJoin(misconceptionPatterns, eq(misconceptionPatterns.id, assessmentEvidence.matchedMisconceptionPatternId))
        .where(and(eq(assessmentEvidence.studentId, studentId), eq(assessmentEvidence.conceptId, conceptId)))
        // Answers from one attempt share a timestamp, so break ties by question to keep the order stable.
        .orderBy(asc(assessmentEvidence.observedAt), asc(questions.key), asc(assessmentEvidence.id))
    : [];

  return {
    student: { id: studentId, name: member.name },
    concept,
    mastery: { status: explained.status, evidenceCount: explained.evidenceCount, algorithmVersion: defaultEstimator.version, totalWeight: explained.totalWeight },
    rows: rows.map((r) => {
      const d = r.responseData as { kind?: string; optionId?: string; text?: string };
      const chosen =
        d.kind === "option" ? (r.options.find((o) => o.id === d.optionId)?.text ?? null) : d.kind === "text" ? (r.options.find((o) => normalizeAnswer(o.text) === normalizeAnswer(d.text ?? ""))?.text ?? d.text ?? null) : null;
      return {
        evidenceId: r.evidenceId,
        observedAt: r.observedAt.toISOString(),
        question: r.stem,
        chosen,
        result: r.result,
        confidence: r.selfConfidence,
        difficulty: r.difficulty,
        counted: weights.has(r.evidenceId),
        weight: weights.has(r.evidenceId) ? Math.round(weights.get(r.evidenceId)! * 1000) / 1000 : null,
        misconception: r.pattern,
      };
    }),
  };
}

/**
 * Class-level error patterns with real counts, plus the Misconception Mirror prompt for each
 * (anonymous, no names). Rejected observations are excluded.
 */
export async function getClassMisconceptions(db: Db, actor: Actor, classId: string): Promise<ClassMisconceptionsResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const roster = await activeRoster(db, cls.id);
  const ids = roster.map((s) => s.id);
  if (ids.length === 0) return { classSize: 0, patterns: [] };

  const obs = await db
    .select({
      studentId: misconceptionObservations.studentId,
      status: misconceptionObservations.status,
      pattern: misconceptionPatterns,
      conceptTitle: concepts.title,
    })
    .from(misconceptionObservations)
    .innerJoin(misconceptionPatterns, eq(misconceptionPatterns.id, misconceptionObservations.patternId))
    .innerJoin(concepts, eq(concepts.id, misconceptionObservations.conceptId))
    .where(and(inArray(misconceptionObservations.studentId, ids), inArray(misconceptionObservations.status, ["candidate", "likely", "confirmed"])));

  const rank = { candidate: 1, likely: 2, confirmed: 3 } as const;
  const byPattern = new Map<string, { pattern: (typeof obs)[number]["pattern"]; conceptTitle: string; students: Map<string, "candidate" | "likely" | "confirmed"> }>();
  for (const o of obs) {
    if (o.status === "rejected" || o.status === "inconclusive") continue;
    const status: "candidate" | "likely" | "confirmed" = o.status;
    const entry = byPattern.get(o.pattern.id) ?? { pattern: o.pattern, conceptTitle: o.conceptTitle, students: new Map<string, "candidate" | "likely" | "confirmed">() };
    const prev = entry.students.get(o.studentId);
    if (!prev || rank[status] > rank[prev]) entry.students.set(o.studentId, status);
    byPattern.set(o.pattern.id, entry);
  }

  // How many students have answered anything on the pattern's concept, for an honest denominator.
  const answeredRows = await db
    .selectDistinct({ studentId: assessmentEvidence.studentId, conceptId: assessmentEvidence.conceptId })
    .from(assessmentEvidence)
    .where(inArray(assessmentEvidence.studentId, ids));

  const nameOf = new Map(roster.map((s) => [s.id, s.name]));
  const patterns = [...byPattern.values()]
    .map(({ pattern, conceptTitle, students }) => {
      const answered = new Set(answeredRows.filter((r) => r.conceptId === pattern.conceptId).map((r) => r.studentId)).size;
      const n = students.size;
      const example = pattern.exampleWrongAnswers[0];
      return {
        patternId: pattern.id,
        key: pattern.key,
        name: pattern.name,
        conceptId: pattern.conceptId,
        conceptTitle,
        studentCount: n,
        students: [...students.entries()].map(([id, status]) => ({ id, name: nameOf.get(id) ?? "", status })).sort((a, b) => a.name.localeCompare(b.name)),
        summary: `${n} of ${answered} ${answered === 1 ? "student" : "students"} who answered on "${conceptTitle}" gave an answer matching: ${pattern.name}.`,
        mirror: {
          prompt: example ? `Some of us answered like this: ${example}. What might someone have been thinking? Let's test it.` : `Some answers followed this pattern: ${pattern.name}. What might someone have been thinking? Let's test it.`,
          whatToShow: pattern.recommendedExplanation,
        },
      };
    })
    .sort((a, b) => b.studentCount - a.studentCount || a.name.localeCompare(b.name));

  return { classSize: roster.length, patterns };
}
