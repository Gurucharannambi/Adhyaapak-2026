import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import { aiRuns, assessments, concepts, interventions, learningResources, questions } from "../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { ScriptedProvider } from "../../test/scripted-provider";
import { seedBook } from "../curriculum/seed/book";
import { UnavailableProvider } from "../ai/mesh-provider";
import { pending } from "./agent.service";

const API = "/api/v1";
const ai = new ScriptedProvider();
const { app, db, pool } = buildTestApp(ai);
afterAll(() => pool.end());
type Agent = ReturnType<typeof request.agent>;
type Q = typeof questions.$inferSelect;

beforeEach(async () => {
  await resetDb(db);
  await seedBook(db);
  ai.reset();
});

const args = (o: Partial<{ concept: string; pattern: string; level: "foundation" | "guided" | "challenge"; count: number }> = {}) => ({ concept: null, pattern: null, level: null, count: null, ...o });
const step = (tool: string, a = args(), reason = "Next I need this.") => ({ reason, tool, args: a });

async function setup(agent: Agent) {
  const classId = (await agent.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body.id as string;
  const ids: string[] = [];
  for (const n of ["Ravi Kumar", "Meera Nair", "Asha Rao"]) ids.push((await agent.post(`${API}/classes/${classId}/students`).send({ name: n })).body.id);
  const [concept] = await db.select().from(concepts).where(eq(concepts.key, "adding-fractions"));
  const qs = await db.select().from(questions).where(eq(questions.conceptId, concept!.id));
  const by = new Map(qs.map((q) => [q.key, q]));
  return { classId, ids, conceptId: concept!.id, q1: by.get("q-af-1")!, q2: by.get("q-af-2")!, fresh: qs.filter((q) => !["q-af-1", "q-af-2"].includes(q.key) && q.reviewStatus === "approved") };
}

const tagged = (q: Q) => q.options.find((o) => o.misconceptionKey === "adds-denominators")!.id;
async function check(agent: Agent, classId: string, q: Q, who: Record<string, "right" | "pattern">) {
  const a = (await agent.post(`${API}/classes/${classId}/assessments`).send({ title: `Check ${q.key}`, type: "diagnostic", questionIds: [q.id] })).body;
  await agent.post(`${API}/assessments/${a.id}/status`).send({ to: "approved" });
  await agent.post(`${API}/assessments/${a.id}/status`).send({ to: "open" });
  const entries = Object.entries(who).map(([studentId, k]) => ({ studentId, answers: [{ questionId: q.id, answer: { kind: "option", optionId: k === "right" ? q.correctOptionId : tagged(q) } }] }));
  await agent.post(`${API}/assessments/${a.id}/entry`).send({ entries });
  await agent.post(`${API}/assessments/${a.id}/status`).send({ to: "closed" });
}

async function finished(agent: Agent, id: string) {
  await pending.get(id);
  return (await agent.get(`${API}/agent-runs/${id}`)).body;
}

describe("intervention planner agent", () => {
  it("investigates with real tools, keeps names away from the model, and changes nothing until approved", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    const [s1, s2] = c.ids as [string, string];
    await check(agent, c.classId, c.q1, { [s1]: "pattern", [s2]: "pattern" });
    await check(agent, c.classId, c.q2, { [s1]: "pattern", [s2]: "right" });
    const patternId = (await agent.get(`${API}/classes/${c.classId}/atlas`)).body.records[0].patternId as string;
    const [resource] = await db.select().from(learningResources).where(and(eq(learningResources.conceptId, c.conceptId), eq(learningResources.level, "foundation"), eq(learningResources.reviewStatus, "approved")));
    const recheck = c.fresh.slice(0, 2).map((q) => q.id);

    ai.queue(
      step("get_pattern_evidence", args({ pattern: "P1" }), "First, how strong is the evidence?"),
      step("find_questions", args({ concept: "C1", count: 2 }), "I need new questions the class has not seen."),
      step("get_lesson_material", args({ concept: "C1" }), "Is there approved material at Foundation level?"),
      step("finish"),
      {
        summary: "In C1, two students showed P1; R1 fits.",
        diagnosis: "They treat the fraction as two separate whole numbers.",
        evidenceNote: "Repeated for S1 across two checks; once for S2, who later answered correctly.",
        prerequisiteFirst: null,
        explanation: { level: "foundation", material: "R1", draft: null, why: "An approved bar-model explanation exists." },
        groupActivity: "Fold paper strips into halves and thirds, then cut both into sixths before adding.",
        recheckQuestions: ["Q1", "Q2"],
        recheckAfterDays: 3,
      },
    );
    const started = await agent.post(`${API}/agents/intervention_planner/runs`).send({ classId: c.classId, patternId });
    expect(started.status).toBe(202);
    const run = await finished(agent, started.body.id);
    expect(run.status).toBe("awaiting_approval");
    expect(run.steps.map((s: { tool: string }) => s.tool)).toEqual(["get_pattern_evidence", "find_questions", "get_lesson_material"]);
    expect(run.steps[0].reason).toBe("First, how strong is the evidence?");
    // The model saw S1/S2, never names; the teacher sees the mapping.
    const sent = ai.calls.map((x) => x.user).join("\n");
    expect(sent).not.toMatch(/Ravi|Meera|Asha/);
    expect(sent).toMatch(/"student":"S1"/);
    expect(Object.values(run.people)).toEqual(expect.arrayContaining(["Ravi Kumar"]));
    // Each model call is recorded.
    expect((await db.select().from(aiRuns)).filter((r) => r.workflow === "agent:intervention_planner")).toHaveLength(5);
    // Nothing has changed in the class yet.
    expect(await db.select().from(interventions)).toHaveLength(0);

    // The teacher reads titles, not handles.
    expect(JSON.stringify(run.plan)).not.toMatch(/[CPQRD]d/);
    const approved = (await agent.post(`${API}/agent-runs/${run.id}/decision`).send({ decision: "approve" })).body;
    expect(approved.status).toBe("approved");
    expect(approved.outcome.message).toMatch(/2 students have the small-group activity/);
    const recheckRow = (await db.select().from(assessments).where(eq(assessments.type, "follow_up")))[0]!;
    expect(recheckRow.status).toBe("draft"); // created, not opened: the teacher decides when
    expect((await db.select().from(interventions)).map((i) => i.studentId).sort()).toEqual([s1, s2].sort());
    // Approving twice carries nothing out twice.
    await agent.post(`${API}/agent-runs/${run.id}/decision`).send({ decision: "approve" });
    expect(await db.select().from(interventions)).toHaveLength(2);
  });

  it("rejects a plan that uses ids no tool returned, after one corrected retry, and changes nothing", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    await check(agent, c.classId, c.q1, { [c.ids[0]!]: "pattern" });
    const patternId = (await agent.get(`${API}/classes/${c.classId}/atlas`)).body.records[0].patternId as string;
    const invented = { summary: "s", diagnosis: "d", evidenceNote: "e", prerequisiteFirst: null, explanation: { level: "foundation", material: null, draft: null, why: "w" }, groupActivity: "g", recheckQuestions: ["Q7"], recheckAfterDays: 2 };
    ai.queue(step("get_pattern_evidence", args({ pattern: "P1" })), step("finish"), invented, invented);
    const id = (await agent.post(`${API}/agents/intervention_planner/runs`).send({ classId: c.classId, patternId })).body.id;
    const run = await finished(agent, id);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/did not return.*Nothing was changed/);
    expect(ai.calls.at(-1)!.user).toMatch(/previous plan had these problems: Unknown question/);
    expect((await agent.post(`${API}/agent-runs/${id}/decision`).send({ decision: "approve" })).status).toBe(409);
  });

  it("stops at the step limit and answers a repeated call from the first result", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    const material = step("get_lesson_material", args({ concept: "C1" }));
    ai.queue(...Array.from({ length: 8 }, () => material), { summary: "s", warmUp: { concept: null, text: "Quick recap." }, level: { level: "guided", reason: "r" }, checkQuestions: ["Q1", "Q2"], watchFor: [], draft: null }, { summary: "s", warmUp: { concept: null, text: "Quick recap." }, level: { level: "guided", reason: "r" }, checkQuestions: ["Q1", "Q2"], watchFor: [], draft: null });
    const id = (await agent.post(`${API}/agents/lesson_prep/runs`).send({ classId: c.classId, conceptId: c.conceptId })).body.id;
    const run = await finished(agent, id);
    expect(run.steps).toHaveLength(8);
    expect(run.steps.slice(1).every((s: { ok: boolean; observation: string }) => !s.ok && /already made this call/.test(s.observation))).toBe(true);
    // The plan used questions no tool returned (find_questions was never called), so it cannot be approved.
    expect(run.status).toBe("failed");
  });
});

