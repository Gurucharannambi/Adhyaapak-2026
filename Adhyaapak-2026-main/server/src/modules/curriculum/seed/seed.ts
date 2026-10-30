import { and, eq } from "drizzle-orm";
import type { Db } from "../../../db/client";
import {
  chapters,
  conceptPrerequisites,
  concepts,
  curriculumVersions,
  learningResources,
  misconceptionPatterns,
  questionConcepts,
  questions,
  subjects,
} from "../../../db/schema";
import { CONCEPTS, CURRICULUM, MISCONCEPTIONS, PROVENANCE, QUESTIONS } from "./fractions-class6";

/**
 * Loads the Class 6 Fractions chapter. Safe to run repeatedly: every insert is
 * `ON CONFLICT DO NOTHING` on a stable key, so existing (possibly teacher-edited or approved)
 * rows are never overwritten.
 */
export async function seedFractionsClass6(db: Db): Promise<{ curriculumVersionId: string }> {
  return db.transaction(async (tx) => {
    await tx.insert(subjects).values({ name: CURRICULUM.subject }).onConflictDoNothing();
    const [subject] = await tx.select().from(subjects).where(eq(subjects.name, CURRICULUM.subject));

    await tx
      .insert(curriculumVersions)
      .values({
        title: CURRICULUM.title,
        board: CURRICULUM.board,
        academicYear: CURRICULUM.academicYear,
        grade: CURRICULUM.grade,
        subjectId: subject!.id,
        language: CURRICULUM.language,
        version: CURRICULUM.version,
        sourceReference: CURRICULUM.sourceReference,
        reviewStatus: "approved",
      })
      .onConflictDoNothing();
    const [cv] = await tx
      .select()
      .from(curriculumVersions)
      .where(
        and(
          eq(curriculumVersions.board, CURRICULUM.board),
          eq(curriculumVersions.academicYear, CURRICULUM.academicYear),
          eq(curriculumVersions.grade, CURRICULUM.grade),
          eq(curriculumVersions.subjectId, subject!.id),
          eq(curriculumVersions.language, CURRICULUM.language),
          eq(curriculumVersions.version, CURRICULUM.version),
        ),
      );

    await tx.insert(chapters).values({ curriculumVersionId: cv!.id, title: CURRICULUM.chapterTitle, chapterOrder: 1 }).onConflictDoNothing();
    const [chapter] = await tx.select().from(chapters).where(and(eq(chapters.curriculumVersionId, cv!.id), eq(chapters.chapterOrder, 1)));

    // Concepts
    await tx
      .insert(concepts)
      .values(
        CONCEPTS.map((c, i) => ({
          curriculumVersionId: cv!.id,
          chapterId: chapter!.id,
          key: c.key,
          title: c.title,
          description: c.description,
          learningObjective: c.learningObjective,
          conceptOrder: i + 1,
          language: CURRICULUM.language,
          reviewStatus: "approved" as const,
          provenance: PROVENANCE,
        })),
      )
      .onConflictDoNothing();
    const conceptRows = await tx.select().from(concepts).where(eq(concepts.curriculumVersionId, cv!.id));
    const conceptId = new Map(conceptRows.map((c) => [c.key, c.id]));
    const idOf = (key: string): string => {
      const id = conceptId.get(key);
      if (!id) throw new Error(`Seed refers to unknown concept "${key}"`);
      return id;
    };

    // Prerequisite edges
    const edges = CONCEPTS.flatMap((c) =>
      c.prerequisites.map((p) => ({
        prerequisiteConceptId: idOf(p),
        dependentConceptId: idOf(c.key),
        sourceReference: "Adhyaapak team authoring; pending subject-teacher review",
        reviewStatus: "approved" as const,
      })),
    );
    if (edges.length) await tx.insert(conceptPrerequisites).values(edges).onConflictDoNothing();

    // Resources: three teaching levels plus a teacher note per concept
    await tx
      .insert(learningResources)
      .values(
        CONCEPTS.flatMap((c) => [
          ...c.resources.map((r) => ({
            conceptId: idOf(c.key),
            key: `res-${c.key}-${r.level}`,
            type: "explanation" as const,
            level: r.level,
            title: r.title,
            language: CURRICULUM.language,
            content: r.content,
            provenance: PROVENANCE,
            reviewStatus: "approved" as const,
          })),
          {
            conceptId: idOf(c.key),
            key: `res-${c.key}-note`,
            type: "teacher_note" as const,
            level: null,
            title: "Teacher note",
            language: CURRICULUM.language,
            content: { text: c.teacherNote },
            provenance: PROVENANCE,
            reviewStatus: "approved" as const,
          },
        ]),
      )
      .onConflictDoNothing();

    // Misconception patterns
    await tx
      .insert(misconceptionPatterns)
      .values(
        MISCONCEPTIONS.map((m) => ({
          key: m.key,
          conceptId: idOf(m.concept),
          name: m.name,
          description: m.description,
          // Phase 3 defines the validated rule schema. Today the rule is "this distractor was chosen".
          triggerDefinition: { kind: "distractor_option", category: m.category },
          followUpDefinition: { questionKey: m.followUpQuestion },
          recommendedExplanation: m.recommendedExplanation,
          exampleWrongAnswers: m.exampleWrongAnswers,
          reviewStatus: "approved" as const,
        })),
      )
      .onConflictDoNothing();

    // Questions
    await tx
      .insert(questions)
      .values(
        QUESTIONS.map((q) => ({
          key: q.key,
          conceptId: idOf(q.concept),
          role: q.role,
          difficulty: q.difficulty,
          stem: q.stem,
          options: q.options,
          correctOptionId: q.correct,
          explanation: q.explanation,
          language: CURRICULUM.language,
          provenance: PROVENANCE,
          reviewStatus: "approved" as const,
        })),
      )
      .onConflictDoNothing();
    const questionRows = await tx.select({ id: questions.id, key: questions.key }).from(questions);
    const questionId = new Map(questionRows.map((q) => [q.key, q.id]));
    const links = QUESTIONS.flatMap((q) =>
      (q.alsoAssesses ?? []).map((c) => ({ questionId: questionId.get(q.key)!, conceptId: idOf(c), relationshipType: "also_assesses" })),
    );
    if (links.length) await tx.insert(questionConcepts).values(links).onConflictDoNothing();

    return { curriculumVersionId: cv!.id };
  });
}
