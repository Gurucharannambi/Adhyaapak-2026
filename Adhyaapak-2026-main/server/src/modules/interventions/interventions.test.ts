import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assessments, concepts, interventions, questions } from "../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { seedFractionsClass6 } from "../curriculum/seed/seed";

const { app, db, pool } = buildTestApp();
afterAll(() => pool.end());
const API = "/api/v1";

type Agent = Awaited<ReturnType<typeof signedInAgent>>;
interface Ctx {
  teacher: Agent;
  classId: string;
  students: Record<string, string>; // name -> id
  cid: (key: string) => string;
  qid: (key: string) => string;
}

async function setup(): Promise<Ctx> {
  await resetDb(db);
  await seedFractionsClass6(db);
  const teacher = await signedInAgent(app);
  const cls = (await teacher.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body;
  for (const name of ["Ravi", "Meera", "Anu", "Kiran"]) await teacher.post(`${API}/classes/${cls.id}/students`).send({ name });
  const list = (await teacher.get(`${API}/classes/${cls.id}/students`)).body.students as { id: string; name: string }[];
  const cs = new Map((await db.select().from(concepts)).map((c) => [c.key, c.id]));
  const qs = new Map((await db.select().from(questions)).map((q) => [q.key, q.id]));
  return { teacher, classId: cls.id, students: Object.fromEntries(list.map((s) => [s.name, s.id])), cid: (k) => cs.get(k)!, qid: (k) => qs.get(k)! };
}

const opt = (qid: string, optionId: string, confidence: "sure" | "unsure" | "guess" = "sure") => ({ questionId: qid, answer: { kind: "option" as const, optionId }, confidence });

/** Opens an activity, keys in answers for several students, and closes it. */
async function runActivity(c: Ctx, keys: string[], answers: Record<string, string[]>) {
  const id = (await c.teacher.post(`${API}/classes/${c.classId}/assessments`).send({ title: `Check ${keys.join(",")}`, type: "diagnostic", questionIds: keys.map(c.qid) })).body.id as string;
  await c.teacher.post(`${API}/assessments/${id}/status`).send({ to: "approved" });
  await c.teacher.post(`${API}/assessments/${id}/status`).send({ to: "open" });
  const entries = Object.entries(answers).map(([name, picks]) => ({ studentId: c.students[name]!, answers: keys.map((k, i) => opt(c.qid(k), picks[i]!)) }));
  const res = await c.teacher.post(`${API}/assessments/${id}/entry`).send({ entries });
  expect(res.body.failed).toEqual([]);
  await c.teacher.post(`${API}/assessments/${id}/status`).send({ to: "closed" });
  return id;
}

/** Ravi adds denominators twice (needs foundation + pattern); Meera is correct twice (developing). */
async function standardClass(c: Ctx) {
  return runActivity(c, ["q-af-1", "q-af-2"], { Ravi: ["a", "a"], Meera: ["b", "b"] });
}

const board = (c: Ctx, concept = "adding-fractions") => c.teacher.get(`${API}/classes/${c.classId}/branch-board?conceptId=${c.cid(concept)}`);
const ids = (cards: { name: string }[]) => cards.map((x) => x.name).sort();

describe("Branch Board", () => {
  let c: Ctx;
  beforeEach(async () => (c = await setup()));

  it("is empty with no assessed concepts", async () => {
    const res = await c.teacher.get(`${API}/classes/${c.classId}/branch-board`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ conceptId: null, concepts: [] });
  });

  it("places students in lanes from stored evidence, never from a single wrong answer", async () => {
    await standardClass(c);
    const { body } = await board(c);
    expect(ids(body.lanes.foundation)).toEqual(["Ravi"]);
    expect(ids(body.lanes.guided)).toEqual(["Meera"]);
    // Anu and Kiran have no evidence: they get a follow-up check, not a label.
    expect(ids(body.lanes.follow_up)).toEqual(["Anu", "Kiran"]);
    expect(body.lanes.challenge).toEqual([]);

    const ravi = body.lanes.foundation[0];
    expect(ravi).toMatchObject({ status: "needs_foundation", activity: "prerequisite_diagnostic", targetConceptTitle: "Finding a common denominator", suggestedMinutes: 15, assigned: null });
    expect(ravi.reason).toMatch(/Adds the denominators/);
    expect(body.lanes.follow_up[0].reason).toMatch(/no reviewed evidence/);
  });

  it("one wrong answer from a student lands in the follow-up lane, not foundation", async () => {
    await runActivity(c, ["q-af-1"], { Ravi: ["a"] });
    const { body } = await board(c);
    expect(ids(body.lanes.foundation)).toEqual([]);
    expect(body.lanes.follow_up.map((x: { name: string }) => x.name)).toContain("Ravi");
  });

  it("lists the concepts that have evidence for the picker, and defaults to the first", async () => {
    await standardClass(c);
    const res = await c.teacher.get(`${API}/classes/${c.classId}/branch-board`);
    expect(res.body.concepts.map((x: { title: string }) => x.title)).toContain("Adding fractions");
    expect(res.body.conceptId).toBeTruthy();
  });

  it("404 for another teacher and for unknown concepts", async () => {
    await standardClass(c);
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await other.get(`${API}/classes/${c.classId}/branch-board`)).status).toBe(404);
    expect((await c.teacher.get(`${API}/classes/${c.classId}/branch-board?conceptId=00000000-0000-4000-8000-000000000000`)).status).toBe(404);
    expect((await c.teacher.get(`${API}/classes/${c.classId}/branch-board?conceptId=nope`)).status).toBe(404);
  });
});

