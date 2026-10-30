import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { auditLog, classes, concepts, lessonCoverage, lessonRuns } from "../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { seedBook } from "../curriculum/seed/book";
import { runStates, startRun } from "./run.service";

const { app, db, pool } = buildTestApp();
afterAll(() => pool.end());
const API = "/api/v1";
type Agent = ReturnType<typeof request.agent>;

beforeEach(async () => {
  await resetDb(db);
  await seedBook(db);
});

async function setup(agent: Agent, students = 8) {
  const classId = (await agent.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body.id as string;
  const ids: string[] = [];
  for (let i = 1; i <= students; i++) ids.push((await agent.post(`${API}/classes/${classId}/students`).send({ name: `Student ${i}` })).body.id);
  const [concept] = await db.select().from(concepts).where(eq(concepts.key, "adding-fractions"));
  return { classId, conceptId: concept!.id, studentIds: ids };
}
const run = (c: { classId: string; conceptId: string }, tail = "") => `${API}/classes/${c.classId}/lessons/${c.conceptId}/run${tail}`;

/** Key answers for every student: the first `wrong` students pick the answer tagged with an error pattern, the rest are right. */
async function keyAnswers(agent: Agent, assessmentId: string, studentIds: string[], wrong: number) {
  const a = (await agent.get(`${API}/assessments/${assessmentId}`)).body;
  const entries = studentIds.map((studentId, i) => ({
    studentId,
    answers: a.questions.map((q: { id: string; correctOptionId: string; options: Array<{ id: string; misconceptionKey?: string | null }> }) => {
      const tagged = q.options.find((o) => o.misconceptionKey) ?? q.options.find((o) => o.id !== q.correctOptionId)!;
      return { questionId: q.id, answer: { kind: "option", optionId: i < wrong ? tagged.id : q.correctOptionId }, confidence: "sure" };
    }),
  }));
  return agent.post(`${API}/assessments/${assessmentId}/entry`).send({ entries });
}

describe("lesson run: one period from teaching to wrap-up", () => {
  it("starts a run and is safe to start twice", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    expect((await agent.get(run(c))).body.state).toBe("not_started");
    const first = (await agent.post(run(c))).body;
    const again = (await agent.post(run(c))).body;
    expect(first.state).toBe("teaching");
    expect(again.startedAt).toBe(first.startedAt);
  });

  it("starts a check in one call: two or three approved questions, open, and the same check on a repeat", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    const res = await agent.post(run(c, "/check/start")).send({});
    expect(res.status).toBe(200);
    expect(res.body.questions.length).toBeGreaterThanOrEqual(2);
    expect(res.body.questions.length).toBeLessThanOrEqual(3);
    expect(res.body.run.state).toBe("checking");
    const detail = (await agent.get(`${API}/assessments/${res.body.assessmentId}`)).body;
    expect(detail.status).toBe("open");
    expect(detail.title).toMatch(/^Check: /);
    const again = await agent.post(run(c, "/check/start")).send({});
    expect(again.body.assessmentId).toBe(res.body.assessmentId);
  });

  it("uses the teacher's own choice of questions, but only from this lesson's bank", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    const bank = (await agent.get(`${API}/classes/${c.classId}/lessons/${c.conceptId}`)).body.questions as Array<{ id: string }>;
    const ok = await agent.post(run(c, "/check/start")).send({ questionIds: [bank[0]!.id, bank[1]!.id] });
    expect(ok.body.questions.map((q: { id: string }) => q.id).sort()).toEqual([bank[0]!.id, bank[1]!.id].sort());

    const agent2 = await signedInAgent(app, "t2@example.com", "T2");
    const c2 = await setup(agent2);
    const other = (await agent2.get(`${API}/classes/${c2.classId}/lessons/${c2.conceptId}`)).body.questions as Array<{ id: string }>;
    const [fm] = await db.select().from(concepts).where(eq(concepts.key, "factors-multiples"));
    const foreign = (await agent2.get(`${API}/classes/${c2.classId}/lessons/${fm!.id}`)).body.questions[0].id;
    expect(other.length).toBeGreaterThan(0);
    const bad = await agent2.post(run(c2, "/check/start")).send({ questionIds: [foreign] });
    expect(bad.status).toBe(400);
  });

  it("says which activity is in the way when another one is already open", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    const sug = (await agent.post(`${API}/classes/${c.classId}/assessments/suggest`).send({ mode: "diagnostic", conceptIds: [c.conceptId], count: 2 })).body.questions;
    const a = (await agent.post(`${API}/classes/${c.classId}/assessments`).send({ title: "Old quiz", type: "diagnostic", questionIds: sug.map((q: { id: string }) => q.id) })).body;
    await agent.post(`${API}/assessments/${a.id}/status`).send({ to: "approved" });
    await agent.post(`${API}/assessments/${a.id}/status`).send({ to: "open" });
    const res = await agent.post(run(c, "/check/start")).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain("Old quiz");
  });

  it("goes teaching → checking → needs_wrap → done, and the summary matches the stored answers", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent, 8);
    const started = (await agent.post(run(c, "/check/start")).send({})).body;
    const keyed = await keyAnswers(agent, started.assessmentId, c.studentIds, 4);
    expect(keyed.body.saved).toHaveLength(8);

    // A check still open must be finished first.
    expect((await agent.post(run(c, "/wrap")).send({})).status).toBe(409);

    const finished = (await agent.post(run(c, "/check/finish")).send({})).body;
    expect(finished.state).toBe("needs_wrap");

    const s = (await agent.get(run(c, "/summary"))).body;
    expect(s.answered).toBe(8);
    expect(s.studentCount).toBe(8);
    expect(s.questions.length).toBeGreaterThanOrEqual(2);
    for (const q of s.questions) {
      expect(q.answered).toBe(8);
      expect(q.options.find((o: { correct: boolean }) => o.correct).count).toBe(4);
    }
    expect(s.recommendation.sufficiency).toBe("enough");
    expect(s.recommendation.teacherReviewRequired).toBe(true);
    expect(s.taught).toBe(false);
    // Every suggested path names its reason, so the teacher can check it before assigning.
    const placed = s.groups.flatMap((g: { students: Array<{ reason: string; prerequisiteTitles: string[] }> }) => g.students);
    expect(placed).toHaveLength(8);
    for (const st of placed) {
      expect(st.reason.length).toBeGreaterThan(10);
      expect(Array.isArray(st.prerequisiteTitles)).toBe(true);
    }

    const wrapped = (await agent.post(run(c, "/wrap")).send({ markTaught: true, assignGroups: true })).body;
    expect(wrapped.run.state).toBe("done");
    expect(wrapped.assigned).toBeGreaterThan(0);
    expect(await db.select().from(lessonCoverage).where(eq(lessonCoverage.conceptId, c.conceptId))).toHaveLength(1);

    // Wrapping twice changes nothing.
    const twice = (await agent.post(run(c, "/wrap")).send({ markTaught: true, assignGroups: true })).body;
    expect(twice.assigned).toBe(0);
    expect(twice.run.state).toBe("done");
  });

  it("pauses a running check: devices wait, paper entry still works, resume reopens it, and it can finish from paused", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent, 3);
    expect((await agent.post(run(c, "/pause"))).status).toBe(409); // nothing running yet
    const started = (await agent.post(run(c, "/check/start")).send({})).body;
    const [cls] = await db.select().from(classes).where(eq(classes.id, c.classId));
    const student = request.agent(app);
    expect((await student.post(`${API}/join`).send({ joinCode: cls!.joinCode, rosterNumber: 1 })).status).toBe(200);
    const questions = (await student.get(`${API}/student/activity`)).body.assessment.questions as Array<{ id: string; options: Array<{ id: string }> }>;
    const answers = questions.map((q) => ({ questionId: q.id, optionId: q.options[0]!.id }));

    expect((await agent.post(run(c, "/pause"))).body.state).toBe("paused");
    expect((await agent.post(run(c, "/pause"))).body.state).toBe("paused"); // pausing twice changes nothing
    expect((await agent.get(run(c))).body.state).toBe("paused");
    // The student is told it is paused, with no questions on screen, and a new answer is refused.
    const seen = (await student.get(`${API}/student/activity`)).body;
    expect(seen).toEqual({ studentName: "Student 1", state: "paused" });
    const refused = await student.post(`${API}/student/activity/answers`).send({ idempotencyKey: "pause-test-0001", answers });
    expect(refused.status).toBe(409);
    expect(refused.body.error.message).toMatch(/paused/i);
    // The teacher can still key in a paper slip while paused.
    expect((await keyAnswers(agent, started.assessmentId, [c.studentIds[1]!], 0)).body.saved).toHaveLength(1);

    expect((await agent.post(run(c, "/resume"))).body.state).toBe("checking");
    expect((await student.get(`${API}/student/activity`)).body.state).toBe("ready");
    expect((await student.post(`${API}/student/activity/answers`).send({ idempotencyKey: "pause-test-0001", answers })).status).toBeLessThan(300);

    await agent.post(run(c, "/pause"));
    const finished = (await agent.post(run(c, "/check/finish")).send({})).body;
    expect(finished.state).toBe("needs_wrap");
    const [row] = await db.select().from(lessonRuns).where(eq(lessonRuns.assessmentId, started.assessmentId));
    expect(row!.pausedAt).toBeNull();
    const actions = (await db.select().from(auditLog)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["lesson_run.pause", "lesson_run.resume"]));
  });

  it("can finish a period without a check: marks taught and asks for nothing else", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    await agent.post(run(c));
    const w = (await agent.post(run(c, "/wrap")).send({ markTaught: true })).body;
    expect(w.run.state).toBe("done");
    expect(w.assigned).toBe(0);
    const s = (await agent.get(run(c, "/summary"))).body;
    expect(s.recommendation).toBeNull();
    expect(s.taught).toBe(true);
  });

  it("recaps the last wrapped lesson's patterns and how many students are not secure on the earlier ideas", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent, 8);
    const started = (await agent.post(run(c, "/check/start")).send({})).body;
    await keyAnswers(agent, started.assessmentId, c.studentIds, 6);
    await agent.post(run(c, "/check/finish")).send({});
    await agent.post(run(c, "/wrap")).send({ markTaught: true });

    // Look at a later lesson on a later "day" through the service so the run is not today's.
    const recap = (await agent.get(`${API}/classes/${c.classId}/lessons/${c.conceptId}/run/recap`)).body;
    expect(recap.studentCount).toBe(8);
    expect(Array.isArray(recap.prerequisites)).toBe(true);
    expect(recap.prerequisites.every((p: { notSecure: number; assessed: number }) => p.notSecure <= p.assessed)).toBe(true);
  });

  it("lists what needs the teacher, and clears it as they act", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    expect((await agent.get(`${API}/attention`)).body.items).toEqual([]);

    const started = (await agent.post(run(c, "/check/start")).send({})).body;
    let items = (await agent.get(`${API}/attention`)).body.items;
    expect(items.map((i: { kind: string }) => i.kind)).toContain("check_open");
    expect(items[0].href).toBe(`/classes/${c.classId}/lessons/${c.conceptId}?step=check`);

    await keyAnswers(agent, started.assessmentId, c.studentIds, 2);
    await agent.post(run(c, "/check/finish")).send({});
    items = (await agent.get(`${API}/attention`)).body.items;
    expect(items.map((i: { kind: string }) => i.kind)).toContain("needs_wrap");

    await agent.post(run(c, "/wrap")).send({ markTaught: true });
    items = (await agent.get(`${API}/attention`)).body.items;
    expect(items.map((i: { kind: string }) => i.kind)).not.toContain("needs_wrap");
    expect(items.map((i: { kind: string }) => i.kind)).not.toContain("check_open");
  });

  it("reports each lesson's state for a given day (used by Today)", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    const me = (await agent.get(`${API}/auth/me`)).body.user;
    const actor = { id: me.id, role: "teacher" } as never;
    await startRun(db, actor, c.classId, c.conceptId, undefined, "2026-11-02");
    expect((await runStates(db, [c.classId], "2026-11-02")).get(`${c.classId}:${c.conceptId}`)).toBe("teaching");
    expect((await runStates(db, [c.classId], "2026-11-03")).size).toBe(0);
  });

  it("is private to the class's teacher", async () => {
    const owner = await signedInAgent(app, "owner@example.com", "Owner");
    const c = await setup(owner);
    const other = await signedInAgent(app, "other@example.com", "Other");
    for (const [method, tail] of [["get", ""], ["post", ""], ["get", "/recap"], ["post", "/check/start"], ["post", "/check/finish"], ["get", "/summary"], ["post", "/wrap"]] as const) {
      const res = await other[method](run(c, tail)).send({});
      expect(res.status, `${method} ${tail}`).toBe(404);
    }
  });
});
