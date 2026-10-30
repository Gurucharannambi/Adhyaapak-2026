import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { ActivityType, BoardCard, BranchBoardResponse, GroupKey, MasteryStatus, Recommendation } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { classEnrolments, concepts, conceptMastery, interventions, misconceptionObservations, misconceptionPatterns, studentProfiles } from "../../db/schema";
import { notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";
import { loadAccessibleClass } from "../classes/class.access";
import { groupFor } from "../learning/adaptation/groups";
import { recommendNextActivity, type ConceptState, type PastRecommendation } from "../learning/adaptation/policy";
import { loadConceptGraph } from "../learning/graph/graph.repo";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/** Suggested time per lane, shown on the board and on printed slips. */
export const SUGGESTED_MINUTES: Record<GroupKey, number> = { foundation: 15, guided: 10, challenge: 10, follow_up: 5 };

/** What a student does when a teacher moves them into a lane the policy did not choose. */
export const DEFAULT_ACTIVITY: Record<GroupKey, ActivityType> = {
  foundation: "foundation_activity",
  guided: "guided_practice",
  challenge: "challenge_activity",
  follow_up: "follow_up_assessment",
};

export interface StudentRec {
  studentId: string;
  name: string;
  rosterNumber: number;
  rec: Recommendation;
  /** Mastery on the lesson concept itself. */
  state: ConceptState;
  /** Mastery by concept, for snapshots of the target concept. */
  mastery: Map<string, ConceptState>;
}

const NONE: ConceptState = { status: "not_enough_evidence", estimate: 0.5, evidenceCount: 0, evidenceIds: [] };

/**
 * One recommendation per active student for a lesson concept, from stored records only.
 * The assign route calls this again on the server: it never trusts the client's idea of the recommendation.
 */
export async function computeRecommendations(db: Db, classId: string, conceptId: string) {
  if (!isUuid(conceptId)) throw notFound("Concept not found.");
  const [concept] = await db.select().from(concepts).where(eq(concepts.id, conceptId));
  if (!concept) throw notFound("Concept not found.");
  const graph = await loadConceptGraph(db, concept.curriculumVersionId);
  if (!graph.has(conceptId)) throw notFound("Concept not found.");

  const titleRows = await db.select({ id: concepts.id, title: concepts.title }).from(concepts).where(eq(concepts.curriculumVersionId, concept.curriculumVersionId));
  const titles = new Map(titleRows.map((r) => [r.id, r.title]));

  const roster = await db
    .select({ id: studentProfiles.id, name: studentProfiles.name, rosterNumber: classEnrolments.rosterNumber })
    .from(classEnrolments)
    .innerJoin(studentProfiles, eq(studentProfiles.id, classEnrolments.studentId))
    .where(and(eq(classEnrolments.classId, classId), eq(classEnrolments.status, "active")))
    .orderBy(asc(classEnrolments.rosterNumber));
  const ids = roster.map((s) => s.id);
  if (ids.length === 0) return { concept, titles, graph, recs: [] as StudentRec[] };

  const masteryRows = await db.select().from(conceptMastery).where(inArray(conceptMastery.studentId, ids));
  const obs = await db
    .select({ studentId: misconceptionObservations.studentId, patternId: misconceptionObservations.patternId, name: misconceptionPatterns.name })
    .from(misconceptionObservations)
    .innerJoin(misconceptionPatterns, eq(misconceptionPatterns.id, misconceptionObservations.patternId))
    .where(and(inArray(misconceptionObservations.studentId, ids), eq(misconceptionObservations.conceptId, conceptId), inArray(misconceptionObservations.status, ["likely", "confirmed"])));
  const past = await db.select().from(interventions).where(and(eq(interventions.classId, classId), eq(interventions.conceptId, conceptId)));

  const recs: StudentRec[] = roster.map((s) => {
    const mastery = new Map<string, ConceptState>(
      masteryRows.filter((m) => m.studentId === s.id).map((m) => [m.conceptId, { status: m.status, estimate: m.estimate, evidenceCount: m.evidenceCount, evidenceIds: m.evidenceIds }]),
    );
    const mine = new Map<string, string>();
    for (const o of obs.filter((x) => x.studentId === s.id)) mine.set(o.patternId, o.name);
    const history: PastRecommendation[] = past
      .filter((p) => p.studentId === s.id)
      .map((p) => ({ conceptId: p.targetConceptId, activityType: p.activityType, statusAtTime: p.statusAtAssignment }));
    const rec = recommendNextActivity({
      studentId: s.id,
      conceptId,
      graph,
      masteryByConcept: mastery,
      misconceptions: [...mine].map(([patternId, name]) => ({ patternId, name })),
      history,
    });
    return { studentId: s.id, name: s.name, rosterNumber: s.rosterNumber, rec, state: mastery.get(conceptId) ?? NONE, mastery };
  });
  return { concept, titles, graph, recs };
}

/** The Branch Board: every active student placed in a temporary lane with a reason, for the teacher to adjust. */
export async function getBranchBoard(db: Db, actor: Actor, classId: string, conceptId?: string): Promise<BranchBoardResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const empty = { foundation: [], guided: [], challenge: [], follow_up: [] } as BranchBoardResponse["lanes"];

  // Concepts that have any evidence in this class.
  const ids = (
    await db.select({ id: classEnrolments.studentId }).from(classEnrolments).where(and(eq(classEnrolments.classId, cls.id), eq(classEnrolments.status, "active")))
  ).map((r) => r.id);
  const withEvidence = ids.length
    ? await db
        .select({ id: concepts.id, title: concepts.title, order: concepts.conceptOrder, students: sql<number>`count(distinct ${conceptMastery.studentId})`.mapWith(Number) })
        .from(conceptMastery)
        .innerJoin(concepts, eq(concepts.id, conceptMastery.conceptId))
        .where(inArray(conceptMastery.studentId, ids))
        .groupBy(concepts.id)
        .orderBy(asc(concepts.conceptOrder))
    : [];
  const choices = withEvidence.map((c) => ({ id: c.id, title: c.title }));
  // Default to the concept most of the class has answers on (the lesson just assessed); ties go to the later concept.
  const busiest = withEvidence.reduce<(typeof withEvidence)[number] | undefined>((best, c) => (!best || c.students >= best.students ? c : best), undefined);
  const chosen = conceptId ?? busiest?.id;
  if (!chosen) return { conceptId: null, conceptTitle: null, concepts: choices, lanes: empty };

  const { concept, titles, recs } = await computeRecommendations(db, cls.id, chosen);
  const active = await db
    .select()
    .from(interventions)
    .where(and(eq(interventions.classId, cls.id), eq(interventions.conceptId, chosen), eq(interventions.status, "assigned")));

  const lanes = { foundation: [], guided: [], challenge: [], follow_up: [] } as BranchBoardResponse["lanes"];
  for (const r of recs) {
    const lane = groupFor(r.rec.activity.type);
    const mine = active.find((a) => a.studentId === r.studentId);
    const card: BoardCard = {
      studentId: r.studentId,
      name: r.name,
      rosterNumber: r.rosterNumber,
      status: r.state.status as MasteryStatus,
      evidenceCount: r.state.evidenceCount,
      activity: r.rec.activity.type,
      targetConceptId: r.rec.conceptId,
      targetConceptTitle: titles.get(r.rec.conceptId) ?? "",
      prerequisiteTitles: r.rec.prerequisiteConceptIds.map((id) => titles.get(id) ?? ""),
      reason: r.rec.reason,
      uncertainty: r.rec.uncertainty,
      teacherReviewRequired: r.rec.teacherReviewRequired,
      suggestedMinutes: SUGGESTED_MINUTES[lane],
      assigned: mine ? { interventionId: mine.id, groupKey: mine.groupKey, followUpAssessmentId: mine.followUpAssessmentId } : null,
    };
    lanes[lane].push(card);
  }
  return { conceptId: concept.id, conceptTitle: concept.title, concepts: choices, lanes };
}
