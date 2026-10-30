import { and, eq, inArray } from "drizzle-orm";
import { canAffectMastery, type AssessmentEvidence, type AtlasRecord, type AtlasWorkspaceResponse, type EvidenceStrength, type ObservationReview, type TrackOutcome } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { assessmentAttempts, assessmentEvidence, assessments, chapters, conceptPrerequisites, concepts, interventions, misconceptionObservations, misconceptionPatterns, questionResponses } from "../../db/schema";
import type { Actor } from "../auth/permissions";
import { loadAccessibleClass } from "../classes/class.access";
import { activeRoster } from "../classroom/map.service";
import { loadBankQuestions, loadEvidenceForStudents } from "../learning/persistence/loaders";

/**
 * What a student's answers on the concept say after their latest observation of a pattern. Only counted answers are
 * used. "demonstrated" needs two right answers and no wrong one: a single right answer is "partial", never "resolved".
 */
export function trackOutcome(later: ReadonlyArray<Pick<AssessmentEvidence, "result" | "matchedMisconceptionPatternId">>, patternId: string): TrackOutcome {
  if (later.length === 0) return "no_new_evidence";
  if (later.some((e) => e.matchedMisconceptionPatternId === patternId)) return "same_error";
  const right = later.filter((e) => e.result === "correct").length;
  const wrong = later.length - right;
  if (right >= 2 && wrong === 0) return "demonstrated";
  if (right >= 1) return "partial";
  return "other_error";
}

/** One student's review state for a pattern, from all of their observations of it. */
export function reviewOf(statuses: ReadonlyArray<"candidate" | "likely" | "confirmed" | "rejected" | "inconclusive">): ObservationReview {
  if (statuses.includes("confirmed")) return "confirmed";
  if (statuses.some((s) => s === "candidate" || s === "likely")) return "open";
  if (statuses.includes("inconclusive")) return "inconclusive";
  return "dismissed";
}

const ZERO_TRACK = (): Record<TrackOutcome, number> => ({ demonstrated: 0, partial: 0, same_error: 0, other_error: 0, no_new_evidence: 0 });
const ZERO_REVIEW = (): Record<ObservationReview, number> => ({ open: 0, confirmed: 0, dismissed: 0, inconclusive: 0 });

