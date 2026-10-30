import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { classes, concepts } from "../../db/schema";
import { buildTestApp, resetDb } from "../../test/helpers";
import { seedBook } from "../curriculum/seed/book";

const { app, db, pool } = buildTestApp();
afterAll(() => pool.end());
const API = "/api/v1";

beforeEach(async () => {
  await resetDb(db);
  await seedBook(db);
});

async function classWithCheck(students = 3) {
  const teacher = request.agent(app);
  const reg = await teacher.post(`${API}/auth/register`).send({ name: "Asha", email: "asha@example.com", password: "correct horse battery" });
  const cookie = (reg.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
  const classId = (await teacher.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body.id as string;
  const studentIds: string[] = [];
  for (let i = 1; i <= students; i++) studentIds.push((await teacher.post(`${API}/classes/${classId}/students`).send({ name: `Student ${i}` })).body.id);
  const [concept] = await db.select().from(concepts).where(eq(concepts.key, "adding-fractions"));
  const started = (await teacher.post(`${API}/classes/${classId}/lessons/${concept!.id}/run/check/start`).send({})).body;
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  return { teacher, cookie, classId, studentIds, assessmentId: started.assessmentId as string, joinCode: cls!.joinCode };
}

async function joinStudent(joinCode: string, roll: number) {
  const agent = request.agent(app);
  const res = await agent.post(`${API}/join`).send({ joinCode, rosterNumber: roll });
  expect(res.status).toBe(200);
  const cookie = (res.headers["set-cookie"] as unknown as string[]).map((c) => c.split(";")[0]).join("; ");
  return { agent, cookie };
}

/** Answers every question: right when `right`, else the first wrong option. */
async function answerAll(agent: request.Agent, right: boolean, key: string) {
  const a = (await agent.get(`${API}/student/activity`)).body;
  expect(a.state).toBe("ready");
  const answers = a.assessment.questions.map((q: { id: string; options: Array<{ id: string }> }) => ({ questionId: q.id, optionId: q.options[right ? 1 : 0]!.id, confidence: "sure" }));
  const res = await agent.post(`${API}/student/activity/answers`).send({ idempotencyKey: key, answers });
  expect([200, 201]).toContain(res.status);
  return { activity: a, res };
}

/** Opens an event stream and collects `change` events until closed. */
function listen(port: number, path: string, cookie: string) {
  const events: Array<{ kind: string; assessmentId?: string }> = [];
  let req!: http.ClientRequest;
  const ready = new Promise<void>((resolve, reject) => {
    req = http.get({ port, path, headers: { Cookie: cookie, Accept: "text/event-stream" } }, (res) => {
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/event-stream");
      let buf = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buf += chunk;
        for (const block of buf.split("\n\n").slice(0, -1)) {
          if (block.includes("event: ready")) resolve();
          const m = /event: change\ndata: (.*)/.exec(block);
          if (m) events.push(JSON.parse(m[1]!));
        }
        buf = buf.slice(buf.lastIndexOf("\n\n") + 2);
      });
    });
    req.on("error", reject);
  });
  return { events, ready, close: () => req.destroy() };
}
const until = async (cond: () => boolean, ms = 3000) => {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 25));
};

describe("live scores for the teacher", () => {
  it("scores each student as they submit on their own device, and shows who has joined", async () => {
    const c = await classWithCheck(3);
    const before = (await c.teacher.get(`${API}/assessments/${c.assessmentId}`)).body;
    expect(before.students.every((s: { joined: boolean; score: unknown }) => !s.joined && s.score === null)).toBe(true);

    const s1 = await joinStudent(c.joinCode, 1);
    const s2 = await joinStudent(c.joinCode, 2);
    const mid = (await c.teacher.get(`${API}/assessments/${c.assessmentId}`)).body;
    expect(mid.students.map((s: { joined: boolean }) => s.joined)).toEqual([true, true, false]);

    const right = await answerAll(s1.agent, true, "key-student-1");
    expect(right.res.status).toBe(201);
    // The student is not told right or wrong.
    expect(right.res.body).toEqual({ state: "submitted" });
    await answerAll(s2.agent, false, "key-student-2");

    const after = (await c.teacher.get(`${API}/assessments/${c.assessmentId}`)).body;
    const total = after.questions.length;
    expect(after.students[0].score).toEqual({ correct: total, answered: total, total });
    expect(after.students[1].score).toEqual({ correct: 0, answered: total, total });
    expect(after.students[2].score).toBeNull();
    expect(after.resultsReleased).toBe(false);
  });
});

