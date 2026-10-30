import { and, asc, eq, inArray } from "drizzle-orm";
import type { CoverageResponse, LessonResponse, MasteryStatus, PresentationResponse, QuestionWithConcept } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { chapters, conceptMastery, concepts, curriculumVersions, classEnrolments, learningResources, lessonCoverage, questions } from "../../db/schema";
import { notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";
import { recordAudit } from "../audit/audit.service";
import { loadAccessibleClass } from "../classes/class.access";
import { getClassMisconceptions, getLearningMap } from "../classroom/map.service";
import { getConceptDetail } from "../curriculum/curriculum.service";
import { latestPerLevel } from "../curriculum/latest-per-level";
import { buildLessonFlow } from "./lesson-flow";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const STATUSES: MasteryStatus[] = ["not_enough_evidence", "needs_foundation", "developing", "likely_secure", "ready_for_challenge"];

/** Everything the teacher needs to run one lesson with one class, including private class insight. */
export async function getLesson(db: Db, actor: Actor, classId: string, conceptId: string): Promise<LessonResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const detail = await getConceptDetail(db, conceptId); // 404s for unknown ids

  const qs: QuestionWithConcept[] = detail.questions.map((q) => ({ ...q, conceptId: detail.id, conceptTitle: detail.title }));
  const flow = buildLessonFlow(detail.questions.map((q) => ({ id: q.id, key: q.key, role: q.role, difficulty: q.difficulty, revealsMisconception: q.options.some((o) => o.misconceptionKey) })));

  const [taught] = await db.select().from(lessonCoverage).where(and(eq(lessonCoverage.classId, cls.id), eq(lessonCoverage.conceptId, detail.id)));

  const map = await getLearningMap(db, actor, cls.id, { conceptIds: [detail.id] });
  const counts = map.concepts[0]?.counts ?? (Object.fromEntries(STATUSES.map((s) => [s, 0])) as Record<MasteryStatus, number>);
  const mis = await getClassMisconceptions(db, actor, cls.id);

  const [chapter] = await db
    .select({ title: chapters.title, order: chapters.chapterOrder, summary: chapters.summary, keyIdeas: chapters.keyIdeas })
    .from(concepts)
    .innerJoin(chapters, eq(chapters.id, concepts.chapterId))
    .where(eq(concepts.id, detail.id));

  return {
    classId: cls.id,
    concept: detail,
    chapter: { title: chapter?.title ?? "", order: chapter?.order ?? 0, summary: chapter?.summary ?? null, keyIdeas: chapter?.keyIdeas ?? [] },
    questions: qs,
    flow,
    taught: taught ? { at: taught.taughtAt.toISOString() } : null,
    insights: {
      studentCount: map.students.length,
      counts,
      patterns: mis.patterns.filter((p) => p.conceptId === detail.id).map((p) => ({ name: p.name, studentCount: p.studentCount })),
    },
  };
}

/** Marks a concept taught (or not) for a class. Idempotent. */
export async function setTaught(db: Db, actor: Actor, classId: string, conceptId: string, taught: boolean, requestId?: string): Promise<{ taught: boolean }> {
  const cls = await loadAccessibleClass(db, actor, classId);
  if (!isUuid(conceptId)) throw notFound("Concept not found.");
  const [concept] = await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.id, conceptId));
  if (!concept) throw notFound("Concept not found.");

  if (taught) await db.insert(lessonCoverage).values({ classId: cls.id, conceptId, taughtBy: actor.id }).onConflictDoNothing();
  else await db.delete(lessonCoverage).where(and(eq(lessonCoverage.classId, cls.id), eq(lessonCoverage.conceptId, conceptId)));
  await recordAudit(db, { actorId: actor.id, action: taught ? "lesson.taught" : "lesson.untaught", entityType: "concept", entityId: conceptId, metadata: { classId: cls.id }, requestId });
  return { taught };
}

