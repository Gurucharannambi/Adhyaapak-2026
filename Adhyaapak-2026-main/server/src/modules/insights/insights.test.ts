import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import type { AssessmentEvidence } from "@adhyaapak/shared";
import { concepts, questions } from "../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { seedBook } from "../curriculum/seed/book";
import { growthGroups } from "./growth";
import { reviewOf, trackOutcome } from "./atlas.service";

const ev = (over: Partial<AssessmentEvidence> & Pick<AssessmentEvidence, "studentId" | "conceptId" | "result" | "observedAt">): AssessmentEvidence => ({
  id: crypto.randomUUID(),
  questionResponseId: crypto.randomUUID(),
  source: "device_response",
  difficulty: 2,
  confidence: "high",
  reviewStatus: "not_required",
  ...over,
});

describe("growth rules (pure)", () => {
  const now = new Date("2026-10-29T10:00:00Z");
  const base = { students: [{ id: "s1", name: "Ravi" }, { id: "s2", name: "Meera" }], conceptTitle: new Map([["c1", "Equivalent fractions"]]), practiceSets: new Map<string, number>(), now };

  it("names improvement only against the student's own start: early mistakes, latest two right, enough answers", () => {
    const answers = (results: Array<"correct" | "incorrect">, sid = "s1") => results.map((result, i) => ev({ studentId: sid, conceptId: "c1", result, observedAt: `2026-10-2${i}T09:00:00.000Z` }));
    const g = growthGroups({ ...base, mastery: [], evidence: [...answers(["incorrect", "correct", "correct", "correct"]), ...answers(["incorrect", "correct", "correct"], "s2")] });
    const improved = g.find((x) => x.key === "improved")!.students;
    expect(improved.map((s) => s.name)).toEqual(["Ravi"]); // Meera has only three answers: not enough to say
    expect(improved[0]!.why).toMatch(/latest two were right \(4 counted answers\)/);
  });

  it("does not count evidence that cannot affect mastery (pending review, unreadable)", () => {
    const g = growthGroups({ ...base, mastery: [], evidence: [ev({ studentId: "s1", conceptId: "c1", result: "incorrect", observedAt: "2026-10-20T09:00:00.000Z" }), ...[1, 2, 3].map((i) => ev({ studentId: "s1", conceptId: "c1", result: "correct", reviewStatus: "pending", observedAt: `2026-10-2${i}T09:00:00.000Z` }))] });
    expect(g.find((x) => x.key === "improved")!.students).toEqual([]);
  });

  it("uses mastery statuses with stated thresholds, and says 'needs explanation' about the idea, not the child", () => {
    const g = growthGroups({
      ...base,
      evidence: [],
      mastery: [
        { studentId: "s1", conceptId: "c1", status: "ready_for_challenge", evidenceCount: 5, lastEvidenceAt: now },
        { studentId: "s2", conceptId: "c1", status: "needs_foundation", evidenceCount: 1, lastEvidenceAt: now },
      ],
    });
    expect(g.find((x) => x.key === "ready_for_challenge")!.students[0]!.why).toMatch(/5 counted answers/);
    expect(g.find((x) => x.key === "needs_explanation")!.students).toEqual([]); // one answer is not enough
  });

  it("only mentions practice when practice sets were recorded", () => {
    const g = growthGroups({ ...base, mastery: [], evidence: [], practiceSets: new Map([["s1", 3], ["s2", 1]]) });
    expect(g.find((x) => x.key === "practice")!.students.map((s) => s.name)).toEqual(["Ravi"]);
  });
});

describe("atlas rules (pure)", () => {
  it("never calls a pattern resolved without new evidence, and needs two right answers to say 'demonstrated'", () => {
    expect(trackOutcome([], "p")).toBe("no_new_evidence");
    expect(trackOutcome([{ result: "correct" }], "p")).toBe("partial");
    expect(trackOutcome([{ result: "correct" }, { result: "correct" }], "p")).toBe("demonstrated");
    expect(trackOutcome([{ result: "correct" }, { result: "incorrect", matchedMisconceptionPatternId: "p" }], "p")).toBe("same_error");
    expect(trackOutcome([{ result: "incorrect" }], "p")).toBe("other_error");
  });

  it("derives a student's review state from all of their observations", () => {
    expect(reviewOf(["candidate"])).toBe("open");
    expect(reviewOf(["inconclusive", "candidate"])).toBe("open"); // a new answer reopens it
    expect(reviewOf(["inconclusive"])).toBe("inconclusive");
    expect(reviewOf(["rejected"])).toBe("dismissed");
    expect(reviewOf(["likely", "confirmed"])).toBe("confirmed");
  });
});