describe("lesson prep agent", () => {
  it("prepares from the recap and fresh questions, and saves the plan on approval without touching the class", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    const ids = c.fresh.slice(0, 2).map((q) => q.id);
    // Nothing used recently, so all approved questions are fresh; take two of them.
    ai.queue(step("get_class_recap", args({ concept: "C1" })), step("find_questions", args({ concept: "C1", count: 4 })), step("finish"), () => ({
      summary: "No earlier evidence; start at Guided level.",
      warmUp: { concept: null, text: "Two quick equivalent-fraction questions on the board." },
      level: { level: "guided", reason: "The class has no recorded answers on this lesson yet." },
      checkQuestions: ["Q1", "Q2"],
      watchFor: ["Adding the denominators"],
      draft: null,
    }));
    const id = (await agent.post(`${API}/agents/lesson_prep/runs`).send({ classId: c.classId, conceptId: c.conceptId })).body.id;
    const run = await finished(agent, id);
    expect(run.status).toBe("awaiting_approval");
    const done = (await agent.post(`${API}/agent-runs/${id}/decision`).send({ decision: "approve" })).body;
    expect(done.outcome.message).toMatch(/check step can start with the 2 questions/);
    expect(await db.select().from(assessments)).toHaveLength(0);
    // Reloading finds it again.
    const latest = (await agent.get(`${API}/classes/${c.classId}/agents/lesson_prep/latest?conceptId=${c.conceptId}`)).body.run;
    expect(latest.id).toBe(id);
    // Q1 and Q2 resolve to the first two questions find_questions returned: approved questions on this concept.
    const shown = JSON.parse(run.steps.find((s: { tool: string }) => s.tool === "find_questions").observation).questions.slice(0, 2).map((q: { question: string }) => q.question);
    expect(shown).toEqual(["Q1", "Q2"]);
    const onConcept = (await db.select().from(questions).where(eq(questions.conceptId, c.conceptId))).filter((q) => q.reviewStatus === "approved").map((q) => q.id);
    expect(latest.plan.checkQuestionIds).toHaveLength(2);
    for (const id of latest.plan.checkQuestionIds) expect(onConcept).toContain(id);
    void ids;
  });
});

