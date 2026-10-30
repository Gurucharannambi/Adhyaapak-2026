import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { assessmentEvidence, classes, concepts, conceptMastery, pollVotes } from "../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { seedBook } from "../curriculum/seed/book";
import { CreatePollRequest } from "@adhyaapak/shared";
import { pollContent } from "./poll.service";

const API = "/api/v1";
const { app, db, pool } = buildTestApp();
afterAll(() => pool.end());

beforeEach(async () => {
  await resetDb(db);
  await seedBook(db);
});

async function setup(students = 3) {
  const teacher = await signedInAgent(app);
  const classId = (await teacher.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body.id as string;
  for (let i = 1; i <= students; i++) await teacher.post(`${API}/classes/${classId}/students`).send({ name: `Student ${i}` });
  const [concept] = await db.select().from(concepts).where(eq(concepts.key, "equivalent-fractions"));
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
  const base = `${API}/classes/${classId}/lessons/${concept!.id}/polls`;
  return { teacher, classId, conceptId: concept!.id, joinCode: cls!.joinCode, base };
}

async function join(joinCode: string, roll: number) {
  const agent = request.agent(app);
  const res = await agent.post(`${API}/join`).send({ joinCode, rosterNumber: roll });
  expect(res.status).toBe(200);
  return agent;
}

describe("poll wording (pure)", () => {
  it("fixes the wording of the confidence and true/false polls", () => {
    expect(pollContent({ kind: "confidence" }).options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
    expect(pollContent({ kind: "true_false", prompt: "1/2 = 2/4" }).options.map((o) => o.text)).toEqual(["True", "False"]);
    expect(pollContent({ kind: "choice", prompt: "Which?", options: ["x", "y"] }).options).toEqual([{ id: "a", text: "x" }, { id: "b", text: "y" }]);
  });

  it("validates the request: a question is needed, choices must differ, fixed polls take no choices", () => {
    expect(CreatePollRequest.safeParse({ kind: "choice", prompt: "Which?", options: ["a"] }).success).toBe(false);
    expect(CreatePollRequest.safeParse({ kind: "choice", prompt: "Which?", options: ["Same", "same"] }).success).toBe(false);
    expect(CreatePollRequest.safeParse({ kind: "true_false" }).success).toBe(false);
    expect(CreatePollRequest.safeParse({ kind: "true_false", prompt: "ok then", options: ["x", "y"] }).success).toBe(false);
    expect(CreatePollRequest.safeParse({ kind: "confidence" }).success).toBe(true);
  });
});

describe("quick polls", () => {
  it("runs a poll live: students see the question, answer once, and the teacher sees counts only", async () => {
    const c = await setup();
    const started = await c.teacher.post(c.base).send({ kind: "confidence" });
    expect(started.status).toBe(201);
    expect(started.body.options).toHaveLength(4);
    expect(started.body.answered).toBe(0);
    expect(started.body.classSize).toBe(3);

    const s1 = await join(c.joinCode, 1);
    const s2 = await join(c.joinCode, 2);
    const seen = (await s1.get(`${API}/student/activity`)).body;
    expect(seen.state).toBe("poll");
    expect(seen.poll.answered).toBe(false);
    // What a student is told: the question and choices, never counts or other students.
    expect(Object.keys(seen.poll).sort()).toEqual(["answerType", "answered", "id", "options", "prompt"]);
    expect(seen.poll.options[0]).not.toHaveProperty("count");

    expect((await s1.post(`${API}/student/poll/vote`).send({ optionId: "b" })).status).toBe(200);
    expect((await s2.post(`${API}/student/poll/vote`).send({ optionId: "c" })).status).toBe(200);
    // A retry, even with a different choice, does not count twice.
    expect((await s1.post(`${API}/student/poll/vote`).send({ optionId: "d" })).status).toBe(200);
    expect((await s1.get(`${API}/student/activity`)).body.poll.answered).toBe(true);

    const now = (await c.teacher.get(`${c.base}/current`)).body.poll;
    expect(now.answered).toBe(2);
    expect(now.options.map((o: { count: number }) => o.count)).toEqual([0, 1, 1, 0]);
    // Counts only: the teacher payload carries no student identity.
    expect(JSON.stringify(now)).not.toMatch(/student|Student|studentId/);
  });

  it("rejects a choice that is not in the poll and a vote after it closes", async () => {
    const c = await setup();
    const poll = (await c.teacher.post(c.base).send({ kind: "true_false", prompt: "2/4 is the same as 1/2" })).body;
    const s = await join(c.joinCode, 1);
    expect((await s.post(`${API}/student/poll/vote`).send({ optionId: "z" })).status).toBe(400);
    expect((await c.teacher.post(`${API}/polls/${poll.id}/close`)).body.status).toBe("closed");
    expect((await s.post(`${API}/student/poll/vote`).send({ optionId: "a" })).status).toBe(409);
    // Closing again is harmless, and the closed poll's counts stay readable.
    expect((await c.teacher.post(`${API}/polls/${poll.id}/close`)).status).toBe(200);
    expect((await c.teacher.get(`${c.base}/current`)).body.poll.status).toBe("closed");
    // A closed poll is gone from the student's screen.
    expect((await s.get(`${API}/student/activity`)).body.state).toBe("no_activity");
  });

  it("allows one open poll per class, and never while a check is open; starting a check closes the poll", async () => {
    const c = await setup();
    expect((await c.teacher.post(c.base).send({ kind: "confidence" })).status).toBe(201);
    expect((await c.teacher.post(c.base).send({ kind: "confidence" })).status).toBe(409);

    // Starting the check closes the open poll so students answer one thing at a time.
    const started = await c.teacher.post(`${API}/classes/${c.classId}/lessons/${c.conceptId}/run/check/start`).send({});
    expect(started.status).toBe(200);
    expect((await c.teacher.get(`${c.base}/current`)).body.poll.status).toBe("closed");
    const refused = await c.teacher.post(c.base).send({ kind: "confidence" });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/check is open/i);
  });

  it("is never assessment evidence: no evidence or mastery rows, and the votes table holds no score", async () => {
    const c = await setup();
    await c.teacher.post(c.base).send({ kind: "choice", prompt: "Which picture is bigger?", options: ["A", "B"] });
    const s = await join(c.joinCode, 1);
    await s.post(`${API}/student/poll/vote`).send({ optionId: "a" });
    expect(await db.select().from(assessmentEvidence)).toHaveLength(0);
    expect(await db.select().from(conceptMastery)).toHaveLength(0);
    expect(await db.select().from(pollVotes)).toHaveLength(1);
  });

  it("keeps polls private to the owning teacher and requires sign-in", async () => {
    const c = await setup();
    const poll = (await c.teacher.post(c.base).send({ kind: "confidence" })).body;
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await other.get(`${c.base}/current`)).status).toBe(404);
    expect((await other.post(c.base).send({ kind: "confidence" })).status).toBe(404);
    expect((await other.post(`${API}/polls/${poll.id}/close`)).status).toBe(404);
    expect((await request(app).get(`${c.base}/current`)).status).toBe(401);
    // A student cannot start or close polls.
    const s = await join(c.joinCode, 1);
    expect([401, 403]).toContain((await s.post(`${API}/polls/${poll.id}/close`)).status);
    // A student with no session cannot vote.
    expect((await request(app).post(`${API}/student/poll/vote`).send({ optionId: "a" })).status).toBe(401);
  });

  it("records an audit entry when a poll starts and closes", async () => {
    const c = await setup();
    const poll = (await c.teacher.post(c.base).send({ kind: "confidence" })).body;
    await c.teacher.post(`${API}/polls/${poll.id}/close`);
    const { auditLog } = await import("../../db/schema");
    const actions = (await db.select().from(auditLog)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["poll.start", "poll.close"]));
  });
});
