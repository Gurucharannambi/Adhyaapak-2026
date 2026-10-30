import { z } from "zod";
import { Id } from "./common";
import { RunState } from "./lesson-run";

/** Subjects a period can be set to. Only Mathematics has our own textbook so far. */
export const TIMETABLE_SUBJECTS = ["Mathematics", "Science", "Social Science", "English", "Hindi", "Other"] as const;

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 09:40");

export const TimetableSlotDto = z.object({
  weekday: z.number().int().min(1).max(6),
  period: z.number().int().min(1).max(10),
  startsAt: hhmm,
  endsAt: hhmm,
  subject: z.string().trim().min(1).max(40),
});
export type TimetableSlotDto = z.infer<typeof TimetableSlotDto>;

export const PlannedLesson = z.object({
  conceptId: Id,
  title: z.string(),
  learningObjective: z.string(),
  chapterTitle: z.string(),
  chapterOrder: z.number().int(),
  /** True once the teacher has marked this lesson as taught to the class. */
  taught: z.boolean(),
});
export type PlannedLesson = z.infer<typeof PlannedLesson>;

export const PlanPeriod = TimetableSlotDto.extend({
  /** Calendar date, YYYY-MM-DD. */
  date: z.string(),
  lesson: PlannedLesson.nullable(),
  /** Why a period has no lesson: only Mathematics has a textbook, and a finished book has nothing left to plan. */
  noLesson: z.enum(["no_textbook", "book_finished"]).nullable(),
});
export type PlanPeriod = z.infer<typeof PlanPeriod>;

export const TimetableResponse = z.object({
  classId: Id,
  className: z.string(),
  grade: z.number().int(),
  today: z.string(),
  bookTitle: z.string().nullable(),
  lessonsTotal: z.number().int(),
  lessonsTaught: z.number().int(),
  slots: z.array(TimetableSlotDto),
  /** The next two weeks, with a lesson planned into every Mathematics period. */
  upcoming: z.array(PlanPeriod),
});
export type TimetableResponse = z.infer<typeof TimetableResponse>;

export const SaveTimetableRequest = z.object({ slots: z.array(TimetableSlotDto).max(60) });
export type SaveTimetableRequest = z.infer<typeof SaveTimetableRequest>;

/** One period on today's schedule, for the teacher's home page. */
export const SchedulePeriod = PlanPeriod.extend({
  classId: Id,
  className: z.string(),
  /** Where this period is in its lesson flow today. Null for periods without a lesson. */
  run: RunState.nullable(),
});
export type SchedulePeriod = z.infer<typeof SchedulePeriod>;
