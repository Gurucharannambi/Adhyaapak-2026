import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { assessmentEvidence, assessments, conceptMastery, concepts, questions } from "../../db/schema";
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
  conceptId: string;
  students: { id: string; name: string; rosterNumber: number }[];
}
let c: Ctx;

async function setup(portal = true): Promise<Ctx> {
  await resetDb(db);
  await seedFractionsClass6(db);
  const teacher = await signedInAgent(app);
  const cls = (await teacher.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body;
  for (const name of ["Ravi Kumar", "Meera Rao", "Anu Das"]) await teacher.post(`${API}/classes/${cls.id}/students`).send({ name });
  const students = (await teacher.get(`${API}/classes/${cls.id}/students`)).body.students;
  const conceptId = (await db.select().from(concepts).where(eq(concepts.key, "adding-fractions")))[0]!.id;
  if (portal) expect((await teacher.patch(`${API}/classes/${cls.id}`).send({ portalEnabled: true })).body.portalEnabled).toBe(true);
  return { teacher, classId: cls.id, joinCode: cls.joinCode, conceptId, students };
}

const join = async (roll: number) => {
  const agent = request.agent(app);
  const res = await agent.post(`${API}/join`).send({ joinCode: c.joinCode, rosterNumber: roll });
  return { agent, res };
};
const opt = (optionId: string) => optionId;

beforeEach(async () => {
  c = await setup();
});

describe("joining", () => {
  it("is not possible with nothing open, until the teacher turns practice on", async () => {
    c = await setup(false);
    const before = await join(1);
    expect(before.res.status).toBe(409);
    await c.teacher.patch(`${API}/classes/${c.classId}`).send({ portalEnabled: true });
    expect((await join(1)).res.status).toBe(200);
    await c.teacher.patch(`${API}/classes/${c.classId}`).send({ portalEnabled: false });
    expect((await join(1)).res.status).toBe(409);
  });

  it("a teacher's setting cannot be changed by anyone else", async () => {
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await other.patch(`${API}/classes/${c.classId}`).send({ portalEnabled: false })).status).toBe(404);
    const { agent } = await join(1);
    expect((await agent.patch(`${API}/classes/${c.classId}`).send({ portalEnabled: false })).status).toBe(401);
  });
});

describe("home", () => {
  it("shows friendly progress words, never diagnostic labels, other students, or scores", async () => {
    await db.insert(conceptMastery).values({ studentId: c.students[0]!.id, conceptId: c.conceptId, estimate: 0.3, status: "needs_foundation", evidenceCount: 3, evidenceIds: [], algorithmVersion: "x", lastEvidenceAt: new Date() });
    await db.insert(conceptMastery).values({ studentId: c.students[1]!.id, conceptId: c.conceptId, estimate: 0.9, status: "ready_for_challenge", evidenceCount: 5, evidenceIds: [], algorithmVersion: "x", lastEvidenceAt: new Date() });
    const { agent } = await join(1);
    const home = (await agent.get(`${API}/student/home`)).body;
    expect(home.studentName).toBe("Ravi Kumar");
    expect(home.progress).toEqual([{ conceptId: c.conceptId, title: "Adding fractions", word: "keep_practising" }]);
    const text = JSON.stringify(home);
    expect(text).not.toMatch(/needs_foundation|developing|likely_secure|ready_for_challenge|misconception|estimate|evidence|Meera|Anu|rank|weak/i);
    const other = (await (await join(2)).agent.get(`${API}/student/home`)).body;
    expect(other.progress[0].word).toBe("ready_for_more");
  });

  it("suggests a next step with a reason in simple words, from the same policy the teacher's board uses", async () => {
    await c.teacher.put(`${API}/classes/${c.classId}/lessons/${c.conceptId}/taught`).send({ taught: true });
    await db.insert(conceptMastery).values({ studentId: c.students[0]!.id, conceptId: c.conceptId, estimate: 0.6, status: "developing", evidenceCount: 3, evidenceIds: [], algorithmVersion: "x", lastEvidenceAt: new Date() });
    const home = (await (await join(1)).agent.get(`${API}/student/home`)).body;
    expect(home.next).toMatchObject({ kind: expect.stringMatching(/practice|revisit|wait_for_teacher/), title: expect.any(String), why: expect.any(String) });
    expect(home.next.why.length).toBeGreaterThan(10);
    expect(home.next.why).not.toMatch(/policy|evidence|status|mastery/i);
  });

  it("offers nothing when practice is off, and says a teacher will help when there is nothing yet", async () => {
    c = await setup(false);
    await c.teacher.patch(`${API}/classes/${c.classId}`).send({ portalEnabled: true });
    const { agent } = await join(3);
    const home = (await agent.get(`${API}/student/home`)).body;
    expect(home.next).toMatchObject({ kind: "wait_for_teacher" });
    await c.teacher.patch(`${API}/classes/${c.classId}`).send({ portalEnabled: false });
    const off = (await agent.get(`${API}/student/home`)).body;
    expect(off).toMatchObject({ next: null, progress: [], revisit: [] });
    expect((await agent.get(`${API}/student/practice?conceptId=${c.conceptId}&mode=guided`)).status).toBe(403);
  });

  it("lists things learned a while ago for a quick revisit", async () => {
    const old = new Date(Date.now() - 30 * 86_400_000);
    await db.insert(conceptMastery).values({ studentId: c.students[0]!.id, conceptId: c.conceptId, estimate: 0.9, status: "likely_secure", evidenceCount: 6, evidenceIds: [], algorithmVersion: "x", lastEvidenceAt: old });
    const home = (await (await join(1)).agent.get(`${API}/student/home`)).body;
    expect(home.revisit).toEqual([{ conceptId: c.conceptId, title: "Adding fractions" }]);
  });
});

