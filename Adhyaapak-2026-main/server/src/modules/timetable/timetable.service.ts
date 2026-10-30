import { and, asc, eq, gte, lt } from "drizzle-orm";
import type { SaveTimetableRequest, SchedulePeriod, TimetableResponse, TimetableSlotDto } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { chapters, classes, concepts, curriculumVersions, lessonCoverage, lessonRuns, subjects, timetableSlots } from "../../db/schema";
import { AppError } from "../../http/errors";
import { recordAudit } from "../audit/audit.service";
import type { Actor } from "../auth/permissions";
import { loadAccessibleClass, type ClassRow } from "../classes/class.access";
import { runStates } from "../lessons/run.service";
import { MATHS, addDays, isoDate, planPeriods, sampleWeek, weekdayOf, type BookLesson } from "./pacing";

const UPCOMING_DAYS = 14;

/** Gives a class the sample week the first time it needs one. A teacher can edit it afterwards. */
export async function ensureTimetable(db: Db, classId: string): Promise<TimetableSlotDto[]> {
  const rows = await db.select().from(timetableSlots).where(eq(timetableSlots.classId, classId));
  if (rows.length > 0) return rows.map(toSlot);
  const week = sampleWeek();
  await db
    .insert(timetableSlots)
    .values(week.map((s) => ({ ...s, classId })))
    .onConflictDoNothing();
  return week;
}

const toSlot = (r: typeof timetableSlots.$inferSelect): TimetableSlotDto => ({ weekday: r.weekday, period: r.period, startsAt: r.startsAt, endsAt: r.endsAt, subject: r.subject });

/** The textbook for a class: the approved Mathematics curriculum for its grade, with every approved lesson in book order. */
async function loadBook(db: Db, cls: ClassRow): Promise<{ title: string | null; lessons: BookLesson[] }> {
  const [cv] = await db
    .select({ id: curriculumVersions.id, title: curriculumVersions.title })
    .from(curriculumVersions)
    .innerJoin(subjects, eq(subjects.id, curriculumVersions.subjectId))
    .where(and(eq(curriculumVersions.grade, cls.grade), eq(subjects.name, MATHS), eq(curriculumVersions.reviewStatus, "approved")))
    .orderBy(asc(curriculumVersions.version))
    .limit(1);
  if (!cv) return { title: null, lessons: [] };

  const rows = await db
    .select({ id: concepts.id, title: concepts.title, objective: concepts.learningObjective, chapterTitle: chapters.title, chapterOrder: chapters.chapterOrder })
    .from(concepts)
    .innerJoin(chapters, eq(chapters.id, concepts.chapterId))
    .where(and(eq(concepts.curriculumVersionId, cv.id), eq(concepts.reviewStatus, "approved")))
    .orderBy(asc(chapters.chapterOrder), asc(concepts.conceptOrder));
  const taught = await db.select().from(lessonCoverage).where(eq(lessonCoverage.classId, cls.id));
  const taughtOn = new Map(taught.map((t) => [t.conceptId, isoDate(t.taughtAt)]));
  return {
    title: cv.title,
    lessons: rows.map((r) => ({ conceptId: r.id, title: r.title, learningObjective: r.objective, chapterTitle: r.chapterTitle, chapterOrder: r.chapterOrder, taughtOn: taughtOn.get(r.id) ?? null })),
  };
}

export async function getTimetable(db: Db, actor: Actor, classId: string, today: string = isoDate(new Date())): Promise<TimetableResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const slots = await ensureTimetable(db, cls.id);
  const book = await loadBook(db, cls);
  return {
    classId: cls.id,
    className: cls.name,
    grade: cls.grade,
    today,
    bookTitle: book.title,
    lessonsTotal: book.lessons.length,
    lessonsTaught: book.lessons.filter((l) => l.taughtOn).length,
    slots,
    upcoming: planPeriods(slots, book.lessons, today, UPCOMING_DAYS),
  };
}

/** Replaces the whole week. A timetable is small and edited as a whole, so there is no partial update to get wrong. */
export async function saveTimetable(db: Db, actor: Actor, classId: string, input: SaveTimetableRequest, requestId?: string): Promise<TimetableSlotDto[]> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const seen = new Set<string>();
  for (const [i, s] of input.slots.entries()) {
    const key = `${s.weekday}-${s.period}`;
    if (seen.has(key)) throw new AppError("validation_error", "Two periods share the same day and period number.", [{ path: `slots.${i}`, message: "Two periods share the same day and period number." }]);
    seen.add(key);
    if (s.endsAt <= s.startsAt) throw new AppError("validation_error", "A period must end after it starts.", [{ path: `slots.${i}.endsAt`, message: "A period must end after it starts." }]);
  }
  await db.transaction(async (tx) => {
    await tx.delete(timetableSlots).where(eq(timetableSlots.classId, cls.id));
    if (input.slots.length) await tx.insert(timetableSlots).values(input.slots.map((s) => ({ ...s, classId: cls.id })));
  });
  await recordAudit(db, { actorId: actor.id, action: "timetable.save", entityType: "class", entityId: cls.id, metadata: { periods: input.slots.length }, requestId });
  return input.slots;
}

