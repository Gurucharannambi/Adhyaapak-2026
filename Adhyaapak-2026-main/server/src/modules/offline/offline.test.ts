import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assessmentAttempts, assessmentEvidence, assessmentQuestions, assessments, concepts, questions, syncOperations } from "../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { seedFractionsClass6 } from "../curriculum/seed/seed";

const { app, db, pool } = buildTestApp();
afterAll(() => pool.end());
const API = "/api/v1";

type Agent = Awaited<ReturnType<typeof signedInAgent>>;
interface Ctx {
  teacher: Agent;
  classId: string;
  conceptId: string;
  students: { id: string; name: string; rosterNumber: number }[];
  qid: (key: string) => string;
}
let c: Ctx;
let pack: any;

beforeEach(async () => {
  await resetDb(db);
  await seedFractionsClass6(db);
  const teacher = await signedInAgent(app);
  const cls = (await teacher.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body;
  for (const name of ["Ravi", "Meera", "Anu"]) await teacher.post(`${API}/classes/${cls.id}/students`).send({ name });
  const students = (await teacher.get(`${API}/classes/${cls.id}/students`)).body.students;
  const conceptId = (await db.select().from(concepts).where(eq(concepts.key, "adding-fractions")))[0]!.id;
  const qs = new Map((await db.select().from(questions)).map((q) => [q.key, q.id]));
  c = { teacher, classId: cls.id, conceptId, students, qid: (k) => qs.get(k)! };
  const res = await teacher.post(`${API}/lessons/${conceptId}/offline-packs`).send({ classId: cls.id, questionCount: 3 });
  expect(res.status).toBe(201);
  pack = res.body;
});

const op = (key: string, rosterNumber: number, over: Record<string, unknown> = {}, answers?: Array<[string, string]>) => ({
  idempotencyKey: key,
  type: "record_responses",
  baseVersion: pack.version,
  recordedAt: "2026-10-28T09:30:00.000Z",
  payload: {
    assessmentId: pack.assessmentId,
    rosterNumber,
    responses: ((answers ?? pack.questions.map((q: { id: string }) => [q.id, "b"])) as Array<[string, string]>).map(([questionId, optionId]: [string, string]) => ({ questionId, answer: { kind: "option", optionId } })),
  },
  ...over,
});
const sync = (agent: Agent, ...ops: unknown[]) => agent.post(`${API}/sync/operations`).send({ operations: ops });
const attempts = () => db.select().from(assessmentAttempts);

describe("offline pack", () => {
  it("holds teaching content and questions without answers; the key is separate, and students are roll numbers only", async () => {
    expect(pack.conceptTitle).toBe("Adding fractions");
    expect(pack.presentation.levels.length).toBeGreaterThan(0);
    expect(pack.questions).toHaveLength(2); // the number of approved diagnostic questions this lesson has
    const studentFacing = JSON.stringify({ presentation: pack.presentation, questions: pack.questions });
    expect(studentFacing).not.toMatch(/correctOptionId|misconception|explanation"/);
    expect(pack.answerKey).toHaveLength(2);
    expect(pack.answerKey[0]).toMatchObject({ correctOptionId: expect.any(String) });
    expect(pack.rollNumbers).toEqual([1, 2, 3]);
    expect(JSON.stringify(pack)).not.toMatch(/Ravi|Meera|Anu/);
    expect(pack.offlineNotes.join(" ")).toMatch(/Needs a connection/);
    expect(pack.version).toMatch(/^[a-f0-9]{16}$/);
  });

  it("is reused while unused, and listed for the class", async () => {
    const again = await c.teacher.post(`${API}/lessons/${c.conceptId}/offline-packs`).send({ classId: c.classId });
    expect(again.body.id).toBe(pack.id);
    expect((await c.teacher.get(`${API}/classes/${c.classId}/offline-packs`)).body.packs).toHaveLength(1);
    expect((await c.teacher.get(`${API}/offline-packs/${pack.id}`)).body.version).toBe(pack.version);
  });

  it("is private to the class's teacher, and refuses lessons with no approved questions", async () => {
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await other.get(`${API}/offline-packs/${pack.id}`)).status).toBe(404);
    expect((await other.get(`${API}/classes/${c.classId}/offline-packs`)).status).toBe(404);
    expect((await other.post(`${API}/lessons/${c.conceptId}/offline-packs`).send({ classId: c.classId })).status).toBe(404);
    await db.update(questions).set({ reviewStatus: "draft" }).where(eq(questions.conceptId, c.conceptId));
    const fresh = await c.teacher.post(`${API}/classes`).send({ name: "6B", grade: 6, academicYear: "2026-27" });
    const none = await c.teacher.post(`${API}/lessons/${c.conceptId}/offline-packs`).send({ classId: fresh.body.id });
    expect(none.status).toBe(400);
  });
});

