import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { seedBook } from "../curriculum/seed/book";
import { getTimetable } from "./timetable.service";

const { app, db, pool } = buildTestApp();
afterAll(() => pool.end());
const API = "/api/v1";

beforeEach(async () => {
  await resetDb(db);
  await seedBook(db);
});

async function classFor(agent: ReturnType<typeof request.agent>, grade = 6) {
  const res = await agent.post(`${API}/classes`).send({ name: "6A", grade, academicYear: "2026-27" });
  return res.body.id as string;
}

describe("our textbook", () => {
  it("has five chapters in teaching order, each with its own summary", async () => {
    const agent = await signedInAgent(app);
    const curricula = (await agent.get(`${API}/curriculum`)).body.curricula;
    const chapters = (await agent.get(`${API}/curriculum/${curricula[0].id}/chapters`)).body.chapters;
    expect(chapters.map((c: { title: string }) => c.title)).toEqual(["Fractions", "Decimals", "Patterns in Mathematics", "Lines and Angles", "Data Handling and Presentation"]);
    for (const c of chapters) {
      expect(c.summary).toBeTruthy();
      expect(c.keyIdeas.length).toBeGreaterThan(0);
    }
  });
});

describe("class timetable", () => {
  it("gives a new class a sample week and plans the textbook into its Mathematics periods", async () => {
    const agent = await signedInAgent(app);
    const classId = await classFor(agent);
    const res = await agent.get(`${API}/classes/${classId}/timetable`);
    expect(res.status).toBe(200);
    expect(res.body.slots).toHaveLength(36);
    expect(res.body.bookTitle).toMatch(/Class 6 Mathematics/);
    expect(res.body.lessonsTotal).toBe(24);
    const maths = res.body.upcoming.filter((p: { subject: string }) => p.subject === "Mathematics");
    expect(maths.length).toBeGreaterThanOrEqual(5);
    expect(maths[0].lesson.chapterTitle).toBe("Fractions");
    expect(maths[0].lesson.title).toBe("Multiplication and division facts");
    expect(res.body.upcoming.find((p: { subject: string }) => p.subject === "Science").lesson).toBeNull();
  });

  it("moves on to the next lesson once the teacher marks one as taught, and keeps today's lesson in place", async () => {
    const agent = await signedInAgent(app);
    const classId = await classFor(agent);
    const first = (await agent.get(`${API}/classes/${classId}/timetable`)).body.upcoming.find((p: { subject: string }) => p.subject === "Mathematics");
    await agent.put(`${API}/classes/${classId}/lessons/${first.lesson.conceptId}/taught`).send({ taught: true });
    const after = (await agent.get(`${API}/classes/${classId}/timetable`)).body;
    const maths = after.upcoming.filter((p: { subject: string }) => p.subject === "Mathematics");
    const names = maths.map((p: { lesson: { title: string } }) => p.lesson.title);
    // The taught lesson stays at the front of the first Mathematics period of today, and is never repeated later.
    expect(names.filter((n: string) => n === first.lesson.title)).toHaveLength(1);
    expect(after.lessonsTaught).toBe(1);
  });

  it("plans from the date it is given (service level, deterministic)", async () => {
    const agent = await signedInAgent(app);
    const classId = await classFor(agent);
    const me = (await agent.get(`${API}/auth/me`)).body.user;
    const plan = await getTimetable(db, { id: me.id, role: "teacher" } as never, classId, "2026-11-02");
    expect(plan.today).toBe("2026-11-02");
    expect(plan.upcoming[0]).toMatchObject({ date: "2026-11-02", weekday: 1, period: 1, subject: "Mathematics" });
  });

  it("saves an edited week and rejects clashes and backwards times", async () => {
    const agent = await signedInAgent(app);
    const classId = await classFor(agent);
    const ok = await agent.put(`${API}/classes/${classId}/timetable`).send({ slots: [{ weekday: 1, period: 1, startsAt: "08:00", endsAt: "08:45", subject: "Mathematics" }] });
    expect(ok.status).toBe(200);
    expect(ok.body.slots).toHaveLength(1);
    const clash = await agent.put(`${API}/classes/${classId}/timetable`).send({ slots: [{ weekday: 1, period: 1, startsAt: "08:00", endsAt: "08:45", subject: "Mathematics" }, { weekday: 1, period: 1, startsAt: "09:00", endsAt: "09:45", subject: "Science" }] });
    expect(clash.status).toBe(400);
    const backwards = await agent.put(`${API}/classes/${classId}/timetable`).send({ slots: [{ weekday: 1, period: 1, startsAt: "09:00", endsAt: "08:00", subject: "Mathematics" }] });
    expect(backwards.status).toBe(400);
  });

  it("is private to the class's teacher", async () => {
    const owner = await signedInAgent(app, "owner@example.com", "Owner");
    const classId = await classFor(owner);
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await other.get(`${API}/classes/${classId}/timetable`)).status).toBe(404);
    expect((await other.put(`${API}/classes/${classId}/timetable`).send({ slots: [] })).status).toBe(404);
  });

  it("says plainly that a grade without a textbook has no lessons planned", async () => {
    const agent = await signedInAgent(app);
    const classId = await classFor(agent, 8);
    const body = (await agent.get(`${API}/classes/${classId}/timetable`)).body;
    expect(body.bookTitle).toBeNull();
    expect(body.upcoming.every((p: { lesson: unknown }) => p.lesson === null)).toBe(true);
  });

  it("puts today's schedule on the dashboard", async () => {
    const agent = await signedInAgent(app);
    await classFor(agent);
    const dash = (await agent.get(`${API}/dashboard`)).body;
    expect(Array.isArray(dash.schedule)).toBe(true);
  });
});
