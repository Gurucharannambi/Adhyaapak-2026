import type { PlanPeriod, PlannedLesson, TimetableSlotDto } from "@adhyaapak/shared";

/** A lesson in book order, with the day it was taught (YYYY-MM-DD) if it has been. */
export interface BookLesson extends Omit<PlannedLesson, "taught"> {
  taughtOn: string | null;
}

export const MATHS = "Mathematics";

/** Builds a YYYY-MM-DD string from local calendar parts, so the date never shifts with the time zone. */
export const isoDate = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Weekday for a YYYY-MM-DD string: 1 = Monday … 6 = Saturday, 7 = Sunday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const js = new Date(y, m - 1, d, 12).getDay();
  return js === 0 ? 7 : js;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return isoDate(new Date(y, m - 1, d + n, 12));
}

/**
 * Plans the textbook into the timetable. The rule is deliberately simple and easy to explain to a teacher:
 *  - Mathematics periods, in calendar order, take the lessons of the book in order.
 *  - A lesson already taught today keeps its place in today's earlier periods, so marking a lesson "taught" does
 *    not make it vanish from the schedule.
 *  - Lessons taught on an earlier day are skipped; nothing is repeated.
 * Other subjects have no textbook yet, so they carry no lesson.
 */
export function planPeriods(slots: TimetableSlotDto[], lessons: BookLesson[], from: string, days: number): PlanPeriod[] {
  const queue = [...lessons.filter((l) => l.taughtOn === from), ...lessons.filter((l) => !l.taughtOn)];
  const toPlanned = (l: BookLesson): PlannedLesson => ({ conceptId: l.conceptId, title: l.title, learningObjective: l.learningObjective, chapterTitle: l.chapterTitle, chapterOrder: l.chapterOrder, taught: !!l.taughtOn });
  const out: PlanPeriod[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const wd = weekdayOf(date);
    const today = slots.filter((s) => s.weekday === wd).sort((a, b) => a.period - b.period);
    for (const s of today) {
      if (s.subject !== MATHS) {
        out.push({ ...s, date, lesson: null, noLesson: "no_textbook" });
        continue;
      }
      const next = queue.shift();
      out.push({ ...s, date, lesson: next ? toPlanned(next) : null, noLesson: next ? null : "book_finished" });
    }
  }
  return out;
}

/** A sample week for a new class: six 40-minute periods, Monday to Saturday, five of them Mathematics. */
export function sampleWeek(): TimetableSlotDto[] {
  const times: Array<[string, string]> = [
    ["09:00", "09:40"],
    ["09:40", "10:20"],
    ["10:30", "11:10"],
    ["11:10", "11:50"],
    ["12:30", "13:10"],
    ["13:10", "13:50"],
  ];
  const week: Record<number, string[]> = {
    1: [MATHS, "Science", "Social Science", "English", "Hindi", "Other"],
    2: ["English", MATHS, "Science", "Hindi", "Social Science", "Other"],
    3: ["Science", "Social Science", "English", MATHS, "Hindi", "Other"],
    4: [MATHS, "English", "Hindi", "Science", "Social Science", "Other"],
    5: ["Hindi", "Science", MATHS, "Social Science", "English", "Other"],
    6: ["Social Science", "English", "Science", "Hindi", "Other", "Other"],
  };
  return Object.entries(week).flatMap(([wd, subjects]) =>
    subjects.map((subject, i) => ({ weekday: Number(wd), period: i + 1, startsAt: times[i]![0], endsAt: times[i]![1], subject })),
  );
}
