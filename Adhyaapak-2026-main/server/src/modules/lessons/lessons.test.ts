import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { auditLog, concepts, learningResources, lessonCoverage, questions } from "../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { seedFractionsClass6 } from "../curriculum/seed/seed";

const { app, db, pool } = buildTestApp();
afterAll(() => pool.end());
const API = "/api/v1";

type Agent = Awaited<ReturnType<typeof signedInAgent>>;
interface Ctx {
  teacher: Agent;
  classId: string;
  students: Record<string, string>;
  cid: (key: string) => string;
  qid: (key: string) => string;
}

async function setup(): Promise<Ctx> {
  await resetDb(db);
  await seedFractionsClass6(db);
  const teacher = await signedInAgent(app);
  const cls = (await teacher.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body;
  for (const name of ["Ravi Kumar", "Meera Shah"]) await teacher.post(`${API}/classes/${cls.id}/students`).send({ name });
  const list = (await teacher.get(`${API}/classes/${cls.id}/students`)).body.students as { id: string; name: string }[];
  const cs = new Map((await db.select().from(concepts)).map((c) => [c.key, c.id]));
  const qs = new Map((await db.select().from(questions)).map((q) => [q.key, q.id]));
  return { teacher, classId: cls.id, students: Object.fromEntries(list.map((s) => [s.name, s.id])), cid: (k) => cs.get(k)!, qid: (k) => qs.get(k)! };
}

/** Ravi answers both adding questions with the "adds denominators" pattern; Meera answers correctly. */
async function assess(c: Ctx) {
  const keys = ["q-af-1", "q-af-2"];
  const id = (await c.teacher.post(`${API}/classes/${c.classId}/assessments`).send({ title: "Check", type: "diagnostic", questionIds: keys.map(c.qid) })).body.id as string;
  await c.teacher.post(`${API}/assessments/${id}/status`).send({ to: "approved" });
  await c.teacher.post(`${API}/assessments/${id}/status`).send({ to: "open" });
  const pick = (name: string, o: string) => ({ studentId: c.students[name]!, answers: keys.map((k) => ({ questionId: c.qid(k), answer: { kind: "option", optionId: o } })) });
  await c.teacher.post(`${API}/assessments/${id}/entry`).send({ entries: [pick("Ravi Kumar", "a"), pick("Meera Shah", "b")] });
  await c.teacher.post(`${API}/assessments/${id}/status`).send({ to: "closed" });
}

describe("lesson workspace", () => {
  let c: Ctx;
  beforeEach(async () => (c = await setup()));

  it("returns the concept, a five-part flow with real question ids, and no insight before any assessment", async () => {
    const res = await c.teacher.get(`${API}/classes/${c.classId}/lessons/${c.cid("adding-fractions")}`);
    expect(res.status).toBe(200);
    expect(res.body.concept.title).toBe("Adding fractions");
    expect(res.body.flow.map((s: { key: string }) => s.key)).toEqual(["hook", "teach", "check", "practise", "exit_ticket"]);
    const ids = new Set(res.body.questions.map((q: { id: string }) => q.id));
    for (const seg of res.body.flow) for (const id of seg.questionIds) expect(ids.has(id)).toBe(true);
    const used = res.body.flow.flatMap((s: { questionIds: string[] }) => s.questionIds);
    expect(new Set(used).size).toBe(used.length);
    expect(res.body.taught).toBeNull();
    expect(res.body.insights).toMatchObject({ studentCount: 2, patterns: [] });
    expect(res.body.insights.counts.not_enough_evidence).toBe(2);
  });

  it("shows private class insight from real records", async () => {
    await assess(c);
    const res = await c.teacher.get(`${API}/classes/${c.classId}/lessons/${c.cid("adding-fractions")}`);
    expect(res.body.insights.counts).toMatchObject({ needs_foundation: 1, developing: 1, not_enough_evidence: 0 });
    expect(res.body.insights.patterns).toEqual([{ name: "Adds the denominators", studentCount: 1 }]);
  });

  it("404 for other teachers, unknown classes and unknown concepts; 401 without sign-in", async () => {
    const other = await signedInAgent(app, "other@example.com", "Other");
    const path = `${API}/classes/${c.classId}/lessons/${c.cid("adding-fractions")}`;
    expect((await other.get(path)).status).toBe(404);
    expect((await c.teacher.get(`${API}/classes/${c.classId}/lessons/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
    expect((await c.teacher.get(`${API}/classes/${c.classId}/lessons/nope`)).status).toBe(404);
    expect((await request(app).get(path)).status).toBe(401);
  });
});

describe("coverage tracker", () => {
  let c: Ctx;
  beforeEach(async () => (c = await setup()));
  const mark = (taught: boolean, key = "adding-fractions") => c.teacher.put(`${API}/classes/${c.classId}/lessons/${c.cid(key)}/taught`).send({ taught });
  const coverage = async () => (await c.teacher.get(`${API}/classes/${c.classId}/coverage`)).body;

  it("starts at zero taught of nine, in curriculum order", async () => {
    const cov = await coverage();
    expect(cov).toMatchObject({ taughtCount: 0, total: 9 });
    expect(cov.concepts[0].title).toBe("Multiplication and division facts");
    expect(cov.concepts.at(-1).title).toBe("Fraction word problems");
  });

  it("marks and unmarks a concept as taught; repeating is harmless", async () => {
    expect((await mark(true)).body).toEqual({ taught: true });
    await mark(true);
    expect(await db.select().from(lessonCoverage)).toHaveLength(1);
    let cov = await coverage();
    expect(cov.taughtCount).toBe(1);
    expect(cov.concepts.find((x: { title: string }) => x.title === "Adding fractions").taughtAt).toBeTruthy();
    expect((await c.teacher.get(`${API}/classes/${c.classId}/lessons/${c.cid("adding-fractions")}`)).body.taught).toMatchObject({ at: expect.any(String) });

    await mark(false);
    cov = await coverage();
    expect(cov.taughtCount).toBe(0);
  });

  it("counts students with evidence per concept", async () => {
    await assess(c);
    const cov = await coverage();
    expect(cov.concepts.find((x: { title: string }) => x.title === "Adding fractions").studentsWithEvidence).toBe(2);
    expect(cov.concepts.find((x: { title: string }) => x.title === "Subtracting fractions").studentsWithEvidence).toBe(0);
  });

  it("is per class: another teacher's class is separate and cannot be changed", async () => {
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await other.put(`${API}/classes/${c.classId}/lessons/${c.cid("adding-fractions")}/taught`).send({ taught: true })).status).toBe(404);
    expect((await other.get(`${API}/classes/${c.classId}/coverage`)).status).toBe(404);
    expect(await db.select().from(lessonCoverage)).toHaveLength(0);
  });

  it("validates the request and keeps an audit trail of both actions", async () => {
    expect((await c.teacher.put(`${API}/classes/${c.classId}/lessons/${c.cid("adding-fractions")}/taught`).send({ taught: "yes" })).status).toBe(400);
    expect((await c.teacher.put(`${API}/classes/${c.classId}/lessons/${c.cid("adding-fractions")}/taught`).send({})).status).toBe(400);
    await mark(true);
    await mark(false);
    const actions = (await db.select().from(auditLog)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["lesson.taught", "lesson.untaught"]));
  });
});

describe("presentation mode content", () => {
  let c: Ctx;
  beforeEach(async () => (c = await setup()));
  const present = (agent: Agent | ReturnType<typeof request>, key = "adding-fractions") => (agent as Agent).get(`${API}/concepts/${c.cid(key)}/presentation`);

  it("contains teaching content and question stems for the three levels", async () => {
    const res = await present(c.teacher);
    expect(res.status).toBe(200);
    expect(res.body.title).toBe("Adding fractions");
    expect(res.body.levels.map((l: { level: string }) => l.level)).toEqual(["foundation", "guided", "challenge"]);
    expect(res.body.levels[1].workedExample.problem).toMatch(/1\/2 \+ 1\/3/);
    expect(res.body.levels[0].manipulative).toMatchObject({ type: "fraction-bar" });
    expect(res.body.questions.length).toBeGreaterThanOrEqual(4);
    expect(res.body.questions[0]).toEqual({ id: expect.any(String), stem: expect.any(String), options: expect.any(Array) });
  });

  it("never contains answer keys, misconception tags, explanations, teacher notes or class data", async () => {
    await assess(c); // real student names and results now exist in the database
    const text = JSON.stringify((await present(c.teacher)).body);
    for (const secret of [
      "correctOptionId", "misconceptionKey", "adds-denominators", "explanation", "Common denominator 6", "Teacher note", "headline misconception",
      "Ravi", "Meera", "joinCode", "needs_foundation", "studentCount", "evidence",
    ]) expect(text, secret).not.toContain(secret);
    // Option objects carry only id and text.
    for (const q of JSON.parse(text).questions) for (const o of q.options) expect(Object.keys(o).sort()).toEqual(["id", "text"]);
  });

  it("only passes through whitelisted fields, even if stored content gains new ones", async () => {
    await db.execute(sql`update learning_resources set content = content || '{"secretNote":"do not show","answerKey":"b"}'::jsonb where key = 'res-adding-fractions-guided'`);
    const text = JSON.stringify((await present(c.teacher)).body);
    expect(text).not.toContain("secretNote");
    expect(text).not.toContain("answerKey");
  });

  it("leaves out unapproved resources and questions", async () => {
    await db.update(learningResources).set({ reviewStatus: "draft" }).where(eq(learningResources.key, "res-adding-fractions-challenge"));
    await db.update(questions).set({ reviewStatus: "draft" }).where(eq(questions.key, "q-af-4"));
    const body = (await present(c.teacher)).body;
    expect(body.levels.map((l: { level: string }) => l.level)).toEqual(["foundation", "guided"]);
    expect(body.questions).toHaveLength(3);
  });

  it("is teacher-only: anonymous and joined students are refused", async () => {
    expect((await request(app).get(`${API}/concepts/${c.cid("adding-fractions")}/presentation`)).status).toBe(401);
    const id = (await c.teacher.post(`${API}/classes/${c.classId}/assessments`).send({ title: "x", type: "diagnostic", questionIds: [c.qid("q-af-1")] })).body.id;
    await c.teacher.post(`${API}/assessments/${id}/status`).send({ to: "approved" });
    await c.teacher.post(`${API}/assessments/${id}/status`).send({ to: "open" });
    const cls = (await c.teacher.get(`${API}/classes/${c.classId}`)).body;
    const student = request.agent(app);
    expect((await student.post(`${API}/join`).send({ joinCode: cls.joinCode, rosterNumber: 1 })).status).toBe(200);
    expect((await student.get(`${API}/concepts/${c.cid("adding-fractions")}/presentation`)).status).toBe(401);
  });

  it("404 for unknown concepts", async () => {
    expect((await c.teacher.get(`${API}/concepts/00000000-0000-4000-8000-000000000000/presentation`)).status).toBe(404);
    expect((await c.teacher.get(`${API}/concepts/nope/presentation`)).status).toBe(404);
  });
});