/**
 * Today's periods for every class a teacher owns (each with where its lesson flow stands), and tomorrow's first
 * Mathematics period per class, for the home page.
 */
export async function getDayPlans(db: Db, actor: Actor, today: string = isoDate(new Date()), weekOf?: string): Promise<{ today: SchedulePeriod[]; tomorrow: SchedulePeriod[]; week: SchedulePeriod[]; weekStart: string }> {
  // The school week shown on Today: Monday to Saturday (on a Sunday, the coming week), or the week containing `weekOf`.
  const mondayOf = (d: string) => (weekdayOf(d) === 7 ? addDays(d, 1) : addDays(d, 1 - weekdayOf(d)));
  const weekStart = mondayOf(weekOf ?? today);
  const mine = await db.select().from(classes).where(actor.role === "admin" ? undefined : eq(classes.teacherId, actor.id));
  if (mine.length === 0) return { today: [], tomorrow: [], week: [], weekStart };
  const states = await runStates(db, mine.map((c) => c.id), today);
  const tomorrowDate = addDays(today, 1);
  const weekEnd = addDays(weekStart, 5);
  const now: SchedulePeriod[] = [];
  const next: SchedulePeriod[] = [];
  const week: SchedulePeriod[] = [];
  for (const cls of mine) {
    const slots = await ensureTimetable(db, cls.id);
    const book = await loadBook(db, cls);
    // Earlier days: the timetable slots, with the lessons actually run that day (from lesson_runs) placed on that day's
    // Mathematics periods in the order they were started. Nothing is inferred for a day with no recorded run.
    const ran = await db
      .select({ date: lessonRuns.runDate, conceptId: lessonRuns.conceptId, wrappedAt: lessonRuns.wrappedAt, startedAt: lessonRuns.startedAt })
      .from(lessonRuns)
      .where(and(eq(lessonRuns.classId, cls.id), gte(lessonRuns.runDate, weekStart), lt(lessonRuns.runDate, today)))
      .orderBy(asc(lessonRuns.startedAt));
    const byId = new Map(book.lessons.map((l) => [l.conceptId, l]));
    for (let d = weekStart; d < today && d <= weekEnd; d = addDays(d, 1)) {
      const that = ran.filter((r) => r.date === d);
      for (const s of slots.filter((x) => x.weekday === weekdayOf(d)).sort((a, b) => a.period - b.period)) {
        const r = s.subject === MATHS ? that.shift() : undefined;
        const l = r ? byId.get(r.conceptId) : undefined;
        week.push({
          ...s,
          date: d,
          lesson: l ? { conceptId: l.conceptId, title: l.title, learningObjective: l.learningObjective, chapterTitle: l.chapterTitle, chapterOrder: l.chapterOrder, taught: !!l.taughtOn } : null,
          noLesson: null,
          classId: cls.id,
          className: cls.name,
          run: r ? (r.wrappedAt ? "done" : "needs_wrap") : null,
        });
      }
    }
    const ahead = Math.max(3, Math.round((Date.parse(weekEnd) - Date.parse(today)) / 86_400_000) + 1);
    for (const p of planPeriods(slots, book.lessons, today, ahead)) {
      const base = { ...p, classId: cls.id, className: cls.name };
      const run = p.date === today && p.lesson ? (states.get(`${cls.id}:${p.lesson.conceptId}`) ?? "not_started") : null;
      if (p.date === today) now.push({ ...base, run });
      else if (p.date === tomorrowDate && p.lesson && !next.some((n) => n.classId === cls.id)) next.push({ ...base, run: null });
      if (p.date >= weekStart && p.date <= weekEnd) week.push({ ...base, run });
    }
  }
  const byTime = (a: SchedulePeriod, b: SchedulePeriod) => a.startsAt.localeCompare(b.startsAt) || a.className.localeCompare(b.className);
  const byDayTime = (a: SchedulePeriod, b: SchedulePeriod) => a.date.localeCompare(b.date) || byTime(a, b);
  return { today: now.sort(byTime), tomorrow: next.sort(byTime), week: week.sort(byDayTime), weekStart };
}
