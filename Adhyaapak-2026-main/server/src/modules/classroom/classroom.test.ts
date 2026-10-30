import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { classEnrolments, concepts, misconceptionObservations, questions, studentSessions } from "../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { seedFractionsClass6 } from "../curriculum/seed/seed";

const { app, db, pool } = buildTestApp();
afterAll(() => pool.end());
const API = "/api/v1";

type Agent = Awaited<ReturnType<typeof signedInAgent>>;
interface Ctx {
  teacher: Agent;
  classId: string;
  joinCode: string;
  students: { id: string; rosterNumber: number; name: string }[];
  cid: (key: string) => string;
  qid: (key: string) => string;
}

async function setup(studentNames = ["Ravi", "Meera", "Anu"]): Promise<Ctx> {
  await resetDb(db);
  await seedFractionsClass6(db);
  const teacher = await signedInAgent(app);
  const cls = (await teacher.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body;
  for (const name of studentNames) await teacher.post(`${API}/classes/${cls.id}/students`).send({ name });
  const students = (await teacher.get(`${API}/classes/${cls.id}/students`)).body.students;
  const cs = new Map((await db.select().from(concepts)).map((c) => [c.key, c.id]));
  const qs = new Map((await db.select().from(questions)).map((q) => [q.key, q.id]));
  return { teacher, classId: cls.id, joinCode: cls.joinCode, students, cid: (k) => cs.get(k)!, qid: (k) => qs.get(k)! };
}

async function openActivity(c: Ctx, keys = ["q-af-1", "q-af-2"]) {
  const created = await c.teacher.post(`${API}/classes/${c.classId}/assessments`).send({ title: "Adding check", type: "diagnostic", questionIds: keys.map(c.qid) });
  expect(created.status).toBe(201);
  const id = created.body.id as string;
  expect((await c.teacher.post(`${API}/assessments/${id}/status`).send({ to: "approved" })).status).toBe(200);
  expect((await c.teacher.post(`${API}/assessments/${id}/status`).send({ to: "open" })).status).toBe(200);
  return id;
}

const join = (c: Ctx, rosterNumber: number, joinCode = c.joinCode) => {
  const agent = request.agent(app);
  return agent.post(`${API}/join`).send({ joinCode, rosterNumber }).then((res) => ({ agent, res }));
};

describe("building an activity", () => {
  let c: Ctx;
  beforeEach(async () => (c = await setup()));

  it("suggests 2-5 teacher-approved questions with answers visible to the teacher", async () => {
    const res = await c.teacher.post(`${API}/classes/${c.classId}/assessments/suggest`).send({ mode: "diagnostic", conceptIds: [c.cid("adding-fractions"), c.cid("subtracting-fractions")], count: 3 });
    expect(res.status).toBe(200);
    expect(res.body.questions).toHaveLength(3);
    expect(res.body.questions[0]).toMatchObject({ role: "diagnostic" });
    expect(res.body.questions[0].correctOptionId).toBeTruthy();
  });

  it("suggests a Prerequisite Pulse from the direct prerequisites of a topic", async () => {
    const res = await c.teacher.post(`${API}/classes/${c.classId}/assessments/suggest`).send({ mode: "prerequisite_pulse", targetConceptId: c.cid("equivalent-fractions"), count: 3 });
    const titles = res.body.questions.map((q: { conceptTitle: string }) => q.conceptTitle).sort();
    expect(titles).toEqual(["A fraction as part of a whole", "Multiplication and division facts"]);
  });

  it("validates the request and refuses unapproved or unknown questions", async () => {
    expect((await c.teacher.post(`${API}/classes/${c.classId}/assessments`).send({ title: "", type: "diagnostic", questionIds: [] })).status).toBe(400);
    expect((await c.teacher.post(`${API}/classes/${c.classId}/assessments`).send({ title: "x", type: "diagnostic", questionIds: ["00000000-0000-4000-8000-000000000000"] })).status).toBe(400);
    await db.update(questions).set({ reviewStatus: "draft" }).where(eq(questions.key, "q-af-1"));
    const res = await c.teacher.post(`${API}/classes/${c.classId}/assessments`).send({ title: "x", type: "diagnostic", questionIds: [c.qid("q-af-1")] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not been approved/);
  });

  it("walks draft → approved → open → closed and refuses skipping a step", async () => {
    const id = (await c.teacher.post(`${API}/classes/${c.classId}/assessments`).send({ title: "x", type: "diagnostic", questionIds: [c.qid("q-af-1")] })).body.id;
    expect((await c.teacher.post(`${API}/assessments/${id}/status`).send({ to: "open" })).status).toBe(409);
    for (const to of ["approved", "open", "closed"]) expect((await c.teacher.post(`${API}/assessments/${id}/status`).send({ to })).status).toBe(200);
    expect((await c.teacher.post(`${API}/assessments/${id}/status`).send({ to: "open" })).status).toBe(409);
  });

  it("allows only one open activity per class", async () => {
    await openActivity(c, ["q-af-1"]);
    const second = (await c.teacher.post(`${API}/classes/${c.classId}/assessments`).send({ title: "two", type: "diagnostic", questionIds: [c.qid("q-sf-1")] })).body.id;
    await c.teacher.post(`${API}/assessments/${second}/status`).send({ to: "approved" });
    const res = await c.teacher.post(`${API}/assessments/${second}/status`).send({ to: "open" });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Another activity is already open/);
  });
});

describe("students join with a class code and roster number", () => {
  let c: Ctx;
  beforeEach(async () => (c = await setup()));

  it("gives the same message for a wrong code and a wrong number, so codes cannot be probed", async () => {
    await openActivity(c);
    const wrongCode = await join(c, 1, "ZZZZZZ");
    const wrongNumber = await join(c, 99);
    expect(wrongCode.res.status).toBe(404);
    expect(wrongNumber.res.status).toBe(404);
    expect(wrongCode.res.body.error.message).toBe(wrongNumber.res.body.error.message);
  });

  it("does not let anyone in when nothing is open", async () => {
    const { res } = await join(c, 1);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Nothing is open/);
  });

  it("accepts a code typed in lower case or with spaces", async () => {
    await openActivity(c);
    const messy = `${c.joinCode.slice(0, 3).toLowerCase()} ${c.joinCode.slice(3)}`;
    expect((await join(c, 1, messy)).res.status).toBe(200);
  });

  it("shows the student only what they should see: no answer key, tags or explanations", async () => {
    await openActivity(c);
    const { agent } = await join(c, 1);
    const res = await agent.get(`${API}/student/activity`);
    expect(res.body.state).toBe("ready");
    expect(res.body.studentName).toBe("Ravi");
    expect(res.body.assessment.questions).toHaveLength(2);
    const text = JSON.stringify(res.body);
    for (const secret of ["correctOptionId", "misconception", "explanation", "adds-denominators", "Common denominator 6"]) expect(text).not.toContain(secret);
  });

  it("records answers with confidence, tells the student nothing about right or wrong, and is idempotent", async () => {
    await openActivity(c);
    const { agent } = await join(c, 1);
    const act = (await agent.get(`${API}/student/activity`)).body.assessment;
    const body = {
      idempotencyKey: "abcdefgh-1234",
      answers: [
        { questionId: act.questions[0].id, optionId: "a", confidence: "sure" },
        { questionId: act.questions[1].id, optionId: "b", confidence: "unsure" },
      ],
    };
    const first = await agent.post(`${API}/student/activity/answers`).send(body);
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ state: "submitted" });
    expect((await agent.post(`${API}/student/activity/answers`).send(body)).status).toBe(200);
    expect((await agent.get(`${API}/student/activity`)).body.state).toBe("submitted");
  });

  it("records unanswered questions as blank (no evidence), never as wrong", async () => {
    const id = await openActivity(c);
    const { agent } = await join(c, 2);
    const act = (await agent.get(`${API}/student/activity`)).body.assessment;
    await agent.post(`${API}/student/activity/answers`).send({ idempotencyKey: "blank-test-1", answers: [{ questionId: act.questions[0].id, optionId: "b" }] });
    const detail = (await c.teacher.get(`${API}/assessments/${id}`)).body;
    const t = detail.tallies.find((x: { questionId: string }) => x.questionId === act.questions[1].id);
    expect(t.insufficient).toBe(1);
    expect(t.answered).toBe(0);
  });

  it("stops accepting answers when the teacher closes the activity", async () => {
    const id = await openActivity(c);
    const { agent } = await join(c, 1);
    const act = (await agent.get(`${API}/student/activity`)).body.assessment;
    await c.teacher.post(`${API}/assessments/${id}/status`).send({ to: "closed" });
    const res = await agent.post(`${API}/student/activity/answers`).send({ idempotencyKey: "too-late-1", answers: [{ questionId: act.questions[0].id, optionId: "a" }] });
    expect(res.status).toBe(409);
    expect((await agent.get(`${API}/student/activity`)).body.state).toBe("no_activity");
  });

  it("rejects an answer for a question outside the activity, and requires a joined session", async () => {
    await openActivity(c);
    const { agent } = await join(c, 1);
    const res = await agent.post(`${API}/student/activity/answers`).send({ idempotencyKey: "wrong-q-0001", answers: [{ questionId: c.qid("q-mf-1"), optionId: "a" }] });
    expect(res.status).toBe(400);
    expect((await request(app).get(`${API}/student/activity`)).status).toBe(401);
  });

  it("a student session cannot reach any teacher route", async () => {
    const id = await openActivity(c);
    const { agent } = await join(c, 1);
    for (const path of [`/classes`, `/dashboard`, `/classes/${c.classId}/learning-map`, `/classes/${c.classId}/misconceptions`, `/assessments/${id}`, `/curriculum`]) {
      expect((await agent.get(`${API}${path}`)).status, path).toBe(401);
    }
    expect((await agent.post(`${API}/assessments/${id}/status`).send({ to: "closed" })).status).toBe(401);
  });

  it("a student withdrawn after joining loses access immediately", async () => {
    await openActivity(c);
    const { agent } = await join(c, 1);
    await db.update(classEnrolments).set({ status: "withdrawn" }).where(eq(classEnrolments.rosterNumber, 1));
    expect((await agent.get(`${API}/student/activity`)).status).toBe(401);
  });

  it("leaving ends the session", async () => {
    await openActivity(c);
    const { agent } = await join(c, 1);
    expect((await agent.post(`${API}/student/leave`)).status).toBe(204);
    expect((await agent.get(`${API}/student/activity`)).status).toBe(401);
    expect(await db.select().from(studentSessions)).toHaveLength(0);
  });
});

