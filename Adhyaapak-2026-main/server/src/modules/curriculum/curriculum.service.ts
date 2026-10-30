import { and, asc, count, eq, inArray } from "drizzle-orm";
import type { ChapterDto, ConceptDetailDto, ConceptSummaryDto, CurriculumVersionDto } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import {
  chapters,
  conceptPrerequisites,
  concepts,
  curriculumVersions,
  learningResources,
  misconceptionPatterns,
  questions,
  subjects,
} from "../../db/schema";
import { notFound } from "../../http/errors";
import { latestPerLevel } from "./latest-per-level";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

export async function listCurriculum(db: Db): Promise<CurriculumVersionDto[]> {
  const rows = await db
    .select({ cv: curriculumVersions, subject: subjects.name })
    .from(curriculumVersions)
    .innerJoin(subjects, eq(subjects.id, curriculumVersions.subjectId))
    .where(eq(curriculumVersions.reviewStatus, "approved"))
    .orderBy(asc(curriculumVersions.grade), asc(subjects.name));
  return rows.map(({ cv, subject }) => ({
    id: cv.id,
    title: cv.title,
    board: cv.board,
    academicYear: cv.academicYear,
    grade: cv.grade,
    subject,
    language: cv.language,
    version: cv.version,
    reviewStatus: cv.reviewStatus,
  }));
}

export async function listChapters(db: Db, curriculumId: string): Promise<ChapterDto[]> {
  if (!isUuid(curriculumId)) throw notFound("Curriculum not found.");
  const [cv] = await db.select({ id: curriculumVersions.id }).from(curriculumVersions).where(eq(curriculumVersions.id, curriculumId));
  if (!cv) throw notFound("Curriculum not found.");
  const rows = await db
    .select({ id: chapters.id, title: chapters.title, order: chapters.chapterOrder, summary: chapters.summary, keyIdeas: chapters.keyIdeas, conceptCount: count(concepts.id) })
    .from(chapters)
    .leftJoin(concepts, eq(concepts.chapterId, chapters.id))
    .where(eq(chapters.curriculumVersionId, curriculumId))
    .groupBy(chapters.id)
    .orderBy(asc(chapters.chapterOrder));
  return rows.map((r) => ({ ...r, keyIdeas: r.keyIdeas ?? [] }));
}

export async function listConcepts(db: Db, chapterId: string): Promise<ConceptSummaryDto[]> {
  if (!isUuid(chapterId)) throw notFound("Chapter not found.");
  const rows = await db.select().from(concepts).where(eq(concepts.chapterId, chapterId)).orderBy(asc(concepts.conceptOrder));
  if (rows.length === 0) {
    const [ch] = await db.select({ id: chapters.id }).from(chapters).where(eq(chapters.id, chapterId));
    if (!ch) throw notFound("Chapter not found.");
  }
  const edges = rows.length
    ? await db.select().from(conceptPrerequisites).where(inArray(conceptPrerequisites.dependentConceptId, rows.map((r) => r.id)))
    : [];
  return rows.map((c) => ({
    id: c.id,
    key: c.key,
    title: c.title,
    learningObjective: c.learningObjective,
    prerequisiteIds: edges.filter((e) => e.dependentConceptId === c.id).map((e) => e.prerequisiteConceptId),
  }));
}

/** Teacher view of one concept: resources, questions with answers, misconceptions and graph neighbours. */
export async function getConceptDetail(db: Db, conceptId: string): Promise<ConceptDetailDto> {
  if (!isUuid(conceptId)) throw notFound("Concept not found.");
  const [row] = await db
    .select({ concept: concepts, chapterTitle: chapters.title })
    .from(concepts)
    .innerJoin(chapters, eq(chapters.id, concepts.chapterId))
    .where(eq(concepts.id, conceptId));
  if (!row) throw notFound("Concept not found.");
  const c = row.concept;

  const [prereqs, dependents, resources, qs, patterns] = await Promise.all([
    db
      .select({ id: concepts.id, title: concepts.title })
      .from(conceptPrerequisites)
      .innerJoin(concepts, eq(concepts.id, conceptPrerequisites.prerequisiteConceptId))
      .where(eq(conceptPrerequisites.dependentConceptId, c.id))
      .orderBy(asc(concepts.conceptOrder)),
    db
      .select({ id: concepts.id, title: concepts.title })
      .from(conceptPrerequisites)
      .innerJoin(concepts, eq(concepts.id, conceptPrerequisites.dependentConceptId))
      .where(eq(conceptPrerequisites.prerequisiteConceptId, c.id))
      .orderBy(asc(concepts.conceptOrder)),
    db.select().from(learningResources).where(and(eq(learningResources.conceptId, c.id), eq(learningResources.reviewStatus, "approved"), eq(learningResources.language, c.language))),
    db.select().from(questions).where(and(eq(questions.conceptId, c.id), eq(questions.reviewStatus, "approved"))).orderBy(asc(questions.difficulty), asc(questions.key)),
    db.select().from(misconceptionPatterns).where(eq(misconceptionPatterns.conceptId, c.id)),
  ]);

  const levelOrder = { foundation: 0, guided: 1, challenge: 2 } as const;
  return {
    id: c.id,
    key: c.key,
    title: c.title,
    description: c.description,
    learningObjective: c.learningObjective,
    chapter: { id: c.chapterId, title: row.chapterTitle },
    prerequisites: prereqs,
    dependents,
    resources: latestPerLevel(resources)
      .sort((a, b) => (a.level ? levelOrder[a.level] : 9) - (b.level ? levelOrder[b.level] : 9))
      .map((r) => ({
        id: r.id,
        type: r.type,
        level: r.level,
        title: r.title,
        language: r.language,
        content: r.content,
        provenance: r.provenance,
        reviewStatus: r.reviewStatus,
      })),
    questions: qs.map((q) => ({
      id: q.id,
      key: q.key,
      role: q.role,
      difficulty: q.difficulty,
      stem: q.stem,
      options: q.options,
      correctOptionId: q.correctOptionId,
      explanation: q.explanation,
      reviewStatus: q.reviewStatus,
    })),
    misconceptions: patterns.map((p) => ({
      id: p.id,
      key: p.key,
      name: p.name,
      description: p.description,
      exampleWrongAnswers: p.exampleWrongAnswers,
      recommendedExplanation: p.recommendedExplanation,
      reviewStatus: p.reviewStatus,
    })),
    provenance: c.provenance,
    reviewStatus: c.reviewStatus,
  };
}