describe("assigning activities", () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await setup();
    await standardClass(c);
  });
  const assign = (assignments: object[]) => c.teacher.post(`${API}/classes/${c.classId}/interventions`).send({ conceptId: c.cid("adding-fractions"), assignments });

  it("stores the system's recommendation, the final choice and a snapshot of the student's state", async () => {
    const res = await assign([
      { studentId: c.students.Ravi, groupKey: "foundation" },
      { studentId: c.students.Meera, groupKey: "guided", note: "Use the fraction bars" },
    ]);
    expect(res.status).toBe(201);
    expect(res.body.assigned).toHaveLength(2);

    const rows = await db.select().from(interventions);
    const ravi = rows.find((r) => r.studentId === c.students.Ravi)!;
    expect(ravi).toMatchObject({
      groupKey: "foundation",
      recommendedGroupKey: "foundation",
      activityType: "prerequisite_diagnostic",
      targetConceptId: c.cid("common-denominator"),
      movedReason: null,
      statusAtAssignment: "not_enough_evidence", // the prerequisite has no evidence yet
      policyVersion: "policy-1.0.0",
    });
    expect(ravi.reason).toMatch(/Adds the denominators/);
    // The probe is recommended because of his two answers on the lesson concept, so those are the cited evidence.
    expect(ravi.evidenceIds).toHaveLength(2);
    const meera = rows.find((r) => r.studentId === c.students.Meera)!;
    expect(meera).toMatchObject({ activityType: "guided_practice", targetConceptId: c.cid("adding-fractions"), statusAtAssignment: "developing", teacherNote: "Use the fraction bars" });
    expect(meera.evidenceIds.length).toBe(2);
  });

  it("requires a reason to move someone away from the suggested group, and saves nothing otherwise", async () => {
    const res = await assign([
      { studentId: c.students.Meera, groupKey: "guided" },
      { studentId: c.students.Ravi, groupKey: "challenge" },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/say why you moved: Ravi/);
    expect(await db.select().from(interventions)).toHaveLength(0);
  });

  it("keeps a moved student's reason as signal and gives them the default activity for the new group", async () => {
    const res = await assign([{ studentId: c.students.Ravi, groupKey: "guided", movedReason: "He explained it well in class" }]);
    expect(res.status).toBe(201);
    const [row] = await db.select().from(interventions);
    expect(row).toMatchObject({ groupKey: "guided", recommendedGroupKey: "foundation", recommendedActivityType: "prerequisite_diagnostic", activityType: "guided_practice", targetConceptId: c.cid("adding-fractions"), movedReason: "He explained it well in class" });
  });

  it("skips duplicates and students outside the class instead of failing everything", async () => {
    await assign([{ studentId: c.students.Meera, groupKey: "guided" }]);
    const res = await assign([
      { studentId: c.students.Meera, groupKey: "guided" },
      { studentId: c.students.Anu, groupKey: "follow_up" },
      { studentId: "00000000-0000-4000-8000-000000000009", groupKey: "guided" },
    ]);
    expect(res.body.assigned).toHaveLength(1);
    expect(res.body.skipped.map((s: { message: string }) => s.message)).toEqual(expect.arrayContaining([expect.stringMatching(/Already has an active/), expect.stringMatching(/not in the class/)]));
  });

  it("marks assigned cards on the board", async () => {
    await assign([{ studentId: c.students.Meera, groupKey: "guided" }]);
    const meera = (await board(c)).body.lanes.guided.find((x: { name: string }) => x.name === "Meera");
    expect(meera.assigned).toMatchObject({ groupKey: "guided", followUpAssessmentId: null });
  });

  it("validates input and is teacher-only with ownership", async () => {
    expect((await assign([])).status).toBe(400);
    expect((await assign([{ studentId: c.students.Ravi, groupKey: "nonsense" }])).status).toBe(400);
    const other = await signedInAgent(app, "other@example.com", "Other");
    const res = await other.post(`${API}/classes/${c.classId}/interventions`).send({ conceptId: c.cid("adding-fractions"), assignments: [{ studentId: c.students.Meera, groupKey: "guided" }] });
    expect(res.status).toBe(404);
  });

  it("writes an audit record for the decision", async () => {
    await assign([{ studentId: c.students.Ravi, groupKey: "guided", movedReason: "Teacher judgement" }]);
    const { auditLog } = await import("../../db/schema");
    const row = (await db.select().from(auditLog)).find((r) => r.action === "intervention.assign");
    expect(row?.metadata).toMatchObject({ count: 1, moved: 1 });
  });
});

