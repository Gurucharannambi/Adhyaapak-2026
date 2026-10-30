import { and, asc, count, desc, eq } from "drizzle-orm";
import {
  CONFIDENCE_OPTIONS,
  CONFIDENCE_PROMPT,
  TRUE_FALSE_OPTIONS,
  type CreatePollRequest,
  type CurrentPollResponse,
  type PollDto,
  type PollVoteRequest,
  type StudentPollDto,
} from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { assessments, classEnrolments, classPolls, concepts, pollVotes } from "../../db/schema";
import { AppError, conflict, notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";
import { recordAudit } from "../audit/audit.service";
import { loadAccessibleClass } from "../classes/class.access";
import { publish } from "../live/hub";
import { groupAnswers } from "./short-answer";

type PollRow = typeof classPolls.$inferSelect;
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const letter = (i: number) => String.fromCharCode(97 + i);

/** The wording a poll is stored with. Fixed polls cannot be reworded, so every class sees the same calm choices. */
export function pollContent(input: CreatePollRequest): { prompt: string; options: Array<{ id: string; text: string }> } {
  const texts = input.kind === "confidence" ? [...CONFIDENCE_OPTIONS] : input.kind === "true_false" ? [...TRUE_FALSE_OPTIONS] : input.kind === "short_answer" ? [] : (input.options ?? []);
  return { prompt: input.kind === "confidence" ? CONFIDENCE_PROMPT : (input.prompt ?? "").trim(), options: texts.map((text, i) => ({ id: letter(i), text })) };
}

async function classSize(db: Db, classId: string): Promise<number> {
  const [r] = await db.select({ n: count() }).from(classEnrolments).where(and(eq(classEnrolments.classId, classId), eq(classEnrolments.status, "active")));
  return r?.n ?? 0;
}

/** Counts only. The queries never select a student id, so who chose what cannot leak through this function. */
async function toDto(db: Db, row: PollRow): Promise<PollDto> {
  let options: PollDto["options"] = [];
  let answers: PollDto["answers"] = [];
  let answered = 0;
  if (row.kind === "short_answer") {
    const typed = await db.select({ text: pollVotes.answerText }).from(pollVotes).where(eq(pollVotes.pollId, row.id)).orderBy(asc(pollVotes.createdAt));
    answers = groupAnswers(typed.map((t) => t.text ?? ""), row.expectedAnswer);
    answered = typed.length;
  } else {
    const tally = await db.select({ optionId: pollVotes.optionId, n: count() }).from(pollVotes).where(eq(pollVotes.pollId, row.id)).groupBy(pollVotes.optionId);
    const byOption = new Map(tally.map((t) => [t.optionId, t.n]));
    options = row.options.map((o) => ({ id: o.id, text: o.text, count: byOption.get(o.id) ?? 0 }));
    answered = options.reduce((n, o) => n + o.count, 0);
  }
  return {
    id: row.id,
    kind: row.kind,
    prompt: row.prompt,
    status: row.status,
    options,
    answers,
    expectedAnswer: row.expectedAnswer,
    answered,
    classSize: await classSize(db, row.classId),
    createdAt: row.createdAt.toISOString(),
    closedAt: row.closedAt?.toISOString() ?? null,
  };
}

async function openPoll(db: Db, classId: string): Promise<PollRow | undefined> {
  const [row] = await db.select().from(classPolls).where(and(eq(classPolls.classId, classId), eq(classPolls.status, "open")));
  return row;
}

export const hasOpenPoll = async (db: Db, classId: string): Promise<boolean> => Boolean(await openPoll(db, classId));

/** Closes any open poll for the class. Used when a check starts: students answer one thing at a time. */
export async function closeOpenPoll(db: Db, classId: string): Promise<void> {
  const open = await openPoll(db, classId);
  if (!open) return;
  await db.update(classPolls).set({ status: "closed", closedAt: new Date() }).where(eq(classPolls.id, open.id));
  publish(classId, { kind: "poll_closed" });
}

export async function startPoll(db: Db, actor: Actor, classId: string, conceptId: string | null, input: CreatePollRequest, requestId: string): Promise<PollDto> {
  const cls = await loadAccessibleClass(db, actor, classId);
  if (conceptId) {
    if (!isUuid(conceptId)) throw notFound("Lesson not found.");
    const [c] = await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.id, conceptId));
    if (!c) throw notFound("Lesson not found.");
  }
  // Students answer one thing at a time: a poll cannot start while a check is open, nor while another poll is open.
  const [openCheck] = await db.select({ id: assessments.id }).from(assessments).where(and(eq(assessments.classId, cls.id), eq(assessments.status, "open")));
  if (openCheck) throw conflict("A check is open. Close it before asking a poll.");
  if (await openPoll(db, cls.id)) throw conflict("A poll is already open. Close it first.");

  const { prompt, options } = pollContent(input);
  if (!prompt || (input.kind !== "short_answer" && options.length < 2)) throw new AppError("validation_error", "A poll needs a question and at least two choices.");
  const [row] = await db.insert(classPolls).values({ classId: cls.id, conceptId, teacherId: actor.id, kind: input.kind, prompt, options, expectedAnswer: input.kind === "short_answer" ? (input.expectedAnswer ?? null) : null }).returning();
  await recordAudit(db, { actorId: actor.id, action: "poll.start", entityType: "class_poll", entityId: row!.id, metadata: { classId: cls.id, conceptId, kind: input.kind }, requestId });
  publish(cls.id, { kind: "poll_opened" });
  return toDto(db, row!);
}

