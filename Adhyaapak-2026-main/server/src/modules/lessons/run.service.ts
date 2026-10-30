import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { LessonRunDto, RunRecap, RunState, RunSummary, StartCheckRequest, StartCheckResponse, WrapRequest, WrapResponse, AssessmentDetailDto } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { assessments, concepts, lessonCoverage, lessonRuns, questions } from "../../db/schema";
import { AppError, conflict, notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";
import { recordAudit } from "../audit/audit.service";
import { loadAccessibleClass } from "../classes/class.access";
import { changeAssessmentStatus, getAssessmentDetail, suggestQuestions } from "../classroom/assessment.service";
import { getLearningMap } from "../classroom/map.service";
import { getConceptDetail } from "../curriculum/curriculum.service";
import { assignInterventions } from "../interventions/intervention.service";
import { createAssessment } from "../learning/assessment/assessment.repo";
import { getBranchBoard } from "../interventions/board.service";
import { isoDate } from "../timetable/pacing";
import { closeOpenPoll } from "../polls/poll.service";
import { publish } from "../live/hub";
import { setTaught } from "./lesson.service";
import { recommendFromCheck } from "./run-recommendation";
import { transition, type RunEvent } from "./run-machine";

type RunRow = typeof lessonRuns.$inferSelect;
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

const NOT_STARTED = (date: string): LessonRunDto => ({ state: "not_started", runDate: date, assessmentId: null, startedAt: null, wrappedAt: null });

async function loadConcept(db: Db, conceptId: string) {
  if (!isUuid(conceptId)) throw notFound("Lesson not found.");
  const [c] = await db.select().from(concepts).where(eq(concepts.id, conceptId));
  if (!c) throw notFound("Lesson not found.");
  return c;
}

async function findRun(db: Db, classId: string, conceptId: string, date: string): Promise<RunRow | undefined> {
  const [row] = await db.select().from(lessonRuns).where(and(eq(lessonRuns.classId, classId), eq(lessonRuns.conceptId, conceptId), eq(lessonRuns.runDate, date)));
  return row;
}

/** not_started → teaching → checking ⇄ paused → needs_wrap → done, from the run row and the status of its check. */
export function deriveState(row: Pick<RunRow, "assessmentId" | "wrappedAt"> & Partial<Pick<RunRow, "pausedAt">>, checkStatus: "draft" | "approved" | "open" | "closed" | null): RunState {
  if (row.wrappedAt) return "done";
  if (!row.assessmentId) return "teaching";
  if (checkStatus === "closed") return "needs_wrap";
  return row.pausedAt ? "paused" : "checking";
}

/** True while the teacher has paused the running check this assessment belongs to. Device answers wait until resumed. */
export async function isCheckPaused(db: Db, assessmentId: string): Promise<boolean> {
  const [row] = await db.select({ id: lessonRuns.id }).from(lessonRuns).where(and(eq(lessonRuns.assessmentId, assessmentId), isNotNull(lessonRuns.pausedAt)));
  return Boolean(row);
}

async function toDto(db: Db, row: RunRow | undefined, date: string): Promise<LessonRunDto> {
  if (!row) return NOT_STARTED(date);
  let status: "draft" | "approved" | "open" | "closed" | null = null;
  if (row.assessmentId) {
    const [a] = await db.select({ status: assessments.status }).from(assessments).where(eq(assessments.id, row.assessmentId));
    status = a?.status ?? null;
  }
  return { state: deriveState(row, status), runDate: row.runDate, assessmentId: row.assessmentId, startedAt: row.startedAt.toISOString(), wrappedAt: row.wrappedAt?.toISOString() ?? null };
}

/** Refuses a move the session state machine does not allow, with the machine's own reason. */
function guard(dto: LessonRunDto, event: RunEvent): void {
  const m = transition(dto.state, event);
  if (!m.ok) throw conflict(m.message);
}

/** The state of every lesson run today (or on `date`) for some classes, keyed `classId:conceptId`. Used by the Today page. */
export async function runStates(db: Db, classIds: string[], date: string): Promise<Map<string, RunState>> {
  const out = new Map<string, RunState>();
  if (classIds.length === 0) return out;
  const rows = await db
    .select({ run: lessonRuns, status: assessments.status })
    .from(lessonRuns)
    .leftJoin(assessments, eq(assessments.id, lessonRuns.assessmentId))
    .where(and(inArray(lessonRuns.classId, classIds), eq(lessonRuns.runDate, date)));
  for (const r of rows) out.set(`${r.run.classId}:${r.run.conceptId}`, deriveState(r.run, r.status));
  return out;
}

export async function getRun(db: Db, actor: Actor, classId: string, conceptId: string, today = isoDate(new Date())): Promise<LessonRunDto> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const concept = await loadConcept(db, conceptId);
  return toDto(db, await findRun(db, cls.id, concept.id, today), today);
}

