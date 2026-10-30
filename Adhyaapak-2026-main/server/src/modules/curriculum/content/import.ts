import { and, eq, inArray, max } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { chapters, conceptPrerequisites, concepts, curriculumVersions, learningResources, misconceptionPatterns, questionConcepts, questions, subjects } from "../../../db/schema";
import { checkPackage, ContentPackage, type PackageIssue } from "./package";

export interface ImportReport {
  ok: boolean;
  dryRun: boolean;
  issues: PackageIssue[];
  created: { concepts: number; prerequisites: number; resources: number; questions: number; misconceptions: number; translations: number };
  /** Items whose key already existed and were left untouched. */
  skipped: { concepts: number; questions: number; misconceptions: number; translations: number };
}

const emptyCounts = () => ({ concepts: 0, prerequisites: 0, resources: 0, questions: 0, misconceptions: 0, translations: 0 });

/**
 * Checks a content package and, unless `dryRun`, writes it. Nothing is written if there is a single error.
 * Existing keys are never overwritten (a re-run is harmless), so reviewed or teacher-edited content is safe.
 *
 * `approve`: the author attests the content has been reviewed, so it is usable straight away. Without it, concepts,
 * questions and misconceptions arrive as drafts for a teacher to approve. Translations are always drafts: a person
 * who reads the language must approve them.
 */