describe("follow-up, effectiveness and finishing", () => {
  let c: Ctx;
  beforeEach(async () => {
    c = await setup();
    await standardClass(c);
  });
  const assignRavi = () => c.teacher.post(`${API}/classes/${c.classId}/interventions`).send({ conceptId: c.cid("adding-fractions"), assignments: [{ studentId: c.students.Ravi, groupKey: "foundation" }] });
  const list = async () => (await c.teacher.get(`${API}/classes/${c.classId}/interventions?conceptId=${c.cid("adding-fractions")}`)).body.interventions as Array<{ id: string; effect: { outcome: string; newEvidenceCount: number; before: { status: string }; after: { status: string } }; followUpAssessmentId: string | null; status: string }>;

  it("says 'not enough evidence' straight after assigning: no claim of improvement", async () => {
    await assignRavi();
    const [i] = await list();
    expect(i!.effect).toMatchObject({ outcome: "not_enough_evidence", newEvidenceCount: 0 });
  });

  it("creates a follow-up from questions the student has not seen, approved but not yet open, and links it", async () => {
    const r = await assignRavi();
    const interventionId = r.body.assigned[0].interventionId;
    const res = await c.teacher.post(`${API}/classes/${c.classId}/interventions/follow-up`).send({ conceptId: c.cid("adding-fractions"), interventionIds: [interventionId] });
    expect(res.status).toBe(201);
    expect(res.body.questionCount).toBe(2);

    const detail = (await c.teacher.get(`${API}/assessments/${res.body.assessmentId}`)).body;
    expect(detail).toMatchObject({ type: "follow_up", status: "approved" });
    expect(detail.questions.map((q: { key: string }) => q.key).sort()).toEqual(["q-cd-1", "q-cd-2"]);
    expect((await list())[0]!.followUpAssessmentId).toBe(res.body.assessmentId);
  });

  it("refuses to repeat questions: with too few new ones left it says so instead of reusing old items", async () => {
    const r = await c.teacher.post(`${API}/classes/${c.classId}/interventions`).send({ conceptId: c.cid("adding-fractions"), assignments: [{ studentId: c.students.Meera, groupKey: "guided" }] });
    const res = await c.teacher.post(`${API}/classes/${c.classId}/interventions/follow-up`).send({ conceptId: c.cid("adding-fractions"), interventionIds: [r.body.assigned[0].interventionId] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/not enough new questions/);
  });

  it("measures the effect from counted answers after the activity: first evidence is 'evidence gathered', not 'improved'", async () => {
    const r = await assignRavi();
    const fu = (await c.teacher.post(`${API}/classes/${c.classId}/interventions/follow-up`).send({ conceptId: c.cid("adding-fractions"), interventionIds: [r.body.assigned[0].interventionId] })).body.assessmentId as string;
    await c.teacher.post(`${API}/assessments/${fu}/status`).send({ to: "open" });
    const detail = (await c.teacher.get(`${API}/assessments/${fu}`)).body;
    const entries = [{ studentId: c.students.Ravi, answers: detail.questions.map((q: { id: string; correctOptionId: string }) => opt(q.id, q.correctOptionId)) }];
    expect((await c.teacher.post(`${API}/assessments/${fu}/entry`).send({ entries })).body.saved).toHaveLength(1);

    const [i] = await list();
    expect(i!.effect).toMatchObject({ outcome: "evidence_gathered", newEvidenceCount: 2, before: { status: "not_enough_evidence" }, after: { status: "developing" } });
  });

  it("one new answer is still not enough to say anything", async () => {
    const r = await assignRavi();
    const fu = (await c.teacher.post(`${API}/classes/${c.classId}/interventions/follow-up`).send({ conceptId: c.cid("adding-fractions"), interventionIds: [r.body.assigned[0].interventionId] })).body.assessmentId as string;
    await c.teacher.post(`${API}/assessments/${fu}/status`).send({ to: "open" });
    const detail = (await c.teacher.get(`${API}/assessments/${fu}`)).body;
    const q = detail.questions[0];
    await c.teacher.post(`${API}/assessments/${fu}/entry`).send({ entries: [{ studentId: c.students.Ravi, answers: [opt(q.id, q.correctOptionId), { questionId: detail.questions[1].id, answer: { kind: "blank" } }] }] });
    expect((await list())[0]!.effect).toMatchObject({ outcome: "not_enough_evidence", newEvidenceCount: 1 });
  });

  it("completes or dismisses once, frees the student for a new activity, and keeps the record", async () => {
    const r = await assignRavi();
    const id = r.body.assigned[0].interventionId;
    expect((await c.teacher.post(`${API}/interventions/${id}/finish`).send({ to: "completed" })).status).toBe(200);
    expect((await c.teacher.post(`${API}/interventions/${id}/finish`).send({ to: "dismissed" })).status).toBe(409);
    expect((await assignRavi()).body.assigned).toHaveLength(1);
    expect((await list()).map((x) => x.status).sort()).toEqual(["assigned", "completed"]);
  });

  it("another teacher cannot finish or follow up someone else's activity (404)", async () => {
    const r = await assignRavi();
    const id = r.body.assigned[0].interventionId;
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await other.post(`${API}/interventions/${id}/finish`).send({ to: "completed" })).status).toBe(404);
    expect((await other.post(`${API}/classes/${c.classId}/interventions/follow-up`).send({ conceptId: c.cid("adding-fractions"), interventionIds: [id] })).status).toBe(404);
    expect((await other.get(`${API}/classes/${c.classId}/interventions`)).status).toBe(404);
  });

  it("refuses a follow-up for finished activities", async () => {
    const r = await assignRavi();
    const id = r.body.assigned[0].interventionId;
    await c.teacher.post(`${API}/interventions/${id}/finish`).send({ to: "completed" });
    expect((await c.teacher.post(`${API}/classes/${c.classId}/interventions/follow-up`).send({ conceptId: c.cid("adding-fractions"), interventionIds: [id] })).status).toBe(409);
  });

  it("does not let the follow-up assessment be opened while another activity is open", async () => {
    const r = await assignRavi();
    const fu = (await c.teacher.post(`${API}/classes/${c.classId}/interventions/follow-up`).send({ conceptId: c.cid("adding-fractions"), interventionIds: [r.body.assigned[0].interventionId] })).body.assessmentId as string;
    const other = (await c.teacher.post(`${API}/classes/${c.classId}/assessments`).send({ title: "x", type: "diagnostic", questionIds: [c.qid("q-sf-1")] })).body.id;
    await c.teacher.post(`${API}/assessments/${other}/status`).send({ to: "approved" });
    await c.teacher.post(`${API}/assessments/${other}/status`).send({ to: "open" });
    expect((await c.teacher.post(`${API}/assessments/${fu}/status`).send({ to: "open" })).status).toBe(409);
    expect((await db.select().from(assessments).where(eq(assessments.id, fu)))[0]!.status).toBe("approved");
  });
});

