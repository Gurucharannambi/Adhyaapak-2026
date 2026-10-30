import { and, asc, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";
import type { StudentResultDto } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { assessmentAttempts, assessmentQuestions, assessments, questionResponses, questions } from "../../db/schema";

/** Released results stay on a student's screen for this long, then the page goes back to waiting. */
const RESULTS_WINDOW_MS = 6 * 3600 * 1000;

/**
 * A student's own results for the class's most recently released check, or null if there is none (nothing released,
 * released too long ago, or this student did not take it). Only the student's own answers are read, and only friendly
 * outcomes are returned: never a score, a percentage or another student's data.
 */
export async function getStudentResults(db: Db, studentId: string, classId: string, now = new Date()): Promise<StudentResultDto | null> {
  const [a] = await db
    .select()
    .from(assessments)
    .where(and(eq(assessments.classId, classId), eq(assessments.status, "closed"), isNull(assessments.ownerStudentId), isNotNull(assessments.resultsReleasedAt), gt(assessments.resultsReleasedAt, new Date(now.getTime() - RESULTS_WINDOW_MS))))
    .orderBy(desc(assessments.resultsReleasedAt))
    .limit(1);
  if (!a) return null;

  const [attempt] = await db.select({ id: assessmentAttempts.id }).from(assessmentAttempts).where(and(eq(assessmentAttempts.assessmentId, a.id), eq(assessmentAttempts.studentId, studentId)));
  if (!attempt) return null;

  const links = await db
    .select({ q: questions, order: assessmentQuestions.sequenceOrder })
    .from(assessmentQuestions)
    .innerJoin(questions, eq(questions.id, assessmentQuestions.questionId))
    .where(eq(assessmentQuestions.assessmentId, a.id))
    .orderBy(asc(assessmentQuestions.sequenceOrder));
  const responses = await db.select().from(questionResponses).where(eq(questionResponses.attemptId, attempt.id));

  return {
    title: a.title,
    questions: links.map(({ q }) => {
      const r = responses.find((x) => x.questionId === q.id);
      const chosenId = r && r.responseData.kind === "option" && typeof r.responseData.optionId === "string" ? r.responseData.optionId : null;
      const outcome = !r || r.result === "insufficient" ? "blank" : r.result === "correct" ? "right" : "not_yet";
      return {
        stem: q.stem,
        yourAnswer: chosenId ? (q.options.find((o) => o.id === chosenId)?.text ?? null) : null,
        correctAnswer: q.options.find((o) => o.id === q.correctOptionId)?.text ?? "",
        outcome,
        explanation: q.explanation,
      };
    }),
  };
}