export async function getCurrentPoll(db: Db, actor: Actor, classId: string, conceptId: string | null): Promise<CurrentPollResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const open = await openPoll(db, cls.id);
  if (open) return { poll: await toDto(db, open) };
  // Nothing open: show the latest closed poll for this lesson so the teacher can still read what the class said.
  const where = conceptId && isUuid(conceptId) ? and(eq(classPolls.classId, cls.id), eq(classPolls.conceptId, conceptId)) : eq(classPolls.classId, cls.id);
  const [last] = await db.select().from(classPolls).where(where).orderBy(desc(classPolls.createdAt)).limit(1);
  return { poll: last ? await toDto(db, last) : null };
}

export async function closePoll(db: Db, actor: Actor, pollId: string, requestId: string): Promise<PollDto> {
  if (!isUuid(pollId)) throw notFound("Poll not found.");
  const [row] = await db.select().from(classPolls).where(eq(classPolls.id, pollId));
  if (!row) throw notFound("Poll not found.");
  await loadAccessibleClass(db, actor, row.classId); // another teacher's poll is a 404, like a missing one
  if (row.status === "closed") return toDto(db, row); // closing twice is harmless
  const [closed] = await db.update(classPolls).set({ status: "closed", closedAt: new Date() }).where(eq(classPolls.id, row.id)).returning();
  await recordAudit(db, { actorId: actor.id, action: "poll.close", entityType: "class_poll", entityId: row.id, metadata: { classId: row.classId }, requestId });
  publish(row.classId, { kind: "poll_closed" });
  return toDto(db, closed!);
}

/** What a student sees: the question and choices, and whether they have answered. Never the counts. */
export async function getStudentPoll(db: Db, classId: string, studentId: string): Promise<StudentPollDto | null> {
  const open = await openPoll(db, classId);
  if (!open) return null;
  const [mine] = await db.select({ id: pollVotes.id }).from(pollVotes).where(and(eq(pollVotes.pollId, open.id), eq(pollVotes.studentId, studentId)));
  // Never the expected answer: a student sees the question only.
  return { id: open.id, answerType: open.kind === "short_answer" ? "text" : "option", prompt: open.prompt, options: open.options, answered: Boolean(mine) };
}

/** A student's answer. The first answer stands and a retry is harmless; a closed poll refuses. */
export async function votePoll(db: Db, classId: string, studentId: string, vote: PollVoteRequest): Promise<void> {
  const open = await openPoll(db, classId);
  if (!open) throw conflict("This poll is closed.");
  const typed = open.kind === "short_answer";
  if (typed !== "text" in vote) throw new AppError("validation_error", typed ? "This question needs a typed answer." : "Pick one of the choices.");
  if ("optionId" in vote && !open.options.some((o) => o.id === vote.optionId)) throw new AppError("validation_error", "That choice is not part of this poll.");
  const values = "text" in vote ? { pollId: open.id, studentId, answerText: vote.text.replace(/\s+/g, " ") } : { pollId: open.id, studentId, optionId: vote.optionId };
  const inserted = await db.insert(pollVotes).values(values).onConflictDoNothing().returning({ id: pollVotes.id });
  if (inserted.length > 0) publish(classId, { kind: "poll_vote" });
}