describe("Fast Entry Grid (teacher keys in paper answers)", () => {
  let c: Ctx;
  beforeEach(async () => (c = await setup()));

  const answer = (qid: string, optionId: string, confidence?: "sure" | "unsure" | "guess") => ({ questionId: qid, answer: { kind: "option" as const, optionId }, ...(confidence ? { confidence } : {}) });

  it("saves rows independently, reports duplicates and problems per row, and never double-saves", async () => {
    const id = await openActivity(c);
    const [ravi, meera] = c.students;
    const stranger = "00000000-0000-4000-8000-000000000001";
    const body = {
      entries: [
        { studentId: ravi!.id, answers: [answer(c.qid("q-af-1"), "a", "sure"), answer(c.qid("q-af-2"), "b")] },
        { studentId: meera!.id, answers: [answer(c.qid("q-af-1"), "b"), { questionId: c.qid("q-af-2"), answer: { kind: "unreadable" as const } }] },
        { studentId: stranger, answers: [answer(c.qid("q-af-1"), "b")] },
      ],
    };
    const first = (await c.teacher.post(`${API}/assessments/${id}/entry`).send(body)).body;
    expect(first.saved.sort()).toEqual([ravi!.id, meera!.id].sort());
    expect(first.failed).toHaveLength(1);
    expect(first.failed[0].studentId).toBe(stranger);

    const again = (await c.teacher.post(`${API}/assessments/${id}/entry`).send(body)).body;
    expect(again.saved).toEqual([]);
    expect(again.alreadySubmitted.sort()).toEqual([ravi!.id, meera!.id].sort());

    const detail = (await c.teacher.get(`${API}/assessments/${id}`)).body;
    expect(detail.students.filter((s: { submitted: boolean }) => s.submitted)).toHaveLength(2);
    const q1 = detail.tallies.find((t: { questionId: string }) => t.questionId === c.qid("q-af-1"));
    expect(q1.options.find((o: { optionId: string }) => o.optionId === "a")).toMatchObject({ count: 1, misconception: "Adds the denominators" });
  });

  it("does not overwrite a student's own submission", async () => {
    const id = await openActivity(c);
    const { agent } = await join(c, 1);
    const act = (await agent.get(`${API}/student/activity`)).body.assessment;
    await agent.post(`${API}/student/activity/answers`).send({ idempotencyKey: "own-answers-1", answers: act.questions.map((q: { id: string }) => ({ questionId: q.id, optionId: "b" })) });
    const res = (await c.teacher.post(`${API}/assessments/${id}/entry`).send({ entries: [{ studentId: c.students[0]!.id, answers: [answer(c.qid("q-af-1"), "a")] }] })).body;
    expect(res.alreadySubmitted).toEqual([c.students[0]!.id]);
  });

  it("still accepts paper answers after the activity is closed", async () => {
    const id = await openActivity(c);
    await c.teacher.post(`${API}/assessments/${id}/status`).send({ to: "closed" });
    const res = (await c.teacher.post(`${API}/assessments/${id}/entry`).send({ entries: [{ studentId: c.students[0]!.id, answers: [answer(c.qid("q-af-1"), "b")] }] })).body;
    expect(res.saved).toEqual([c.students[0]!.id]);
  });

  it("validates the payload", async () => {
    const id = await openActivity(c);
    expect((await c.teacher.post(`${API}/assessments/${id}/entry`).send({ entries: [] })).status).toBe(400);
    expect((await c.teacher.post(`${API}/assessments/${id}/entry`).send({ entries: [{ studentId: "nope", answers: [] }] })).status).toBe(400);
  });
});