describe("sync", () => {
  it("applies recorded work once, as offline-synced evidence with the original time", async () => {
    const res = await sync(c.teacher, op("key-aaaaaaaa-1", 1));
    expect(res.status).toBe(200);
    expect(res.body.results[0]).toMatchObject({ idempotencyKey: "key-aaaaaaaa-1", status: "applied", attemptId: expect.any(String) });
    expect(await attempts()).toHaveLength(1);
    const evidence = await db.select().from(assessmentEvidence);
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((e) => e.source === "offline_synced")).toBe(true);
    expect(evidence[0]!.observedAt.toISOString()).toBe("2026-10-28T09:30:00.000Z");
  });

  it("a retried operation is a duplicate and writes nothing, however many times it is sent", async () => {
    await sync(c.teacher, op("key-aaaaaaaa-1", 1));
    const before = (await db.select().from(assessmentEvidence)).length;
    for (let i = 0; i < 3; i++) {
      const res = await sync(c.teacher, op("key-aaaaaaaa-1", 1));
      expect(res.body.results[0]).toMatchObject({ status: "duplicate", attemptId: expect.any(String) });
    }
    expect(await attempts()).toHaveLength(1);
    expect(await db.select().from(assessmentEvidence)).toHaveLength(before);
    expect(await db.select().from(syncOperations)).toHaveLength(1);
  });

  it("survives an interrupted sync: resending the whole queue applies only what is missing", async () => {
    const queue = [op("key-aaaaaaaa-1", 1), op("key-aaaaaaaa-2", 2), op("key-aaaaaaaa-3", 3)];
    await sync(c.teacher, queue[0]); // the connection dropped after the first one
    const res = await sync(c.teacher, ...queue); // the device cannot know that, so it sends everything again
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(["duplicate", "applied", "applied"]);
    expect(await attempts()).toHaveLength(3);
    const again = await sync(c.teacher, ...queue);
    expect(again.body.results.map((r: { status: string }) => r.status)).toEqual(["duplicate", "duplicate", "duplicate"]);
    expect(await attempts()).toHaveLength(3);
  });

  it("works for an activity that was never opened on the server, and for a closed one", async () => {
    expect((await db.select().from(assessments).where(eq(assessments.id, pack.assessmentId)))[0]!.status).toBe("approved");
    expect((await sync(c.teacher, op("key-aaaaaaaa-1", 1))).body.results[0].status).toBe("applied");
    await db.update(assessments).set({ status: "closed" }).where(eq(assessments.id, pack.assessmentId));
    expect((await sync(c.teacher, op("key-aaaaaaaa-2", 2))).body.results[0].status).toBe("applied");
  });

  it("never overwrites what the server already holds: it becomes a conflict, which can only be discarded", async () => {
    await db.update(assessments).set({ status: "open" }).where(eq(assessments.id, pack.assessmentId));
    await c.teacher.post(`${API}/assessments/${pack.assessmentId}/entry`).send({ entries: [{ studentId: c.students[0]!.id, answers: [{ questionId: pack.questions[0].id, answer: { kind: "option", optionId: "a" } }] }] });
    const evidenceBefore = await db.select().from(assessmentEvidence);

    const res = await sync(c.teacher, op("key-aaaaaaaa-1", 1));
    expect(res.body.results[0]).toMatchObject({ status: "conflict", conflictId: expect.any(String) });
    expect(await attempts()).toHaveLength(1);
    expect(await db.select().from(assessmentEvidence)).toEqual(evidenceBefore);

    const list = (await c.teacher.get(`${API}/sync/conflicts`)).body.conflicts;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ reason: "already_answered", rosterNumber: 1, studentName: "Ravi", canApply: false, responseCount: 2 });
    expect((await c.teacher.post(`${API}/sync/conflicts/${list[0].id}/resolve`).send({ action: "apply" })).status).toBe(409);
    expect((await c.teacher.post(`${API}/sync/conflicts/${list[0].id}/resolve`).send({ action: "discard" })).body.status).toBe("discarded");
    expect((await c.teacher.get(`${API}/sync/conflicts`)).body.conflicts).toHaveLength(0);
    expect(await attempts()).toHaveLength(1);
    // Resending the discarded operation does not bring it back.
    expect((await sync(c.teacher, op("key-aaaaaaaa-1", 1))).body.results[0].status).toBe("duplicate");
    expect(await attempts()).toHaveLength(1);
  });

  it("holds work for a changed question set as a conflict; applying merges only the questions still there", async () => {
    // The teacher edits the activity after the pack was prepared: one question swapped.
    const links = await db.select().from(assessmentQuestions).where(eq(assessmentQuestions.assessmentId, pack.assessmentId));
    const removed = links.find((l) => l.questionId === pack.questions[1].id)!;
    await db.delete(assessmentQuestions).where(eq(assessmentQuestions.id, removed.id));

    const res = await sync(c.teacher, op("key-aaaaaaaa-1", 2));
    expect(res.body.results[0].status).toBe("conflict");
    expect(await attempts()).toHaveLength(0);

    const [conflict] = (await c.teacher.get(`${API}/sync/conflicts`)).body.conflicts;
    expect(conflict).toMatchObject({ reason: "pack_stale", canApply: true });
    const applied = await c.teacher.post(`${API}/sync/conflicts/${conflict.id}/resolve`).send({ action: "apply" });
    expect(applied.body.status).toBe("applied");
    expect(await attempts()).toHaveLength(1);
    const evidenceQuestions = await db.select().from(assessmentEvidence);
    expect(evidenceQuestions.length).toBeGreaterThan(0);
    expect((await c.teacher.get(`${API}/sync/status`)).body).toMatchObject({ applied: 1, conflicts: 0 });
    // Resolving twice is not possible.
    expect((await c.teacher.post(`${API}/sync/conflicts/${conflict.id}/resolve`).send({ action: "apply" })).status).toBe(404);
  });

  it("rejects, with a reason, what can never succeed", async () => {
    const results = (
      await sync(
        c.teacher,
        op("key-aaaaaaaa-1", 99), // no such roll number
        op("key-aaaaaaaa-2", 1, { payload: { assessmentId: "00000000-0000-4000-8000-000000000000", rosterNumber: 1, responses: [{ questionId: pack.questions[0].id, answer: { kind: "blank" } }] } }),
      )
    ).body.results;
    expect(results.map((r: { status: string }) => r.status)).toEqual(["rejected", "rejected"]);
    expect(results[0].message).toMatch(/roll number 99/);
    expect(await attempts()).toHaveLength(0);
    expect((await c.teacher.get(`${API}/sync/status`)).body.rejected).toBe(2);

    await db.update(assessments).set({ status: "draft" }).where(eq(assessments.id, pack.assessmentId));
    expect((await sync(c.teacher, op("key-aaaaaaaa-3", 1))).body.results[0]).toMatchObject({ status: "rejected", message: expect.stringMatching(/not been approved/) });
  });

  it("rejects an answer to a question that is not in the activity, writing nothing", async () => {
    const other = c.qid("q-sf-1");
    const res = await sync(c.teacher, op("key-aaaaaaaa-1", 1, {}, [[other, "a"]]));
    expect(res.body.results[0].status).toBe("rejected");
    expect(await attempts()).toHaveLength(0);
  });

  it("is private to the teacher: another teacher's operations on this class are rejected, and keys cannot be hijacked", async () => {
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await sync(other, op("key-bbbbbbbb-1", 1))).body.results[0]).toMatchObject({ status: "rejected" });
    expect(await attempts()).toHaveLength(0);
    await sync(c.teacher, op("key-aaaaaaaa-1", 1));
    expect((await sync(other, op("key-aaaaaaaa-1", 1))).body.results[0]).toMatchObject({ status: "rejected", message: expect.stringMatching(/already in use/) });
    expect((await other.get(`${API}/sync/conflicts`)).body.conflicts).toEqual([]);
    expect((await other.get(`${API}/sync/status`)).body).toMatchObject({ applied: 0 });
  });

  it("validates the request and requires sign-in", async () => {
    expect((await c.teacher.post(`${API}/sync/operations`).send({ operations: [] })).status).toBe(400);
    expect((await sync(c.teacher, { ...op("short", 1) })).status).toBe(400); // key too short
    expect((await sync(c.teacher, op("key-aaaaaaaa-1", 1, { type: "delete_everything" }))).status).toBe(400);
    const anonymous = (await import("supertest")).default(app);
    expect((await anonymous.post(`${API}/sync/operations`).send({ operations: [op("key-aaaaaaaa-1", 1)] })).status).toBe(401);
    expect((await anonymous.get(`${API}/sync/status`)).status).toBe(401);
  });
});
