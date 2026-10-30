import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { and, eq } from "drizzle-orm";
import { JoinRequest, PollVoteRequest, StudentAnswersRequest, type StudentActivityResponse } from "@adhyaapak/shared";
import type { AppConfig } from "../../config";
import type { Db } from "../../db/client";
import { assessmentAttempts, assessmentQuestions, assessments, classes } from "../../db/schema";
import { AppError, conflict } from "../../http/errors";
import { parseOrThrow } from "../../http/validate";
import { recordAudit } from "../audit/audit.service";
import type { StudentResponse } from "../learning/assessment/types";
import { loadBankQuestions } from "../learning/persistence/loaders";
import { submitAttempt } from "../learning/persistence/attempt.service";
import { STUDENT_COOKIE, createStudentSession, deleteStudentSession, findJoinTarget, requireStudent, studentCookieOptions } from "./student-session";
import { getStudentResults } from "./student-results";
import { openStream, publish, type LiveKind } from "../live/hub";
import { getStudentPoll, hasOpenPoll, votePoll } from "../polls/poll.service";
import { isCheckPaused } from "../lessons/run.service";

/** What a student's screen may be told about: the check opening or closing and results being released. Never a classmate's answers. */
const STUDENT_KINDS: ReadonlySet<LiveKind> = new Set(["opened", "closed", "released", "poll_opened", "poll_closed", "paused", "resumed"]);

/** The class's single open activity, if any. */
async function openActivity(db: Db, classId: string) {
  const [a] = await db.select().from(assessments).where(and(eq(assessments.classId, classId), eq(assessments.status, "open"))).limit(1);
  return a;
}

