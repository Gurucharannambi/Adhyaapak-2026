import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { HintResponse, PracticeResultResponse, PracticeSetResponse, ProgressWord, StudentHomeResponse, SubmitPracticeRequest } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { assessmentAttempts, assessmentEvidence, assessmentQuestions, assessments, classes, conceptMastery, concepts, lessonCoverage, questionResponses, questions } from "../../db/schema";
import { AppError, conflict, notFound } from "../../http/errors";
import { getPresentation } from "../lessons/lesson.service";
import { computeRecommendations } from "../interventions/board.service";
import { submitAttempt } from "../learning/persistence/attempt.service";
import { loadBankQuestions } from "../learning/persistence/loaders";
import { revisitDue } from "../brief/revisit.service";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
export interface StudentCtx {
  studentId: string;
  classId: string;
  name: string;
}

/** What a student is told about where they are. Friendly words, never the teacher's diagnostic labels, never a score. */
export const PROGRESS_WORD: Record<string, ProgressWord> = {
  not_enough_evidence: "just_starting",
  needs_foundation: "keep_practising",
  developing: "getting_there",
  likely_secure: "going_well",
  ready_for_challenge: "ready_for_more",
};

export type PracticeMode = "foundation" | "guided" | "challenge" | "revisit";

async function loadClass(db: Db, classId: string) {
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  if (!cls) throw notFound("Class not found.");
  return cls;
}

/** Practice and the next-step view are optional: a teacher turns them on for the class. */
export async function requirePortal(db: Db, classId: string) {
  const cls = await loadClass(db, classId);
  if (!cls.portalEnabled) throw new AppError("forbidden", "Your teacher has not turned on practice for your class yet.");
  return cls;
}

async function openActivityFor(db: Db, s: StudentCtx) {
  const [a] = await db.select().from(assessments).where(and(eq(assessments.classId, s.classId), eq(assessments.status, "open"))).limit(1);
  if (!a) return false;
  const [done] = await db.select({ id: assessmentAttempts.id }).from(assessmentAttempts).where(and(eq(assessmentAttempts.assessmentId, a.id), eq(assessmentAttempts.studentId, s.studentId)));
  return !done;
}

/** The concept a student is currently working on: the one they most recently answered, else the class's latest taught lesson. */
async function focusConcept(db: Db, s: StudentCtx): Promise<string | null> {
  const [latest] = await db
    .select({ conceptId: assessmentEvidence.conceptId })
    .from(assessmentEvidence)
    .where(and(eq(assessmentEvidence.studentId, s.studentId), eq(assessmentEvidence.relationship, "primary")))
    .orderBy(desc(assessmentEvidence.observedAt))
    .limit(1);
  if (latest) return latest.conceptId;
  const [taught] = await db.select({ conceptId: lessonCoverage.conceptId }).from(lessonCoverage).where(eq(lessonCoverage.classId, s.classId)).orderBy(desc(lessonCoverage.taughtAt)).limit(1);
  return taught?.conceptId ?? null;
}