export async function getAtlasWorkspace(db: Db, actor: Actor, classId: string): Promise<AtlasWorkspaceResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const roster = await activeRoster(db, cls.id);
  const ids = roster.map((s) => s.id);
  const nameOf = new Map(roster.map((s) => [s.id, s.name]));
  const empty: AtlasWorkspaceResponse = { classId: cls.id, className: cls.name, studentCount: ids.length, summary: { needsInvestigation: 0, conceptsToRevisit: 0, awaitingReview: 0 }, records: [] };
  if (ids.length === 0) return empty;

  // Every observation for this class's students, with the answer that produced it and the check it came from.
  const obs = await db
    .select({
      studentId: misconceptionObservations.studentId,
      status: misconceptionObservations.status,
      patternId: misconceptionObservations.patternId,
      conceptId: misconceptionObservations.conceptId,
      observedAt: assessmentEvidence.observedAt,
      questionId: questionResponses.questionId,
      response: questionResponses.responseData,
      assessmentId: assessments.id,
      checkTitle: assessments.title,
      checkClassId: assessments.classId,
    })
    .from(misconceptionObservations)
    .innerJoin(assessmentEvidence, eq(assessmentEvidence.id, misconceptionObservations.evidenceId))
    .innerJoin(questionResponses, eq(questionResponses.id, assessmentEvidence.questionResponseId))
    .innerJoin(assessmentAttempts, eq(assessmentAttempts.id, questionResponses.attemptId))
    .innerJoin(assessments, eq(assessments.id, assessmentAttempts.assessmentId))
    .where(inArray(misconceptionObservations.studentId, ids));
  if (obs.length === 0) return empty;

  const patternIds = [...new Set(obs.map((o) => o.patternId))];
  const conceptIds = [...new Set(obs.map((o) => o.conceptId))];
  const patterns = new Map((await db.select().from(misconceptionPatterns).where(inArray(misconceptionPatterns.id, patternIds))).map((p) => [p.id, p]));
  const conceptRows = await db.select({ id: concepts.id, title: concepts.title, chapterTitle: chapters.title }).from(concepts).innerJoin(chapters, eq(chapters.id, concepts.chapterId)).where(inArray(concepts.id, conceptIds));
  const conceptOf = new Map(conceptRows.map((c) => [c.id, c]));
  const prereqRows = await db
    .select({ dependent: conceptPrerequisites.dependentConceptId, id: concepts.id, title: concepts.title })
    .from(conceptPrerequisites)
    .innerJoin(concepts, eq(concepts.id, conceptPrerequisites.prerequisiteConceptId))
    .where(and(inArray(conceptPrerequisites.dependentConceptId, conceptIds), eq(conceptPrerequisites.reviewStatus, "approved")));
  const bank = await loadBankQuestions(db, [...new Set(obs.map((o) => o.questionId))]);
  const evidence = (await loadEvidenceForStudents(db, ids)).filter((e) => canAffectMastery(e));
  const answered = new Map<string, Set<string>>();
  for (const e of evidence) answered.set(e.conceptId, (answered.get(e.conceptId) ?? new Set()).add(e.studentId));
  const ivs = await db.select({ studentId: interventions.studentId, conceptId: interventions.conceptId, status: interventions.status }).from(interventions).where(and(inArray(interventions.studentId, ids), inArray(interventions.conceptId, conceptIds)));

  const records: AtlasRecord[] = [];
  for (const patternId of patternIds) {
    const p = patterns.get(patternId)!;
    const mine = obs.filter((o) => o.patternId === patternId);
    const concept = conceptOf.get(p.conceptId) ?? { id: p.conceptId, title: "", chapterTitle: "" };
    const byStudent = new Map<string, typeof mine>();
    for (const o of mine) byStudent.set(o.studentId, [...(byStudent.get(o.studentId) ?? []), o]);

    const students: AtlasRecord["students"] = [];
    const review = ZERO_REVIEW();
    const track = ZERO_TRACK();
    for (const [studentId, list] of byStudent) {
      const r = reviewOf(list.map((o) => o.status));
      review[r]++;
      const live = list.filter((o) => o.status !== "rejected");
      const last = Math.max(...list.map((o) => o.observedAt.getTime()));
      const later = evidence.filter((e) => e.studentId === studentId && e.conceptId === p.conceptId && Date.parse(e.observedAt) > last);
      const outcome = trackOutcome(later, patternId);
      if (r !== "dismissed") track[outcome]++;
      students.push({ id: studentId, name: nameOf.get(studentId)!, observations: live.length, review: r, lastSeen: new Date(last).toISOString(), outcome });
    }
    const active = students.filter((s) => s.review !== "dismissed");
    if (active.length === 0) continue; // every student dismissed: nothing left to act on

    const repeated = active.filter((s) => s.observations >= 2).length;
    const strength: EvidenceStrength = review.confirmed > 0 ? "confirmed" : repeated > 0 ? "repeated" : "single";
    const responses = mine
      .filter((o) => o.status !== "rejected")
      .sort((a, b) => b.observedAt.getTime() - a.observedAt.getTime())
      .slice(0, 12)
      .map((o) => {
        const q = bank.get(o.questionId);
        const chosen = (o.response as { optionId?: string }).optionId;
        return {
          studentId: o.studentId,
          studentName: nameOf.get(o.studentId)!,
          question: q?.stem ?? "",
          answer: q?.options.find((x) => x.id === chosen)?.text ?? "(answer not recorded as a choice)",
          expected: q?.options.find((x) => x.id === q.correctOptionId)?.text ?? "",
          check: o.checkTitle,
          at: o.observedAt.toISOString(),
        };
      });
    const times = mine.map((o) => o.observedAt.getTime());
    const activeIds = new Set(active.map((s) => s.id));
    const iv = ivs.filter((x) => x.conceptId === p.conceptId && activeIds.has(x.studentId));
    records.push({
      patternId,
      name: p.name,
      description: p.description,
      recommendedExplanation: p.recommendedExplanation,
      concept,
      prerequisites: prereqRows.filter((r) => r.dependent === p.conceptId).map((r) => ({ id: r.id, title: r.title })),
      affected: active.length,
      answeredOnConcept: answered.get(p.conceptId)?.size ?? 0,
      repeated,
      checks: new Set(mine.map((o) => o.assessmentId)).size,
      firstSeen: new Date(Math.min(...times)).toISOString(),
      lastSeen: new Date(Math.max(...times)).toISOString(),
      strength,
      review,
      responses,
      students: students.sort((a, b) => b.observations - a.observations || a.name.localeCompare(b.name)),
      track,
      interventions: { assigned: new Set(iv.filter((x) => x.status === "assigned").map((x) => x.studentId)).size, completed: new Set(iv.filter((x) => x.status === "completed").map((x) => x.studentId)).size },
    });
  }

  const rank: Record<EvidenceStrength, number> = { confirmed: 2, repeated: 1, single: 0 };
  records.sort((a, b) => rank[b.strength] - rank[a.strength] || b.affected - a.affected || a.name.localeCompare(b.name));
  const investigate = new Set<string>();
  const awaiting = new Set<string>();
  for (const r of records)
    for (const s of r.students) {
      if (s.review === "dismissed" || s.observations < 2) continue;
      investigate.add(s.id);
      if (s.review === "open") awaiting.add(s.id);
    }
  return {
    ...empty,
    summary: { needsInvestigation: investigate.size, conceptsToRevisit: new Set(records.filter((r) => r.strength !== "single").map((r) => r.concept.id)).size, awaitingReview: awaiting.size },
    records,
  };
}