describe("ownership", () => {
  it("another teacher gets 404 for every class and activity route", async () => {
    const c = await setup();
    const id = await openActivity(c);
    const other = await signedInAgent(app, "other@example.com", "Other");
    const checks = [
      other.get(`${API}/classes/${c.classId}/assessments`),
      other.post(`${API}/classes/${c.classId}/assessments/suggest`).send({ mode: "diagnostic", conceptIds: [c.cid("adding-fractions")], count: 2 }),
      other.post(`${API}/classes/${c.classId}/assessments`).send({ title: "x", type: "diagnostic", questionIds: [c.qid("q-af-1")] }),
      other.get(`${API}/assessments/${id}`),
      other.post(`${API}/assessments/${id}/status`).send({ to: "closed" }),
      other.post(`${API}/assessments/${id}/entry`).send({ entries: [{ studentId: c.students[0]!.id, answers: [{ questionId: c.qid("q-af-1"), answer: { kind: "blank" } }] }] }),
      other.get(`${API}/classes/${c.classId}/learning-map`),
      other.get(`${API}/classes/${c.classId}/misconceptions`),
      other.get(`${API}/classes/${c.classId}/students/${c.students[0]!.id}/concepts/${c.cid("adding-fractions")}/evidence`),
      other.post(`${API}/classes/${c.classId}/misconceptions/review`).send({ studentId: c.students[0]!.id, patternId: "00000000-0000-4000-8000-000000000000", decision: "reject" }),
    ];
    for (const res of await Promise.all(checks)) expect(res.status).toBe(404);
    expect((await c.teacher.get(`${API}/assessments/${id}`)).status).toBe(200);
  });
});