describe("results released to students", () => {
  it("shows a student only their own friendly results, only after the check is closed and the teacher releases them", async () => {
    const c = await classWithCheck(2);
    const s1 = await joinStudent(c.joinCode, 1);
    const s2 = await joinStudent(c.joinCode, 2);
    await answerAll(s1.agent, true, "key-student-1");
    await answerAll(s2.agent, false, "key-student-2");

    // While the check is open, nothing but "submitted".
    expect((await s1.agent.get(`${API}/student/activity`)).body.state).toBe("submitted");
    // An open check cannot be released.
    expect((await c.teacher.post(`${API}/assessments/${c.assessmentId}/release-results`).send({})).status).toBe(409);

    await c.teacher.post(`${API}/assessments/${c.assessmentId}/status`).send({ to: "closed" });
    // Closed but not released: still no results.
    expect((await s1.agent.get(`${API}/student/activity`)).body.state).toBe("no_activity");

    expect((await c.teacher.post(`${API}/assessments/${c.assessmentId}/release-results`).send({})).status).toBe(200);
    expect((await c.teacher.post(`${API}/assessments/${c.assessmentId}/release-results`).send({})).status).toBe(200); // safe to repeat

    const mine = (await s1.agent.get(`${API}/student/activity`)).body;
    expect(mine.state).toBe("results");
    expect(mine.results.questions.every((q: { outcome: string }) => q.outcome === "right")).toBe(true);
    expect(mine.results.questions[0].explanation).toBeTruthy();
    const theirs = (await s2.agent.get(`${API}/student/activity`)).body;
    expect(theirs.results.questions.every((q: { outcome: string }) => q.outcome === "not_yet")).toBe(true);

    // No score, percentage, rank or other student's data anywhere in what a student receives.
    const text = JSON.stringify(mine);
    expect(text).not.toMatch(/score|percent|rank|Student 2/i);
    expect((await c.teacher.get(`${API}/assessments/${c.assessmentId}`)).body.resultsReleased).toBe(true);
  });

  it("gives a student who did not take the check no results", async () => {
    const c = await classWithCheck(2);
    const s1 = await joinStudent(c.joinCode, 1);
    const s2 = await joinStudent(c.joinCode, 2);
    await answerAll(s1.agent, true, "key-student-1");
    await c.teacher.post(`${API}/assessments/${c.assessmentId}/status`).send({ to: "closed" });
    await c.teacher.post(`${API}/assessments/${c.assessmentId}/release-results`).send({});
    expect((await s2.agent.get(`${API}/student/activity`)).body.state).toBe("no_activity");
  });

  it("only the class's teacher can release", async () => {
    const c = await classWithCheck(1);
    await c.teacher.post(`${API}/assessments/${c.assessmentId}/status`).send({ to: "closed" });
    const other = request.agent(app);
    await other.post(`${API}/auth/register`).send({ name: "Other", email: "other@example.com", password: "correct horse battery" });
    expect((await other.post(`${API}/assessments/${c.assessmentId}/release-results`).send({})).status).toBe(404);
  });
});

describe("live streams", () => {
  it("tells the teacher the moment a student submits, and the student when the check closes or results are released, but never what classmates did", async () => {
    const c = await classWithCheck(2);
    const server = app.listen(0);
    const port = (server.address() as AddressInfo).port;
    const s1 = await joinStudent(c.joinCode, 1);
    const s2 = await joinStudent(c.joinCode, 2);

    const teacherStream = listen(port, `${API}/classes/${c.classId}/live`, c.cookie);
    const studentStream = listen(port, `${API}/student/live`, s2.cookie);
    await Promise.all([teacherStream.ready, studentStream.ready]);

    await answerAll(s1.agent, true, "key-student-1");
    await until(() => teacherStream.events.some((e) => e.kind === "answers"));
    expect(teacherStream.events.some((e) => e.kind === "answers" && e.assessmentId === c.assessmentId)).toBe(true);

    await c.teacher.post(`${API}/assessments/${c.assessmentId}/status`).send({ to: "closed" });
    await c.teacher.post(`${API}/assessments/${c.assessmentId}/release-results`).send({});
    await until(() => studentStream.events.some((e) => e.kind === "released"));
    const kinds = studentStream.events.map((e) => e.kind);
    expect(kinds).toEqual(["closed", "released"]);
    expect(kinds).not.toContain("answers");

    teacherStream.close();
    studentStream.close();
    server.close();
  });

  it("refuses streams to people who are not signed in, and to another teacher's class", async () => {
    const c = await classWithCheck(1);
    expect((await request(app).get(`${API}/student/live`)).status).toBe(401);
    expect((await request(app).get(`${API}/classes/${c.classId}/live`)).status).toBe(401);
    const other = request.agent(app);
    await other.post(`${API}/auth/register`).send({ name: "Other", email: "other@example.com", password: "correct horse battery" });
    expect((await other.get(`${API}/classes/${c.classId}/live`)).status).toBe(404);
  });
});
