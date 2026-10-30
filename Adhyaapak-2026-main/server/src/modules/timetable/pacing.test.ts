import { describe, expect, it } from "vitest";
import { addDays, planPeriods, sampleWeek, weekdayOf, type BookLesson } from "./pacing";

const lesson = (n: number, taughtOn: string | null = null): BookLesson => ({ conceptId: `c${n}`, title: `Lesson ${n}`, learningObjective: "o", chapterTitle: "Ch", chapterOrder: 1, taughtOn });
const book = (n: number, taught: Record<number, string> = {}) => Array.from({ length: n }, (_, i) => lesson(i + 1, taught[i + 1] ?? null));

// 2026-11-02 is a Monday.
const MON = "2026-11-02";
const maths = (plan: ReturnType<typeof planPeriods>) => plan.filter((p) => p.subject === "Mathematics");

describe("calendar helpers", () => {
  it("numbers weekdays Monday = 1 to Sunday = 7 and adds days across a month end", () => {
    expect(weekdayOf(MON)).toBe(1);
    expect(weekdayOf("2026-11-08")).toBe(7);
    expect(addDays("2026-11-29", 3)).toBe("2026-12-02");
  });
});

describe("planPeriods", () => {
  const slots = sampleWeek();

  it("puts the book into Mathematics periods in order, and nothing into other subjects", () => {
    const plan = planPeriods(slots, book(10), MON, 7);
    const m = maths(plan);
    expect(m.map((p) => p.lesson?.title)).toEqual(["Lesson 1", "Lesson 2", "Lesson 3", "Lesson 4", "Lesson 5"]);
    expect(plan.filter((p) => p.subject !== "Mathematics").every((p) => p.lesson === null && p.noLesson === "no_textbook")).toBe(true);
  });

  it("skips lessons taught on an earlier day", () => {
    const m = maths(planPeriods(slots, book(10, { 1: "2026-10-30", 2: "2026-10-30" }), MON, 7));
    expect(m[0]!.lesson!.title).toBe("Lesson 3");
  });

  it("keeps a lesson taught today in today's first Mathematics period instead of moving on", () => {
    const m = maths(planPeriods(slots, book(10, { 1: MON }), MON, 7));
    expect(m[0]).toMatchObject({ date: MON, lesson: { title: "Lesson 1", taught: true } });
    expect(m[1]!.lesson!.title).toBe("Lesson 2");
  });

  it("says the book is finished rather than inventing a lesson", () => {
    const m = maths(planPeriods(slots, book(2), MON, 7));
    expect(m.map((p) => p.noLesson)).toEqual([null, null, "book_finished", "book_finished", "book_finished"]);
    expect(m[2]!.lesson).toBeNull();
  });

  it("has no periods on Sunday and returns periods in date and period order", () => {
    const plan = planPeriods(slots, book(10), MON, 7);
    expect(plan.some((p) => p.date === "2026-11-08")).toBe(false);
    const keys = plan.map((p) => `${p.date}-${String(p.period).padStart(2, "0")}`);
    expect(keys).toEqual([...keys].sort());
  });

  it("sample week is a valid week: 6 periods a day, 5 of Mathematics, no clashes", () => {
    expect(slots).toHaveLength(36);
    expect(slots.filter((s) => s.subject === "Mathematics")).toHaveLength(5);
    expect(new Set(slots.map((s) => `${s.weekday}-${s.period}`)).size).toBe(36);
  });
});