/** Starts today's teaching of a lesson. Safe to call again: the same run comes back. */
export async function startRun(db: Db, actor: Actor, classId: string, conceptId: string, requestId?: string, today = isoDate(new Date())): Promise<LessonRunDto> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const concept = await loadConcept(db, conceptId);
  const existing = await findRun(db, cls.id, concept.id, today);
  if (existing) return toDto(db, existing, today);
  await db.insert(lessonRuns).values({ classId: cls.id, conceptId: concept.id, runDate: today }).onConflictDoNothing();
  await recordAudit(db, { actorId: actor.id, action: "lesson.start", entityType: "concept", entityId: concept.id, metadata: { classId: cls.id }, requestId });
  return toDto(db, await findRun(db, cls.id, concept.id, today), today);
}

/**
 * One tap from "teach" to "check": picks three questions from the approved bank (or uses the teacher's swap), then
 * creates, approves and opens the check. The usual approval steps are skipped only because bank questions are already
 * teacher-approved; AI drafts still go through the full review before they can be here.
 */
export async function startCheck(db: Db, actor: Actor, classId: string, conceptId: string, req: StartCheckRequest, requestId?: string, today = isoDate(new Date())): Promise<StartCheckResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const concept = await loadConcept(db, conceptId);
  await startRun(db, actor, cls.id, concept.id, requestId, today);
  const run = (await findRun(db, cls.id, concept.id, today))!;
  guard(await toDto(db, run, today), "start_check");

  // Already started today: return the same check rather than making another.
  if (run.assessmentId) {
    const detail = await getAssessmentDetail(db, actor, run.assessmentId);
    return { run: await toDto(db, run, today), assessmentId: run.assessmentId, questions: detail.questions };
  }

  // The database allows one open check per class; say which one is in the way instead of failing later.
  const [open] = await db.select({ id: assessments.id, title: assessments.title }).from(assessments).where(and(eq(assessments.classId, cls.id), eq(assessments.status, "open")));
  if (open) throw conflict(`Another activity, "${open.title}", is open for this class. Finish it before starting a new check.`);

  let questionIds: string[];
  if (req.questionIds) {
    const rows = await db.select({ id: questions.id }).from(questions).where(and(inArray(questions.id, req.questionIds), eq(questions.conceptId, concept.id)));
    if (rows.length !== new Set(req.questionIds).size) throw new AppError("validation_error", "Choose questions from this lesson's own bank.");
    questionIds = req.questionIds;
  } else {
    const suggested = await suggestQuestions(db, actor, cls.id, { mode: "diagnostic", conceptIds: [concept.id], count: 3 });
    questionIds = suggested.map((q) => q.id);
  }
  if (questionIds.length === 0) throw new AppError("validation_error", "This lesson has no approved check questions yet.");

  const a = await createAssessment(db, { classId: cls.id, teacherId: actor.id, title: `Check: ${concept.title}`, type: "diagnostic", questionIds });
  await recordAudit(db, { actorId: actor.id, action: "assessment.create", entityType: "assessment", entityId: a.id, metadata: { classId: cls.id, type: "diagnostic", via: "lesson_run" }, requestId });
  await changeAssessmentStatus(db, actor, a.id, "approved", requestId);
  await closeOpenPoll(db, cls.id); // students answer one thing at a time
  await changeAssessmentStatus(db, actor, a.id, "open", requestId);
  await db.update(lessonRuns).set({ assessmentId: a.id }).where(eq(lessonRuns.id, run.id));

  const detail = await getAssessmentDetail(db, actor, a.id);
  return { run: await toDto(db, await findRun(db, cls.id, concept.id, today), today), assessmentId: a.id, questions: detail.questions };
}