export async function getHome(db: Db, s: StudentCtx): Promise<StudentHomeResponse> {
  const cls = await loadClass(db, s.classId);
  const activityOpen = await openActivityFor(db, s);

  const rows = await db
    .select({ conceptId: concepts.id, title: concepts.title, status: conceptMastery.status })
    .from(conceptMastery)
    .innerJoin(concepts, eq(concepts.id, conceptMastery.conceptId))
    .where(eq(conceptMastery.studentId, s.studentId))
    .orderBy(asc(concepts.conceptOrder));
  const progress = rows.map((r) => ({ conceptId: r.conceptId, title: r.title, word: PROGRESS_WORD[r.status] ?? "just_starting" }));

  if (!cls.portalEnabled) return { studentName: s.name, activityOpen, next: null, progress: [], revisit: [] };

  const due = await revisitDue(db, [s.studentId]);
  const revisit = due.map((d) => ({ conceptId: d.conceptId, title: d.title }));

  const focus = await focusConcept(db, s);
  let next: StudentHomeResponse["next"] = null;
  if (focus) {
    const { recs, titles } = await computeRecommendations(db, s.classId, focus);
    const mine = recs.find((r) => r.studentId === s.studentId);
    if (mine) {
      const rec = mine.rec;
      const title = titles.get(rec.conceptId) ?? "this topic";
      const minutes = rec.activity.suggestedMinutes ?? null;
      switch (rec.activity.type) {
        case "prerequisite_diagnostic":
        case "foundation_activity":
          next = { kind: "practice", conceptId: rec.conceptId, mode: "foundation", title: `Practise: ${title}`, why: "Let us look at an earlier idea first. It will make the next step easier.", minutes };
          break;
        case "guided_practice":
          next = { kind: "practice", conceptId: rec.conceptId, mode: "guided", title: `Practise: ${title}`, why: "You already know some of this. A few questions with hints will help it stick.", minutes };
          break;
        case "challenge_activity":
          next = { kind: "practice", conceptId: rec.conceptId, mode: "challenge", title: `Try something harder: ${title}`, why: "You are ready for a bigger challenge.", minutes };
          break;
        case "follow_up_assessment":
          next = { kind: "practice", conceptId: rec.conceptId, mode: "guided", title: `Show what you know: ${title}`, why: "A few short questions will show how far you have come.", minutes };
          break;
        case "revisit_question":
          next = { kind: "revisit", conceptId: rec.conceptId, mode: "revisit", title: `Quick look again: ${title}`, why: "You learned this a while ago. A quick look keeps it fresh.", minutes };
          break;
        default:
          next = { kind: "wait_for_teacher", conceptId: null, mode: null, title: "Your teacher will help you with the next step", why: "Your teacher wants to look at this with you.", minutes: null };
      }
    }
  }
  if (!next && revisit[0]) next = { kind: "revisit", conceptId: revisit[0].conceptId, mode: "revisit", title: `Quick look again: ${revisit[0].title}`, why: "You learned this a while ago. A quick look keeps it fresh.", minutes: 5 };
  if (!next) next = { kind: "wait_for_teacher", conceptId: null, mode: null, title: "Nothing new yet", why: "Your teacher will tell you when there is something to practise.", minutes: null };

  return { studentName: s.name, activityOpen, next, progress, revisit };
}

// ---------------------------------------------------------------- practice sets

const SET_REUSE_HOURS = 3;
const PER_SET: Record<PracticeMode, number> = { foundation: 3, guided: 3, challenge: 3, revisit: 2 };

/**
 * Picks approved questions for a short practice set and keeps it as the student's own private set, so answers
 * flow through the same evidence pipeline as everything else. Prefers questions the student has not answered
 * before. Reuses an unfinished set instead of piling up new ones.
 */