describe("practice", () => {
  const start = (agent: request.Agent, mode = "guided") => agent.get(`${API}/student/practice?conceptId=${c.conceptId}&mode=${mode}`);

  it("gives a short set with no answers or tags, and reuses an unfinished one", async () => {
    const { agent } = await join(1);
    const res = await start(agent);
    expect(res.status).toBe(200);
    expect(res.body.questions.length).toBeGreaterThan(0);
    expect(res.body.questions.length).toBeLessThanOrEqual(3);
    expect(JSON.stringify(res.body)).not.toMatch(/correct|misconception|explanation/i);
    const again = await start(agent);
    expect(again.body.setId).toBe(res.body.setId);
    expect((await db.select().from(assessments).where(eq(assessments.type, "practice")))).toHaveLength(1);
  });

  it("is invisible to the teacher's class activity list, and to other students", async () => {
    const { agent } = await join(1);
    const set = (await start(agent)).body;
    expect((await c.teacher.get(`${API}/classes/${c.classId}/assessments`)).body.assessments ?? (await c.teacher.get(`${API}/classes/${c.classId}/assessments`)).body).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: set.setId })]));
    const second = (await join(2)).agent;
    const q = set.questions[0].id;
    expect((await second.get(`${API}/student/practice/${set.setId}/hint?questionId=${q}&level=1`)).status).toBe(404);
    expect((await second.post(`${API}/student/practice/${set.setId}/submit`).send({ answers: [{ questionId: q, optionId: "a", hintLevel: 0 }] })).status).toBe(404);
  });

  it("climbs the hint ladder from approved teaching content, and stops at three", async () => {
    const { agent } = await join(1);
    const set = (await start(agent)).body;
    const q = set.questions[0].id;
    const hints = [];
    for (const level of [1, 2, 3]) hints.push((await agent.get(`${API}/student/practice/${set.setId}/hint?questionId=${q}&level=${level}`)).body);
    expect(hints.map((h) => h.level)).toEqual([1, 2, 3]);
    expect(hints.map((h) => h.more)).toEqual([true, true, false]);
    expect(hints[0].text).toMatch(/^Think about this idea/);
    expect(new Set(hints.map((h) => h.text)).size).toBe(3);
    expect((await agent.get(`${API}/student/practice/${set.setId}/hint?questionId=${q}&level=4`)).status).toBe(400);
    expect((await agent.get(`${API}/student/practice/${set.setId}/hint?questionId=${q}&level=0`)).status).toBe(400);
  });

  it("records answers as weaker evidence when hints were used, reveals answers only afterwards, and only once", async () => {
    const { agent } = await join(1);
    const set = (await start(agent)).body;
    const [first, second] = set.questions;
    const res = await agent.post(`${API}/student/practice/${set.setId}/submit`).send({
      answers: [
        { questionId: first.id, optionId: first.options[0].id, hintLevel: 0 },
        ...(second ? [{ questionId: second.id, optionId: second.options[1].id, hintLevel: 2 }] : []),
      ],
    });
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ correctOptionId: expect.any(String), explanation: expect.anything() });
    expect(res.body.message.length).toBeGreaterThan(5);

    const evidence = await db.select().from(assessmentEvidence).where(eq(assessmentEvidence.studentId, c.students[0]!.id));
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((e) => e.source === "practice_activity")).toBe(true);
    if (second) expect(evidence.some((e) => e.selfConfidence === "guess")).toBe(true); // two hints = weaker evidence
    expect((await db.select().from(conceptMastery).where(sql`${conceptMastery.studentId} = ${c.students[0]!.id}`)).length).toBeGreaterThan(0);

    expect((await agent.post(`${API}/student/practice/${set.setId}/submit`).send({ answers: [{ questionId: first.id, optionId: "a", hintLevel: 0 }] })).status).toBe(409);
    expect((await agent.get(`${API}/student/practice/${set.setId}/hint?questionId=${first.id}&level=1`)).status).toBe(409);
    // The next set is a fresh one and prefers questions not yet answered.
    expect((await start(agent)).body.setId).not.toBe(set.setId);
  });

  it("refuses answers for questions outside the set, and blank is allowed (no evidence, not wrong)", async () => {
    const { agent } = await join(1);
    const set = (await start(agent)).body;
    const outsider = (await db.select().from(questions).where(eq(questions.key, "q-sf-1")))[0]!;
    expect((await agent.post(`${API}/student/practice/${set.setId}/submit`).send({ answers: [{ questionId: outsider.id, optionId: "a", hintLevel: 0 }] })).status).toBe(400);
    expect((await agent.post(`${API}/student/practice/${set.setId}/submit`).send({ answers: [{ questionId: set.questions[0].id, optionId: "a", hintLevel: 0 }, { questionId: set.questions[0].id, optionId: "b", hintLevel: 0 }] })).status).toBe(400);
    const blank = await agent.post(`${API}/student/practice/${set.setId}/submit`).send({ answers: [{ questionId: set.questions[0].id, optionId: null, hintLevel: 0 }] });
    expect(blank.status).toBe(200);
    expect(blank.body.results[0].correct).toBeNull();
    expect((await db.select().from(assessmentEvidence).where(eq(assessmentEvidence.result, "incorrect"))).length).toBe(0);
  });

  it("needs a student session: teachers and strangers cannot use the student endpoints", async () => {
    const anonymous = request(app);
    for (const path of [`/student/home`, `/student/practice?conceptId=${c.conceptId}`]) {
      expect((await anonymous.get(`${API}${path}`)).status).toBe(401);
      expect((await c.teacher.get(`${API}${path}`)).status).toBe(401);
    }
    expect((await anonymous.post(`${API}/student/practice/00000000-0000-4000-8000-000000000000/submit`).send({ answers: [{ questionId: "00000000-0000-4000-8000-000000000000", optionId: "a", hintLevel: 0 }] })).status).toBe(401);
  });

  it("validates the request", async () => {
    const { agent } = await join(1);
    expect((await agent.get(`${API}/student/practice?conceptId=nope&mode=guided`)).status).toBe(404);
    expect((await agent.get(`${API}/student/practice?conceptId=${c.conceptId}&mode=hard`)).status).toBe(400);
    expect((await agent.get(`${API}/student/practice`)).status).toBe(400);
    expect((await agent.post(`${API}/student/practice/00000000-0000-4000-8000-000000000000/submit`).send({ answers: [] })).status).toBe(400);
  });
});