/** Closes the check so its answers count. Safe to repeat. */
export async function finishCheck(db: Db, actor: Actor, classId: string, conceptId: string, requestId?: string, today = isoDate(new Date())): Promise<LessonRunDto> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const concept = await loadConcept(db, conceptId);
  const run = await findRun(db, cls.id, concept.id, today);
  guard(await toDto(db, run, today), "finish_check");
  if (!run?.assessmentId) throw conflict("No check has been started for this lesson today.");
  const [a] = await db.select({ status: assessments.status }).from(assessments).where(eq(assessments.id, run.assessmentId));
  if (a?.status === "open") await changeAssessmentStatus(db, actor, run.assessmentId, "closed", requestId);
  if (run.pausedAt) await db.update(lessonRuns).set({ pausedAt: null }).where(eq(lessonRuns.id, run.id));
  return toDto(db, await findRun(db, cls.id, concept.id, today), today);
}

/**
 * Pauses or resumes the running check. Pausing twice (or resuming a running check) changes nothing. Students are told
 * at once; what they have chosen but not sent stays on their screen.
 */
export async function setPaused(db: Db, actor: Actor, classId: string, conceptId: string, paused: boolean, requestId?: string, today = isoDate(new Date())): Promise<LessonRunDto> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const concept = await loadConcept(db, conceptId);
  const run = await findRun(db, cls.id, concept.id, today);
  const dto = await toDto(db, run, today);
  const m = transition(dto.state, paused ? "pause" : "resume");
  if (!m.ok) throw conflict(paused ? "There is no running check to pause." : "There is no paused check to resume.");
  if (m.noop) return dto;
  await db.update(lessonRuns).set({ pausedAt: paused ? new Date() : null }).where(eq(lessonRuns.id, run!.id));
  await recordAudit(db, { actorId: actor.id, action: paused ? "lesson_run.pause" : "lesson_run.resume", entityType: "assessment", entityId: run!.assessmentId!, metadata: { classId: cls.id, conceptId: concept.id }, requestId });
  publish(cls.id, { kind: paused ? "paused" : "resumed", assessmentId: run!.assessmentId! });
  return toDto(db, await findRun(db, cls.id, concept.id, today), today);
}

/** The patterns a check actually showed: answer options tagged with an error pattern that students chose. */
export function patternsFromCheck(detail: Pick<AssessmentDetailDto, "tallies">): Array<{ name: string; studentCount: number }> {
  const by = new Map<string, number>();
  for (const t of detail.tallies) for (const o of t.options) if (o.misconception && o.count > 0) by.set(o.misconception, (by.get(o.misconception) ?? 0) + o.count);
  return [...by.entries()].map(([name, studentCount]) => ({ name, studentCount })).sort((a, b) => b.studentCount - a.studentCount);
}

export async function getRecap(db: Db, actor: Actor, classId: string, conceptId: string, today = isoDate(new Date())): Promise<RunRecap> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const concept = await loadConcept(db, conceptId);
  const detail = await getConceptDetail(db, concept.id);

  const prereqIds = detail.prerequisites.map((p) => p.id);
  const map = await getLearningMap(db, actor, cls.id, prereqIds.length ? { conceptIds: prereqIds } : { conceptIds: [concept.id] });
  const prerequisites = prereqIds.length
    ? detail.prerequisites.map((p) => {
        const col = map.concepts.find((c) => c.id === p.id);
        const counts = col?.counts;
        const total = counts ? Object.values(counts).reduce((s, n) => s + n, 0) : 0;
        const assessed = counts ? total - counts.not_enough_evidence : 0;
        return { conceptId: p.id, title: p.title, assessed, notSecure: counts ? counts.needs_foundation + counts.developing : 0 };
      })
    : [];

  // The last lesson this class had wrapped up (not today's), with what its check showed.
  const [last] = await db
    .select({ run: lessonRuns, title: concepts.title })
    .from(lessonRuns)
    .innerJoin(concepts, eq(concepts.id, lessonRuns.conceptId))
    .where(and(eq(lessonRuns.classId, cls.id), isNotNull(lessonRuns.wrappedAt)))
    .orderBy(desc(lessonRuns.wrappedAt))
    .limit(1);
  let previous: RunRecap["previous"] = null;
  if (last && last.run.runDate !== today) {
    const patterns = last.run.assessmentId ? patternsFromCheck(await getAssessmentDetail(db, actor, last.run.assessmentId)) : [];
    previous = { lessonTitle: last.title, date: last.run.runDate, patterns };
  }
  return { studentCount: map.students.length, previous, prerequisites };
}