export async function startPractice(db: Db, s: StudentCtx, conceptId: string, mode: PracticeMode): Promise<PracticeSetResponse> {
  const cls = await requirePortal(db, s.classId);
  if (!isUuid(conceptId)) throw notFound("We could not find that topic.");
  const [concept] = await db.select().from(concepts).where(eq(concepts.id, conceptId));
  if (!concept) throw notFound("We could not find that topic.");

  const title = `Practice: ${concept.title}`;
  const since = new Date(Date.now() - SET_REUSE_HOURS * 3600 * 1000);
  const mine = await db.select().from(assessments).where(and(eq(assessments.ownerStudentId, s.studentId), eq(assessments.type, "practice"), eq(assessments.title, title))).orderBy(desc(assessments.createdAt)).limit(1);
  const existing = mine[0] && mine[0].createdAt > since ? mine[0] : undefined;
  if (existing) {
    const done = await db.select({ id: assessmentAttempts.id }).from(assessmentAttempts).where(and(eq(assessmentAttempts.assessmentId, existing.id), eq(assessmentAttempts.studentId, s.studentId)));
    if (done.length === 0) return toSet(db, existing.id, title, concept.title);
  }

  const pool = await db.select({ id: questions.id, role: questions.role, difficulty: questions.difficulty, key: questions.key }).from(questions).where(and(eq(questions.conceptId, conceptId), eq(questions.reviewStatus, "approved"))).orderBy(asc(questions.difficulty), asc(questions.key));
  const wanted = pool.filter((q) => (mode === "challenge" ? q.role === "challenge" : mode === "guided" ? q.role === "guided" || q.role === "diagnostic" : q.difficulty <= (mode === "foundation" ? 2 : 3)));
  const candidates = wanted.length ? wanted : pool;
  if (candidates.length === 0) throw notFound("There are no practice questions for this topic yet. Ask your teacher.");

  const seen = await answeredQuestionIds(db, s.studentId);
  const fresh = candidates.filter((q) => !seen.has(q.id));
  const chosen = [...fresh, ...candidates.filter((q) => seen.has(q.id))].slice(0, PER_SET[mode]);

  const [set] = await db
    .insert(assessments)
    .values({ classId: s.classId, teacherId: cls.teacherId, title, type: "practice", status: "closed", ownerStudentId: s.studentId })
    .returning();
  await db.insert(assessmentQuestions).values(chosen.map((q, i) => ({ assessmentId: set!.id, questionId: q.id, sequenceOrder: i + 1 })));
  return toSet(db, set!.id, title, concept.title);
}

async function answeredQuestionIds(db: Db, studentId: string): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ questionId: questionResponses.questionId })
    .from(questionResponses)
    .innerJoin(assessmentAttempts, eq(assessmentAttempts.id, questionResponses.attemptId))
    .where(eq(assessmentAttempts.studentId, studentId));
  return new Set(rows.map((r) => r.questionId));
}

async function toSet(db: Db, setId: string, title: string, conceptTitle: string): Promise<PracticeSetResponse> {
  const links = await db.select().from(assessmentQuestions).where(eq(assessmentQuestions.assessmentId, setId)).orderBy(asc(assessmentQuestions.sequenceOrder));
  const bank = await loadBankQuestions(db, links.map((l) => l.questionId));
  return {
    setId,
    title,
    conceptTitle,
    // Only what a student may see: no key, no tags, no explanation.
    questions: links.map((l) => bank.get(l.questionId)!).map((q) => ({ id: q.id, stem: q.stem, options: q.options.map((o) => ({ id: o.id, text: o.text })) })),
  };
}

async function loadOwnSet(db: Db, s: StudentCtx, setId: string) {
  if (!isUuid(setId)) throw notFound("We could not find that practice.");
  const [set] = await db.select().from(assessments).where(and(eq(assessments.id, setId), eq(assessments.ownerStudentId, s.studentId), eq(assessments.classId, s.classId)));
  if (!set) throw notFound("We could not find that practice."); // never reveals another student's set
  return set;
}

// ---------------------------------------------------------------- hints

const GENERIC_HINTS = [
  "Read the question again slowly. What is it really asking you to find?",
  "Try drawing it, or break it into smaller steps. Do the first step only.",
  "Look at the example below, then try your question the same way.",
];

/**
 * The hint ladder: a nudge, then a first step, then a worked example of a *different* problem. All of it comes
 * from teacher-approved teaching content for the concept; there is no AI call. Using hints makes the answer
 * count as weaker evidence (see submitPractice), so asking for help is never punished, only recorded honestly.
 */
