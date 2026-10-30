import { and, eq } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { assessmentQuestions, assessments, classes, questions } from "../../../db/schema";
import { AppError, conflict } from "../../../http/errors";
import { validateQuestion } from "./question-validation";
import { loadBankQuestions } from "../persistence/loaders";

export type AssessmentType = "diagnostic" | "prerequisite_pulse" | "follow_up" | "practice";

/**
 * Creates a draft assessment from approved, valid questions. Teacher-facing builder screens
 * (Phase 4) call this; they are responsible for checking the teacher owns `classId`.
 */
export async function createAssessment(db: Db, input: { classId: string; teacherId: string; title: string; type: AssessmentType; questionIds: string[] }) {
  if (input.questionIds.length === 0) throw new AppError("validation_error", "Choose at least one question.");
  if (new Set(input.questionIds).size !== input.questionIds.length) throw new AppError("validation_error", "A question can only appear once.");

  return db.transaction(async (tx) => {
    const [cls] = await tx.select({ id: classes.id }).from(classes).where(eq(classes.id, input.classId));
    if (!cls) throw new AppError("not_found", "Class not found.");

    const bank = await loadBankQuestions(tx, input.questionIds);
    for (const id of input.questionIds) {
      const q = bank.get(id);
      if (!q) throw new AppError("validation_error", "One of the questions does not exist.");
      if (q.reviewStatus !== "approved") throw new AppError("validation_error", `Question ${q.key} has not been approved.`);
      const issues = validateQuestion(q);
      if (issues.length) throw new AppError("validation_error", `Question ${q.key} is not valid: ${issues[0]!.message}`);
    }

    const [a] = await tx.insert(assessments).values({ classId: input.classId, teacherId: input.teacherId, title: input.title, type: input.type }).returning();
    await tx.insert(assessmentQuestions).values(input.questionIds.map((questionId, i) => ({ assessmentId: a!.id, questionId, sequenceOrder: i + 1 })));
    return a!;
  });
}

const ALLOWED: Record<string, string[]> = { draft: ["approved"], approved: ["open"], open: ["closed"], closed: [] };

/** Moves an assessment along draft → approved → open → closed. Skipping or reversing a step is a conflict. */
export async function advanceAssessment(db: Db, assessmentId: string, to: "approved" | "open" | "closed") {
  const [a] = await db.select().from(assessments).where(eq(assessments.id, assessmentId));
  if (!a) throw new AppError("not_found", "Assessment not found.");
  if (!ALLOWED[a.status]!.includes(to)) throw conflict(`An assessment that is ${a.status} cannot become ${to}.`);
  const [updated] = await db
    .update(assessments)
    .set({ status: to, ...(to === "open" ? { publishedAt: new Date() } : {}) })
    .where(and(eq(assessments.id, assessmentId), eq(assessments.status, a.status)))
    .returning();
  if (!updated) throw conflict("The assessment was changed by someone else. Reload and try again.");
  return updated;
}

export async function assessmentQuestionIds(db: Db, assessmentId: string): Promise<string[]> {
  const rows = await db.select({ id: questions.id, order: assessmentQuestions.sequenceOrder }).from(assessmentQuestions).innerJoin(questions, eq(questions.id, assessmentQuestions.questionId)).where(eq(assessmentQuestions.assessmentId, assessmentId));
  return rows.sort((x, y) => x.order - y.order).map((r) => r.id);
}