export async function importPackage(db: Db, raw: unknown, opts: { dryRun?: boolean; approve?: boolean } = {}): Promise<ImportReport> {
  const dryRun = opts.dryRun ?? false;
  const report: ImportReport = { ok: false, dryRun, issues: [], created: emptyCounts(), skipped: { concepts: 0, questions: 0, misconceptions: 0, translations: 0 } };

  const parsed = ContentPackage.safeParse(raw);
  if (!parsed.success) {
    report.issues = parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(package)", message: i.message, severity: "error" as const }));
    return report;
  }
  const pkg = parsed.data;
  const c = pkg.curriculum;

  const [subject] = await db.select().from(subjects).where(eq(subjects.name, c.subject));
  const [cv] = subject
    ? await db
        .select()
        .from(curriculumVersions)
        .where(and(eq(curriculumVersions.board, c.board), eq(curriculumVersions.academicYear, c.academicYear), eq(curriculumVersions.grade, c.grade), eq(curriculumVersions.subjectId, subject.id), eq(curriculumVersions.language, c.language), eq(curriculumVersions.version, c.version)))
    : [];

  const existingConcepts = cv ? await db.select({ key: concepts.key }).from(concepts).where(eq(concepts.curriculumVersionId, cv.id)) : [];
  const allQuestionKeys = pkg.questions.length ? await db.select({ key: questions.key }).from(questions) : [];
  const allMisconceptionKeys = pkg.misconceptions.length || pkg.questions.length ? await db.select({ key: misconceptionPatterns.key }).from(misconceptionPatterns) : [];
  const existing = {
    conceptKeys: new Set(existingConcepts.map((r) => r.key)),
    questionKeys: new Set(allQuestionKeys.map((r) => r.key)),
    misconceptionKeys: new Set(allMisconceptionKeys.map((r) => r.key)),
  };

  report.issues = checkPackage(pkg, existing);
  report.skipped.concepts = pkg.concepts.filter((x) => existing.conceptKeys.has(x.key)).length;
  report.skipped.questions = pkg.questions.filter((x) => existing.questionKeys.has(x.key)).length;
  report.skipped.misconceptions = pkg.misconceptions.filter((x) => existing.misconceptionKeys.has(x.key)).length;
  if (report.issues.some((i) => i.severity === "error")) return report;

  const newConcepts = pkg.concepts.filter((x) => !existing.conceptKeys.has(x.key));
  const newQuestions = pkg.questions.filter((x) => !existing.questionKeys.has(x.key));
  const newMisconceptions = pkg.misconceptions.filter((x) => !existing.misconceptionKeys.has(x.key));
  report.created = { concepts: newConcepts.length, prerequisites: newConcepts.reduce((n, x) => n + x.prerequisites.length, 0), resources: newConcepts.reduce((n, x) => n + x.resources.length + 1, 0), questions: newQuestions.length, misconceptions: newMisconceptions.length, translations: pkg.translations.length };
  if (dryRun) {
    report.ok = true;
    return report;
  }

  const status = opts.approve ? ("approved" as const) : ("draft" as const);
  const provenance = { source: pkg.provenance.source, ...(pkg.provenance.note ? { note: pkg.provenance.note } : {}) };

  await db.transaction(async (tx) => {
    await tx.insert(subjects).values({ name: c.subject }).onConflictDoNothing();
    const [subj] = await tx.select().from(subjects).where(eq(subjects.name, c.subject));
    await tx.insert(curriculumVersions).values({ title: c.title, board: c.board, academicYear: c.academicYear, grade: c.grade, subjectId: subj!.id, language: c.language, version: c.version, sourceReference: c.sourceReference, reviewStatus: status }).onConflictDoNothing();
    const [version] = await tx
      .select()
      .from(curriculumVersions)
      .where(and(eq(curriculumVersions.board, c.board), eq(curriculumVersions.academicYear, c.academicYear), eq(curriculumVersions.grade, c.grade), eq(curriculumVersions.subjectId, subj!.id), eq(curriculumVersions.language, c.language), eq(curriculumVersions.version, c.version)));

    // Concepts, resources and prerequisites exist only when the package has new concepts.
    let chapterId: string | undefined;
    if (newConcepts.length > 0) {
      const [found] = await tx.select().from(chapters).where(and(eq(chapters.curriculumVersionId, version!.id), eq(chapters.title, pkg.chapter.title)));
      if (found) {
        chapterId = found.id;
        // A chapter that exists without a summary gets ours; an existing summary is never overwritten.
        if (!found.summary && pkg.chapter.summary) await tx.update(chapters).set({ summary: pkg.chapter.summary, keyIdeas: pkg.chapter.keyIdeas ?? null }).where(eq(chapters.id, found.id));
      } else {
        const [{ top } = { top: 0 }] = await tx.select({ top: max(chapters.chapterOrder) }).from(chapters).where(eq(chapters.curriculumVersionId, version!.id));
        const [made] = await tx.insert(chapters).values({ curriculumVersionId: version!.id, title: pkg.chapter.title, chapterOrder: (top ?? 0) + 1, summary: pkg.chapter.summary ?? null, keyIdeas: pkg.chapter.keyIdeas ?? null }).returning();
        chapterId = made!.id;
      }
      const [{ topOrder } = { topOrder: 0 }] = await tx.select({ topOrder: max(concepts.conceptOrder) }).from(concepts).where(eq(concepts.curriculumVersionId, version!.id));
      await tx.insert(concepts).values(
        newConcepts.map((x, i) => ({ curriculumVersionId: version!.id, chapterId: chapterId!, key: x.key, title: x.title, description: x.description, learningObjective: x.learningObjective, conceptOrder: (topOrder ?? 0) + i + 1, language: c.language, reviewStatus: status, provenance })),
      );
    }

    const rows = await tx.select().from(concepts).where(eq(concepts.curriculumVersionId, version!.id));
    const idOf = new Map(rows.map((r) => [r.key, r.id]));
    const need = (k: string) => {
      const id = idOf.get(k);
      if (!id) throw new Error(`Unknown concept "${k}"`);
      return id;
    };

    const edges = newConcepts.flatMap((x) => x.prerequisites.map((p) => ({ prerequisiteConceptId: need(p), dependentConceptId: need(x.key), sourceReference: "Content package", reviewStatus: status })));
    if (edges.length) await tx.insert(conceptPrerequisites).values(edges).onConflictDoNothing();

    const resourceRows = newConcepts.flatMap((x) => [
      ...x.resources.map((r) => ({ conceptId: need(x.key), key: `res-${x.key}-${r.level}`, type: "explanation" as const, level: r.level, title: r.title, language: c.language, content: r.content, provenance, reviewStatus: status })),
      { conceptId: need(x.key), key: `res-${x.key}-note`, type: "teacher_note" as const, level: null, title: "Teacher note", language: c.language, content: { text: x.teacherNote }, provenance, reviewStatus: status },
    ]);
    if (resourceRows.length) await tx.insert(learningResources).values(resourceRows).onConflictDoNothing();

    if (newMisconceptions.length)
      await tx.insert(misconceptionPatterns).values(
        newMisconceptions.map((m) => ({
          key: m.key, conceptId: need(m.concept), name: m.name, description: m.description,
          triggerDefinition: { kind: "distractor_option", category: m.category }, followUpDefinition: { questionKey: m.followUpQuestion },
          recommendedExplanation: m.recommendedExplanation, exampleWrongAnswers: m.exampleWrongAnswers, reviewStatus: status,
        })),
      );
    if (newQuestions.length) {
      await tx.insert(questions).values(newQuestions.map((q) => ({ key: q.key, conceptId: need(q.concept), role: q.role, difficulty: q.difficulty, stem: q.stem, options: q.options, correctOptionId: q.correct, explanation: q.explanation, language: c.language, provenance, reviewStatus: status })));
      const qRows = await tx.select({ id: questions.id, key: questions.key }).from(questions).where(inArray(questions.key, newQuestions.map((q) => q.key)));
      const qid = new Map(qRows.map((q) => [q.key, q.id]));
      const links = newQuestions.flatMap((q) => (q.alsoAssesses ?? []).map((a) => ({ questionId: qid.get(q.key)!, conceptId: need(a), relationshipType: "also_assesses" })));
      if (links.length) await tx.insert(questionConcepts).values(links).onConflictDoNothing();
    }

    // Translations are always drafts: they need a person who reads the language.
    const tKeys = pkg.translations.map((t) => `res-${t.concept}-${t.level}-${t.language}`);
    const already = tKeys.length ? new Set((await tx.select({ key: learningResources.key }).from(learningResources).where(inArray(learningResources.key, tKeys))).map((r) => r.key)) : new Set<string>();
    const fresh = pkg.translations.filter((t) => !already.has(`res-${t.concept}-${t.level}-${t.language}`));
    report.skipped.translations = pkg.translations.length - fresh.length;
    report.created.translations = fresh.length;
    if (fresh.length)
      await tx.insert(learningResources).values(
        fresh.map((t) => ({ conceptId: need(t.concept), key: `res-${t.concept}-${t.level}-${t.language}`, type: "explanation" as const, level: t.level, title: t.title, language: t.language, content: t.content, provenance: { source: pkg.provenance.source, note: t.note ?? pkg.provenance.note ?? "Translation draft. Needs review by a teacher who reads this language before use." }, reviewStatus: "draft" as const })),
      );
  });

  report.ok = true;
  return report;
}