describe("learning map, evidence drill-down and misconceptions", () => {
  async function runClass() {
    const c = await setup(["Ravi", "Meera", "Anu", "Kiran"]);
    const grid = (studentIdx: number, a1: string, a2: string, conf: "sure" | "unsure" | "guess" = "sure") => ({
      studentId: c.students[studentIdx]!.id,
      answers: [
        { questionId: c.qid("q-af-1"), answer: { kind: "option" as const, optionId: a1 }, confidence: conf },
        { questionId: c.qid("q-af-2"), answer: { kind: "option" as const, optionId: a2 }, confidence: conf },
      ],
    });
    const id = await openActivity(c);
    // Ravi: adds denominators twice. Meera: both right. Anu: one right one wrong. Kiran: absent.
    await c.teacher.post(`${API}/assessments/${id}/entry`).send({ entries: [grid(0, "a", "a"), grid(1, "b", "b"), grid(2, "b", "c")] });
    return { c, id };
  }

  it("builds a map from stored records: no evidence shows as 'not enough evidence', never a score", async () => {
    const { c, id } = await runClass();
    const map = (await c.teacher.get(`${API}/classes/${c.classId}/learning-map?assessmentId=${id}`)).body;
    const adding = map.concepts.find((x: { title: string }) => x.title === "Adding fractions");
    expect(adding.counts).toMatchObject({ needs_foundation: 1, developing: 2, not_enough_evidence: 1 });
    const ravi = map.students.find((s: { name: string }) => s.name === "Ravi");
    expect(ravi.cells[adding.id]).toMatchObject({ status: "needs_foundation", evidenceCount: 2, pattern: "Adds the denominators" });
    const kiran = map.students.find((s: { name: string }) => s.name === "Kiran");
    expect(kiran.cells[adding.id]).toEqual({ status: "not_enough_evidence", evidenceCount: 0, pattern: null });
    expect(JSON.stringify(map)).not.toMatch(/estimate/);
  });

  it("filters by concept and returns an empty map when nothing has been assessed", async () => {
    const c = await setup();
    const empty = (await c.teacher.get(`${API}/classes/${c.classId}/learning-map`)).body;
    expect(empty.concepts).toEqual([]);
    expect(empty.students).toHaveLength(3);
    const filtered = (await c.teacher.get(`${API}/classes/${c.classId}/learning-map?conceptIds=${c.cid("adding-fractions")}`)).body;
    expect(filtered.concepts.map((x: { title: string }) => x.title)).toEqual(["Adding fractions"]);
  });

  it("explains a cell: every evidence row, whether it counted and with what weight", async () => {
    const { c } = await runClass();
    const ravi = c.students[0]!;
    const why = (await c.teacher.get(`${API}/classes/${c.classId}/students/${ravi.id}/concepts/${c.cid("adding-fractions")}/evidence`)).body;
    expect(why.mastery).toMatchObject({ status: "needs_foundation", evidenceCount: 2, algorithmVersion: "baseline-1.0.0" });
    expect(why.rows).toHaveLength(2);
    expect(why.rows[0]).toMatchObject({ result: "incorrect", counted: true, confidence: "sure", misconception: "Adds the denominators" });
    expect(why.rows[0].weight).toBeGreaterThan(0);
    expect(why.rows.map((r: { chosen: string }) => r.chosen)).toEqual(["2/5", "5/14"]);
  });

  it("class misconceptions use real counts and an anonymous mirror prompt", async () => {
    const { c } = await runClass();
    const res = (await c.teacher.get(`${API}/classes/${c.classId}/misconceptions`)).body;
    expect(res.classSize).toBe(4);
    const p = res.patterns.find((x: { key: string }) => x.key === "adds-denominators");
    expect(p.studentCount).toBe(1);
    expect(p.students).toEqual([expect.objectContaining({ name: "Ravi", status: "likely" })]);
    expect(p.summary).toBe('1 of 3 students who answered on "Adding fractions" gave an answer matching: Adds the denominators.');
    expect(p.mirror.prompt).toMatch(/Some of us answered like this/);
    expect(p.mirror.prompt).not.toMatch(/Ravi/);
    expect(p.mirror.whatToShow.length).toBeGreaterThan(20);
  });

  it("teacher confirms or rejects; the decision changes the map and the stats", async () => {
    const { c } = await runClass();
    const patternId = (await c.teacher.get(`${API}/classes/${c.classId}/misconceptions`)).body.patterns[0].patternId;
    const ravi = c.students[0]!;
    const res = await c.teacher.post(`${API}/classes/${c.classId}/misconceptions/review`).send({ studentId: ravi.id, patternId, decision: "reject" });
    expect(res.status).toBe(200);
    expect((await c.teacher.get(`${API}/classes/${c.classId}/misconceptions`)).body.patterns).toEqual([]);
    const map = (await c.teacher.get(`${API}/classes/${c.classId}/learning-map?conceptIds=${c.cid("adding-fractions")}`)).body;
    expect(map.students.find((s: { name: string }) => s.name === "Ravi").cells[c.cid("adding-fractions")].pattern).toBeNull();
    expect((await db.select().from(misconceptionObservations)).every((o) => o.status === "rejected")).toBe(true);
  });
});