export async function getHint(db: Db, s: StudentCtx, setId: string, questionId: string, level: number): Promise<HintResponse> {
  await requirePortal(db, s.classId);
  const set = await loadOwnSet(db, s, setId);
  if (!isUuid(questionId) || !(level >= 1 && level <= 3)) throw new AppError("validation_error", "Choose a hint from 1 to 3.");
  const [link] = await db.select().from(assessmentQuestions).where(and(eq(assessmentQuestions.assessmentId, set.id), eq(assessmentQuestions.questionId, questionId)));
  if (!link) throw notFound("We could not find that question.");
  const [done] = await db.select({ id: assessmentAttempts.id }).from(assessmentAttempts).where(and(eq(assessmentAttempts.assessmentId, set.id), eq(assessmentAttempts.studentId, s.studentId)));
  if (done) throw conflict("You have already finished this practice.");

  const [q] = await db.select({ conceptId: questions.conceptId }).from(questions).where(eq(questions.id, questionId));
  const [concept] = await db.select().from(concepts).where(eq(concepts.id, q!.conceptId));
  const presentation = await getPresentation(db, q!.conceptId).catch(() => undefined);
  const level2 = presentation?.levels.find((l) => l.level === "guided") ?? presentation?.levels[0];
  const example = presentation?.levels.find((l) => l.workedExample)?.workedExample ?? null;

  let text: string;
  if (level === 1) text = concept?.learningObjective ? `Think about this idea: ${concept.learningObjective}` : GENERIC_HINTS[0]!;
  else if (level === 2) text = level2?.steps[0] ? `Here is a first step to try: ${level2.steps[0]}` : GENERIC_HINTS[1]!;
  else text = example ? `A worked example (a different question): ${example.problem}. ${example.steps.join(" ")}` : GENERIC_HINTS[2]!;
  return { level, text, more: level < 3 };
}

// ---------------------------------------------------------------- submit

export async function submitPractice(db: Db, s: StudentCtx, setId: string, req: SubmitPracticeRequest, requestId?: string): Promise<PracticeResultResponse> {
  await requirePortal(db, s.classId);
  const set = await loadOwnSet(db, s, setId);
  const links = await db.select().from(assessmentQuestions).where(eq(assessmentQuestions.assessmentId, set.id));
  const allowed = new Set(links.map((l) => l.questionId));
  const seen = new Set<string>();
  for (const a of req.answers) {
    if (!allowed.has(a.questionId)) throw new AppError("validation_error", "One of the answers is for a question that is not in this practice.");
    if (seen.has(a.questionId)) throw new AppError("validation_error", "A question was answered twice.");
    seen.add(a.questionId);
  }

  const result = await submitAttempt(db, {
    assessmentId: set.id,
    studentId: s.studentId,
    source: "practice_activity",
    idempotencyKey: `practice:${set.id}`,
    responses: req.answers.map((a) => ({
      questionId: a.questionId,
      response: a.optionId === null ? { kind: "blank" as const } : { kind: "option" as const, optionId: a.optionId },
      // Hints make an answer weaker evidence: one hint reads as "unsure", more as "guess". A guess is not counted toward a misconception.
      ...(a.hintLevel === 1 ? { selfConfidence: "unsure" as const } : a.hintLevel >= 2 ? { selfConfidence: "guess" as const } : {}),
    })),
    ...(requestId ? { requestId } : {}),
  });
  if (result.duplicate) throw conflict("You have already finished this practice.");

  const bank = await loadBankQuestions(db, req.answers.map((a) => a.questionId));
  const expl = await db.select({ id: questions.id, explanation: questions.explanation }).from(questions).where(inArray(questions.id, req.answers.map((a) => a.questionId)));
  const explainBy = new Map(expl.map((e) => [e.id, e.explanation]));
  const results = result.responses.map((r) => ({
    questionId: r.questionId,
    correct: r.result === "correct" ? true : r.result === "incorrect" ? false : null,
    correctOptionId: bank.get(r.questionId)!.correctOptionId,
    explanation: explainBy.get(r.questionId) ?? null,
  }));
  const right = results.filter((r) => r.correct === true).length;
  const message = right === results.length ? "Well done. You got them all." : right > 0 ? "Good work. Have a look at the ones to try again." : "Thanks for trying. Look at each explanation, and you can practise again soon.";
  return { results, message };
}