export function studentRoutes(db: Db, config: AppConfig): Router {
  const router = Router();
  const cookie = studentCookieOptions(config.SESSION_COOKIE_SECURE);

  // A 6-character code plus a small roster number is guessable, so joins are rate limited.
  const joinLimiter: RequestHandler = config.RATE_LIMIT_ENABLED
    ? rateLimit({
        windowMs: 10 * 60 * 1000,
        limit: 40,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        handler: (_req, _res, next) => next(new AppError("rate_limited", "Too many tries. Wait a few minutes and ask your teacher.")),
      })
    : (_req, _res, next) => next();

  router.post("/join", joinLimiter, async (req, res) => {
    const input = parseOrThrow(JoinRequest, req.body);
    const target = await findJoinTarget(db, input.joinCode, input.rosterNumber);
    // One message for "no such code" and "no such number" so the code cannot be probed.
    if (!target) throw new AppError("not_found", "We could not find that class code and number. Check them and try again.");
    // Students may join while an activity is open, or any time once the teacher has turned on practice for the class.
    const [cls] = await db.select({ portalEnabled: classes.portalEnabled }).from(classes).where(eq(classes.id, target.classId));
    if (!cls?.portalEnabled && !(await openActivity(db, target.classId)) && !(await hasOpenPoll(db, target.classId))) throw conflict("Nothing is open right now. Ask your teacher to start the activity.");

    const token = await createStudentSession(db, target.studentId, target.classId);
    await recordAudit(db, { action: "student.join", entityType: "student", entityId: target.studentId, metadata: { classId: target.classId }, requestId: String(req.id) });
    res.cookie(STUDENT_COOKIE, token, cookie);
    publish(target.classId, { kind: "joined" });
    res.json({ studentName: target.name });
  });

  // Live signals for the student's screen: the page re-reads /student/activity when one arrives.
  router.get("/student/live", requireStudent, (req, res) => {
    openStream(req, res, req.student!.classId, STUDENT_KINDS);
  });

  router.post("/student/leave", async (req, res) => {
    if (req.student) await deleteStudentSession(db, req.student.sessionId);
    res.clearCookie(STUDENT_COOKIE, { ...cookie, maxAge: undefined });
    res.status(204).end();
  });

  router.get("/student/activity", requireStudent, async (req, res) => {
    const s = req.student!;
    const a = await openActivity(db, s.classId);
    if (!a) {
      // A quick poll comes first: it is open only while the teacher is asking it.
      const poll = await getStudentPoll(db, s.classId, s.studentId);
      if (poll) return void res.json({ studentName: s.name, state: "poll", poll } satisfies StudentActivityResponse);
      // Nothing open: show this student's own results if the teacher has released them.
      const results = await getStudentResults(db, s.studentId, s.classId);
      const body: StudentActivityResponse = results ? { studentName: s.name, state: "results", results } : { studentName: s.name, state: "no_activity" };
      return void res.json(body);
    }
    const [done] = await db.select({ id: assessmentAttempts.id }).from(assessmentAttempts).where(and(eq(assessmentAttempts.assessmentId, a.id), eq(assessmentAttempts.studentId, s.studentId)));
    if (done) {
      const submitted: StudentActivityResponse = { studentName: s.name, state: "submitted" };
      return void res.json(submitted);
    }
    // Paused: say so, without the questions, so nothing new is answered until the teacher resumes.
    if (await isCheckPaused(db, a.id)) return void res.json({ studentName: s.name, state: "paused" } satisfies StudentActivityResponse);
    const links = await db.select().from(assessmentQuestions).where(eq(assessmentQuestions.assessmentId, a.id));
    const bank = await loadBankQuestions(db, links.map((l) => l.questionId));
    // Only what a student may see: no answer key, no misconception tags, no explanation.
    const body: StudentActivityResponse = {
      studentName: s.name,
      state: "ready",
      assessment: {
        id: a.id,
        title: a.title,
        questions: links
          .sort((x, y) => x.sequenceOrder - y.sequenceOrder)
          .map((l) => bank.get(l.questionId)!)
          .map((q) => ({ id: q.id, stem: q.stem, options: q.options.map((o) => ({ id: o.id, text: o.text })) })),
      },
    };
    res.json(body);
  });

  router.post("/student/poll/vote", requireStudent, async (req, res) => {
    const s = req.student!;
    const input = parseOrThrow(PollVoteRequest, req.body);
    await votePoll(db, s.classId, s.studentId, input);
    res.json({ ok: true });
  });

  router.post("/student/activity/answers", requireStudent, async (req, res) => {
    const s = req.student!;
    const input = parseOrThrow(StudentAnswersRequest, req.body);
    const a = await openActivity(db, s.classId);
    if (!a) throw conflict("This activity is closed.");
    if (await isCheckPaused(db, a.id)) {
      // A retry of answers already saved is still fine (it changes nothing); new answers wait for the teacher.
      const [already] = await db.select({ id: assessmentAttempts.id }).from(assessmentAttempts).where(and(eq(assessmentAttempts.assessmentId, a.id), eq(assessmentAttempts.studentId, s.studentId)));
      if (!already) throw conflict("Your teacher has paused this check. Keep your answers; you can send them when it starts again.");
    }

    const links = await db.select().from(assessmentQuestions).where(eq(assessmentQuestions.assessmentId, a.id));
    const inActivity = new Set(links.map((l) => l.questionId));
    if (input.answers.some((x) => !inActivity.has(x.questionId))) throw new AppError("validation_error", "An answer is for a question that is not in this activity.");
    const answered = new Map(input.answers.map((x) => [x.questionId, x]));
    // Any question left unanswered is recorded as blank, which is "no evidence", not "wrong".
    const responses = links
      .sort((x, y) => x.sequenceOrder - y.sequenceOrder)
      .map((l) => {
        const given = answered.get(l.questionId);
        const response: StudentResponse = given ? { kind: "option", optionId: given.optionId } : { kind: "blank" };
        return { questionId: l.questionId, response, ...(given?.confidence ? { selfConfidence: given.confidence } : {}) };
      });

    const result = await submitAttempt(db, {
      assessmentId: a.id,
      studentId: s.studentId,
      source: "device_response",
      idempotencyKey: `student:${input.idempotencyKey}`,
      responses,
      requestId: String(req.id),
    });
    // Students are not told right or wrong here; results stay with the teacher until released.
    if (!result.duplicate) publish(s.classId, { kind: "answers", assessmentId: a.id });
    res.status(result.duplicate ? 200 : 201).json({ state: "submitted" });
  });

  return router;
}