describe("student history", () => {
  it("tells the story from stored records, newest first, with the current status per concept", async () => {
    const c = await setup();
    await standardClass(c);
    await c.teacher.post(`${API}/classes/${c.classId}/interventions`).send({ conceptId: c.cid("adding-fractions"), assignments: [{ studentId: c.students.Ravi, groupKey: "guided", movedReason: "Trying guided practice first" }] });
    const patterns = (await c.teacher.get(`${API}/classes/${c.classId}/misconceptions`)).body.patterns;
    await c.teacher.post(`${API}/classes/${c.classId}/misconceptions/review`).send({ studentId: c.students.Ravi, patternId: patterns[0].patternId, decision: "confirm" });

    const h = (await c.teacher.get(`${API}/classes/${c.classId}/students/${c.students.Ravi}/history`)).body;
    expect(h.student).toMatchObject({ name: "Ravi", rosterNumber: 1 });
    expect(h.mastery).toEqual([expect.objectContaining({ title: "Adding fractions", status: "needs_foundation", evidenceCount: 2 })]);

    const kinds = h.timeline.map((t: { kind: string }) => t.kind);
    expect(kinds).toEqual(expect.arrayContaining(["answered", "pattern_seen", "pattern_reviewed", "activity_assigned"]));
    expect([...h.timeline].map((t: { at: string }) => t.at)).toEqual([...h.timeline.map((t: { at: string }) => t.at)].sort().reverse());
    const text = h.timeline.map((t: { text: string }) => t.text).join("\n");
    expect(text).toMatch(/Teacher confirmed the pattern “Adds the denominators”/);
    expect(text).toMatch(/moved from the suggested group: Trying guided practice first/);
  });

  it("404 for other teachers, unknown students and students of another class", async () => {
    const c = await setup();
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await other.get(`${API}/classes/${c.classId}/students/${c.students.Ravi}/history`)).status).toBe(404);
    expect((await c.teacher.get(`${API}/classes/${c.classId}/students/00000000-0000-4000-8000-000000000009/history`)).status).toBe(404);
    expect((await c.teacher.get(`${API}/classes/${c.classId}/students/not-a-uuid/history`)).status).toBe(404);
  });
});

describe("board default concept", () => {
  it("defaults to the concept most students have answers on, not the first concept with any evidence", async () => {
    const c = await setup();
    await standardClass(c); // both Ravi and Meera answered "adding fractions"; only Meera also earned credit on "common denominator"
    const res = await c.teacher.get(`${API}/classes/${c.classId}/branch-board`);
    expect(res.body.conceptId).toBe(c.cid("adding-fractions"));
  });
});