describe("check follow-up agent", () => {
  it("groups students by pseudonym, maps them back on approval, and creates the follow-up check as a draft", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    const run = `${API}/classes/${c.classId}/lessons/${c.conceptId}/run`;
    const started = (await agent.post(`${run}/check/start`).send({ questionIds: [c.q1.id] })).body;
    await agent.post(`${API}/assessments/${started.assessmentId}/entry`).send({ entries: c.ids.map((studentId, i) => ({ studentId, answers: [{ questionId: c.q1.id, answer: { kind: "option", optionId: i === 0 ? tagged(c.q1) : c.q1.correctOptionId } }] })) });
    await agent.post(`${run}/check/finish`).send({});
    const followUp = c.fresh.slice(0, 1).map((q) => q.id);
    ai.queue(step("get_check_results", args({ concept: "C1" })), step("get_groups", args({ concept: "C1" })), step("find_questions", args({ concept: "C1", count: 2 })), step("finish"), {
      summary: "Most were right; one student added the denominators.",
      decision: "collect_more",
      reason: "One check with one question is thin evidence.",
      groups: [{ groupKey: "follow_up", students: ["S1"], activity: "One more question with fraction strips." }],
      followUpQuestions: ["Q1"],
      teacherNote: "Recheck S1 tomorrow.",
    });
    const id = (await agent.post(`${API}/agents/check_followup/runs`).send({ classId: c.classId, conceptId: c.conceptId })).body.id;
    const r = await finished(agent, id);
    expect(r.status).toBe("awaiting_approval");
    const s1 = Object.entries(r.people as Record<string, string>).find(([ref]) => ref === "S1")![1];
    const done = (await agent.post(`${API}/agent-runs/${id}/decision`).send({ decision: "approve" })).body;
    expect(done.outcome.message).toMatch(/1 students have their next activity/);
    const [iv] = await db.select().from(interventions);
    expect(iv!.groupKey).toBe("follow_up");
    const names = (await agent.get(`${API}/classes/${c.classId}/students`)).body.students as Array<{ id: string; name: string }>;
    expect(names.find((s) => s.id === iv!.studentId)!.name).toBe(s1);
    const fu = await db.select().from(assessments).where(inArray(assessments.type, ["follow_up"]));
    expect(fu[0]!.status).toBe("draft");
  });
});