export async function getRunSummary(db: Db, actor: Actor, classId: string, conceptId: string, today = isoDate(new Date())): Promise<RunSummary> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const concept = await loadConcept(db, conceptId);
  const run = await findRun(db, cls.id, concept.id, today);
  const dto = await toDto(db, run, today);
  const [taught] = await db.select().from(lessonCoverage).where(and(eq(lessonCoverage.classId, cls.id), eq(lessonCoverage.conceptId, concept.id)));

  const empty = { run: dto, conceptId: concept.id, conceptTitle: concept.title, checkTitle: null, answered: 0, studentCount: 0, questions: [], patterns: [], recommendation: null, groups: [], taught: !!taught, resultsReleased: false };
  if (!run?.assessmentId) return empty;

  const detail = await getAssessmentDetail(db, actor, run.assessmentId);
  const answered = detail.students.filter((s) => s.submitted).length;
  const qSummaries = detail.questions.map((q) => {
    const t = detail.tallies.find((x) => x.questionId === q.id)!;
    return {
      questionId: q.id,
      stem: q.stem,
      answered: t.answered,
      noEvidence: t.insufficient,
      options: q.options.map((o) => {
        const to = t.options.find((x) => x.optionId === o.id);
        return { optionId: o.id, text: o.text, count: to?.count ?? 0, correct: o.id === q.correctOptionId, pattern: to?.misconception ?? null };
      }),
    };
  });

  const recommendation = recommendFromCheck({
    answered,
    studentCount: detail.students.length,
    questions: qSummaries.map((q) => ({ answered: q.answered, correct: q.options.find((o) => o.correct)?.count ?? 0, options: q.options.map((o) => ({ count: o.count, pattern: o.pattern })) })),
  });

  const board = await getBranchBoard(db, actor, cls.id, concept.id);
  const groups = (["foundation", "guided", "challenge", "follow_up"] as const).map((key) => ({
    key,
    students: board.lanes[key].map((c) => ({ studentId: c.studentId, rosterNumber: c.rosterNumber, name: c.name, assigned: !!c.assigned, reason: c.reason, prerequisiteTitles: c.prerequisiteTitles })),
  }));

  return { ...empty, checkTitle: detail.title, answered, studentCount: detail.students.length, questions: qSummaries, patterns: patternsFromCheck(detail), recommendation, groups, resultsReleased: detail.resultsReleased };
}

/**
 * Finishes the period: optionally records the lesson as taught and turns the suggested groups into next-period
 * assignments. Nothing here is automatic: the teacher ticks what they want. A check left open must be finished first.
 */
export async function wrapRun(db: Db, actor: Actor, classId: string, conceptId: string, req: WrapRequest, requestId?: string, today = isoDate(new Date())): Promise<WrapResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const concept = await loadConcept(db, conceptId);
  await startRun(db, actor, cls.id, concept.id, requestId, today);
  const run = (await findRun(db, cls.id, concept.id, today))!;

  guard(await toDto(db, run, today), "wrap");
  if (run.wrappedAt) return { run: await toDto(db, run, today), assigned: 0 };

  if (req.markTaught) await setTaught(db, actor, cls.id, concept.id, true, requestId);

  let assigned = 0;
  if (req.assignGroups && run.assessmentId) {
    const board = await getBranchBoard(db, actor, cls.id, concept.id);
    const cards = (["foundation", "guided", "challenge", "follow_up"] as const).flatMap((key) => board.lanes[key].filter((c) => !c.assigned).map((c) => ({ studentId: c.studentId, groupKey: key })));
    if (cards.length > 0) assigned = (await assignInterventions(db, actor, cls.id, { conceptId: concept.id, assignments: cards }, requestId)).assigned.length;
  }

  await db.update(lessonRuns).set({ wrappedAt: new Date() }).where(eq(lessonRuns.id, run.id));
  await recordAudit(db, { actorId: actor.id, action: "lesson.wrap", entityType: "concept", entityId: concept.id, metadata: { classId: cls.id, markTaught: req.markTaught, assigned }, requestId });
  return { run: await toDto(db, await findRun(db, cls.id, concept.id, today), today), assigned };
}