/** Which concepts of the class's grade have been taught, and how many students have answered on each. */
export async function getCoverage(db: Db, actor: Actor, classId: string): Promise<CoverageResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const rows = await db
    .select({ id: concepts.id, title: concepts.title })
    .from(concepts)
    .innerJoin(curriculumVersions, eq(curriculumVersions.id, concepts.curriculumVersionId))
    .innerJoin(chapters, eq(chapters.id, concepts.chapterId))
    .where(and(eq(curriculumVersions.grade, cls.grade), eq(curriculumVersions.reviewStatus, "approved")))
    .orderBy(asc(chapters.chapterOrder), asc(concepts.conceptOrder));
  if (rows.length === 0) return { taughtCount: 0, total: 0, concepts: [] };

  const ids = rows.map((r) => r.id);
  const taught = await db.select().from(lessonCoverage).where(and(eq(lessonCoverage.classId, cls.id), inArray(lessonCoverage.conceptId, ids)));
  const roster = await db.select({ id: classEnrolments.studentId }).from(classEnrolments).where(and(eq(classEnrolments.classId, cls.id), eq(classEnrolments.status, "active")));
  const students = roster.map((r) => r.id);
  const evidence = students.length ? await db.select({ studentId: conceptMastery.studentId, conceptId: conceptMastery.conceptId }).from(conceptMastery).where(inArray(conceptMastery.studentId, students)) : [];

  const out = rows.map((r) => ({
    id: r.id,
    title: r.title,
    taughtAt: taught.find((t) => t.conceptId === r.id)?.taughtAt.toISOString() ?? null,
    studentsWithEvidence: new Set(evidence.filter((e) => e.conceptId === r.id).map((e) => e.studentId)).size,
  }));
  return { taughtCount: out.filter((c) => c.taughtAt).length, total: out.length, concepts: out };
}

const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/**
 * Projector-safe content: approved teaching material and question stems only. Built from an explicit
 * whitelist of fields, so answer keys, misconception tags, explanations, teacher notes and any class or
 * student data cannot reach the screen even if the stored content gains new fields.
 */
export async function getPresentation(db: Db, conceptId: string): Promise<PresentationResponse> {
  if (!isUuid(conceptId)) throw notFound("Concept not found.");
  const [concept] = await db.select().from(concepts).where(eq(concepts.id, conceptId));
  if (!concept) throw notFound("Concept not found.");

  const resources = await db.select().from(learningResources).where(and(eq(learningResources.conceptId, concept.id), eq(learningResources.reviewStatus, "approved"), eq(learningResources.language, concept.language), eq(learningResources.type, "explanation")));
  const qs = await db.select().from(questions).where(and(eq(questions.conceptId, concept.id), eq(questions.reviewStatus, "approved"))).orderBy(asc(questions.difficulty), asc(questions.key));

  const order = { foundation: 0, guided: 1, challenge: 2 } as const;
  return {
    title: concept.title,
    conceptKey: concept.key,
    learningObjective: concept.learningObjective,
    levels: latestPerLevel(resources)
      .filter((r): r is typeof r & { level: "foundation" | "guided" | "challenge" } => r.level !== null)
      .sort((a, b) => order[a.level] - order[b.level])
      .map((r) => {
        const c = r.content as Record<string, unknown>;
        const we = c.workedExample as { problem?: unknown; steps?: unknown } | undefined;
        const m = c.manipulative;
        return {
          level: r.level,
          title: r.title,
          summary: str(c.summary),
          steps: strs(c.steps),
          workedExample: we && str(we.problem) ? { problem: str(we.problem)!, steps: strs(we.steps) } : null,
          commonError: str(c.commonError),
          prompt: str(c.prompt),
          manipulative: m && typeof m === "object" ? (m as Record<string, unknown>) : null,
        };
      }),
    questions: qs.map((q) => ({ id: q.id, stem: q.stem, options: q.options.map((o) => ({ id: o.id, text: o.text })) })),
  };
}