describe("agent safety", () => {
  it("says plainly when AI is off, and keeps runs private to the teacher who started them", async () => {
    const off = buildTestApp(new UnavailableProvider());
    const a = await signedInAgent(off.app, "off@example.com", "Off");
    const classId = (await a.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body.id;
    const [concept] = await off.db.select().from(concepts).where(eq(concepts.key, "adding-fractions"));
    const r = await a.post(`${API}/agents/lesson_prep/runs`).send({ classId, conceptId: concept!.id });
    expect(r.status).toBe(502);
    expect(r.body.error.message).toMatch(/AI is switched off/);
    await off.pool.end();

    const agent = await signedInAgent(app);
    const c = await setup(agent);
    ai.queue(step("finish"), { summary: "s", warmUp: { concept: null, text: "t" }, level: { level: "guided", reason: "r" }, checkQuestions: [], watchFor: [], draft: null }, { summary: "s", warmUp: { concept: null, text: "t" }, level: { level: "guided", reason: "r" }, checkQuestions: [], watchFor: [], draft: null });
    const id = (await agent.post(`${API}/agents/lesson_prep/runs`).send({ classId: c.classId, conceptId: c.conceptId })).body.id;
    await pending.get(id);
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await other.get(`${API}/agent-runs/${id}`)).status).toBe(404);
    expect((await other.post(`${API}/agent-runs/${id}/decision`).send({ decision: "approve" })).status).toBe(404);
    expect((await other.post(`${API}/agents/lesson_prep/runs`).send({ classId: c.classId, conceptId: c.conceptId })).status).toBe(404);
  });
});

describe("agent runtime hygiene", () => {
  it("keeps only a well-formed handle when a live model adds stray characters, and never accepts a raw id", async () => {
    const { cleanHandle } = await import("./runtime");
    expect(cleanHandle("C1}}}   assistant to=agent_step {", "C")).toBe("C1");
    expect(cleanHandle(" q3 ", "Q")).toBe("Q3");
    expect(cleanHandle("8872c12e-5fd9-43b4-9c02-a0da0525bbe4", "C")).toBeNull();
    expect(cleanHandle("nonsense", "P")).toBeNull();
  });
});

describe("lesson prep plan rules", () => {
  it("refuses a check that repeats one question or uses questions from another concept, after one corrected retry", async () => {
    const agent = await signedInAgent(app);
    const c = await setup(agent);
    const plan = (qs: string[]) => ({ summary: "s", warmUp: { concept: null, text: "t" }, level: { level: "guided", reason: "r" }, checkQuestions: qs, watchFor: [], draft: null });
    ai.queue(step("find_questions", args({ concept: "C1", count: 3 })), step("finish"), plan(["Q1", "Q1", "Q1"]), plan(["Q2", "Q2"]));
    const id = (await agent.post(`${API}/agents/lesson_prep/runs`).send({ classId: c.classId, conceptId: c.conceptId })).body.id;
    const run = await finished(agent, id);
    expect(run.status).toBe("failed");
    expect(run.error).toMatch(/two or three DIFFERENT questions/);
  });
});