const API = "/api/v1";
const { app, db, pool } = buildTestApp();
afterAll(() => pool.end());
type Agent = ReturnType<typeof request.agent>;

beforeEach(async () => {
  await resetDb(db);
  await seedBook(db);
});

async function setup(agent: Agent, n = 4) {
  const classId = (await agent.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body.id as string;
  const studentIds: string[] = [];
  for (let i = 1; i <= n; i++) studentIds.push((await agent.post(`${API}/classes/${classId}/students`).send({ name: `Student ${i}` })).body.id);
  const [concept] = await db.select().from(concepts).where(eq(concepts.key, "adding-fractions"));
  const qs = await db.select().from(questions).where(and(eq(questions.conceptId, concept!.id), inArray(questions.key, ["q-af-1", "q-af-2"])));
  const byKey = new Map(qs.map((q) => [q.key, q]));
  return { classId, studentIds, conceptId: concept!.id, q1: byKey.get("q-af-1")!, q2: byKey.get("q-af-2")! };
}

type Q = typeof questions.$inferSelect;
const tagged = (q: Q) => q.options.find((o) => o.misconceptionKey === "adds-denominators")!.id;

/** A whole class check through the real API: create, approve, open, key answers, close. */
async function runCheck(agent: Agent, classId: string, q: Q, answers: Record<string, "right" | "pattern">) {
  const a = (await agent.post(`${API}/classes/${classId}/assessments`).send({ title: `Check ${q.key}`, type: "diagnostic", questionIds: [q.id] })).body;
  await agent.post(`${API}/assessments/${a.id}/status`).send({ to: "approved" });
  await agent.post(`${API}/assessments/${a.id}/status`).send({ to: "open" });
  const entries = Object.entries(answers).map(([studentId, kind]) => ({ studentId, answers: [{ questionId: q.id, answer: { kind: "option", optionId: kind === "right" ? q.correctOptionId : tagged(q) } }] }));
  expect((await agent.post(`${API}/assessments/${a.id}/entry`).send({ entries })).status).toBe(200);
  await agent.post(`${API}/assessments/${a.id}/status`).send({ to: "closed" });
  return a.id as string;
}

describe("Misconception Atlas workspace", () => {
  it("keeps a single wrong answer as a single observation: shown, but not counted as needing investigation", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    await runCheck(agent, c.classId, c.q1, { [c.studentIds[0]!]: "pattern", [c.studentIds[1]!]: "right" });
    const w = (await agent.get(`${API}/classes/${c.classId}/atlas`)).body;
    expect(w.records).toHaveLength(1);
    expect(w.records[0].strength).toBe("single");
    expect(w.records[0].affected).toBe(1);
    expect(w.records[0].answeredOnConcept).toBe(2); // the honest denominator: students who answered on the concept
    expect(w.summary).toEqual({ needsInvestigation: 0, conceptsToRevisit: 0, awaitingReview: 0 });
  });

  it("shows repeated evidence with the real answers, and tracks what later answers say", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    const [s1, s2] = c.studentIds as [string, string];
    await runCheck(agent, c.classId, c.q1, { [s1]: "pattern", [s2]: "pattern" });
    await runCheck(agent, c.classId, c.q2, { [s1]: "pattern", [s2]: "right" });
    let r = (await agent.get(`${API}/classes/${c.classId}/atlas`)).body.records[0];
    expect(r.strength).toBe("repeated");
    expect(r.repeated).toBe(1);
    expect(r.checks).toBe(2);
    expect(r.responses).toHaveLength(3);
    const first = r.responses.find((x: { studentId: string }) => x.studentId === s1);
    expect(first.answer).not.toBe(first.expected);
    expect(r.students.find((x: { id: string }) => x.id === s2).outcome).toBe("partial"); // one right answer is not "demonstrated"

    // Two more right answers for Student 2 after the pattern: understanding demonstrated.
    await runCheck(agent, c.classId, c.q1, { [s2]: "right" });
    r = (await agent.get(`${API}/classes/${c.classId}/atlas`)).body.records[0];
    expect(r.students.find((x: { id: string }) => x.id === s2).outcome).toBe("demonstrated");
    expect(r.students.find((x: { id: string }) => x.id === s1).outcome).toBe("no_new_evidence");
  });

  it("lets the teacher mark evidence inconclusive or dismiss it, keeping the evidence, and summary counts follow", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    const [s1, s2] = c.studentIds as [string, string];
    await runCheck(agent, c.classId, c.q1, { [s1]: "pattern", [s2]: "pattern" });
    await runCheck(agent, c.classId, c.q2, { [s1]: "pattern", [s2]: "pattern" });
    const before = (await agent.get(`${API}/classes/${c.classId}/atlas`)).body;
    expect(before.summary).toEqual({ needsInvestigation: 2, conceptsToRevisit: 1, awaitingReview: 2 });
    const patternId = before.records[0].patternId;

    expect((await agent.post(`${API}/classes/${c.classId}/misconceptions/review`).send({ studentId: s1, patternId, decision: "inconclusive" })).status).toBe(200);
    expect((await agent.post(`${API}/classes/${c.classId}/misconceptions/review`).send({ studentId: s2, patternId, decision: "reject" })).status).toBe(200);
    const after = (await agent.get(`${API}/classes/${c.classId}/atlas`)).body;
    expect(after.records[0].review).toMatchObject({ inconclusive: 1, dismissed: 1, open: 0 });
    expect(after.records[0].affected).toBe(1); // dismissed students no longer count; their evidence is still stored
    expect(after.summary.awaitingReview).toBe(0);
    // The class misconception list no longer offers set-aside evidence for confirmation.
    expect((await agent.get(`${API}/classes/${c.classId}/misconceptions`)).body.patterns).toEqual([]);
  });

  it("is private to the class's teacher", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await other.get(`${API}/classes/${c.classId}/atlas`)).status).toBe(404);
    expect((await other.get(`${API}/classes/${c.classId}/insights`)).status).toBe(404);
    expect((await request(app).get(`${API}/classes/${c.classId}/atlas`)).status).toBe(401);
  });
});

describe("Insights", () => {
  it("counts every student-and-concept pair once, treats no answers as not enough evidence, and compares the last two checks", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent, 4);
    const [s1, s2] = c.studentIds as [string, string];
    await runCheck(agent, c.classId, c.q1, { [s1]: "pattern", [s2]: "right" });
    await runCheck(agent, c.classId, c.q2, { [s1]: "right", [s2]: "right" });
    const i = (await agent.get(`${API}/classes/${c.classId}/insights`)).body;
    expect(i.studentCount).toBe(4);
    const total = Object.values(i.distribution.byStatus as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(total).toBe(i.distribution.cells);
    const concept = i.concepts.find((x: { id: string }) => x.id === c.conceptId);
    expect(concept.assessed).toBe(2);
    expect(concept.counts.not_enough_evidence).toBeGreaterThanOrEqual(2); // the two who never answered
    expect(concept.trend.latest).toMatchObject({ right: 2, of: 2 });
    expect(concept.trend.previous).toMatchObject({ right: 1, of: 2 });
    expect(i.practiceRecorded).toBe(false);
  });

  it("lists checks across the teacher's own classes only", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    await runCheck(agent, c.classId, c.q1, { [c.studentIds[0]!]: "right" });
    const mine = (await agent.get(`${API}/assessments`)).body.assessments;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ classId: c.classId, className: "6A", submittedCount: 1 });
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await other.get(`${API}/assessments`)).body.assessments).toEqual([]);
  });

  it("returns this school week on the dashboard: Monday to Saturday, with lessons only from today on", async () => {
    const agent = await signedInAgent(app);
    await setup(agent);
    const d = (await agent.get(`${API}/dashboard`)).body;
    expect(d.weekStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const days = new Set(d.week.map((p: { date: string }) => p.date));
    expect(days.size).toBeLessThanOrEqual(6);
    for (const p of d.week as Array<{ date: string; lesson: unknown }>) expect(p.date >= d.weekStart).toBe(true);
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    for (const p of d.week as Array<{ date: string; lesson: unknown }>) if (p.date < iso) expect(p.lesson).toBeNull();
  });
});
