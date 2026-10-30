import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { eq } from "drizzle-orm";
import { concepts, learningResources } from "../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { ScriptedProvider } from "../../test/scripted-provider";
import { seedBook } from "../curriculum/seed/book";
import { UnavailableProvider } from "../ai/mesh-provider";

const API = "/api/v1";
const ai = new ScriptedProvider();
const { app, db, pool } = buildTestApp(ai);
afterAll(() => pool.end());
type Agent = ReturnType<typeof request.agent>;

beforeEach(async () => {
  await resetDb(db);
  await seedBook(db);
  ai.calls.length = 0;
});

async function checkedClass(agent: Agent, students: number, wrong: number) {
  const classId = (await agent.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body.id as string;
  const ids: string[] = [];
  for (let i = 1; i <= students; i++) ids.push((await agent.post(`${API}/classes/${classId}/students`).send({ name: `S${i}` })).body.id);
  const [concept] = await db.select().from(concepts).where(eq(concepts.key, "adding-fractions"));
  const run = `${API}/classes/${classId}/lessons/${concept!.id}/run`;
  const started = (await agent.post(`${run}/check/start`).send({})).body;
  const a = (await agent.get(`${API}/assessments/${started.assessmentId}`)).body;
  const entries = ids.map((studentId, i) => ({
    studentId,
    answers: a.questions.map((q: { id: string; correctOptionId: string; options: Array<{ id: string; misconceptionKey?: string | null }> }) => {
      const tagged = q.options.find((o) => o.misconceptionKey) ?? q.options.find((o) => o.id !== q.correctOptionId)!;
      return { questionId: q.id, answer: { kind: "option", optionId: i < wrong ? tagged.id : q.correctOptionId } };
    }),
  }));
  await agent.post(`${API}/assessments/${started.assessmentId}/entry`).send({ entries });
  return { classId, conceptId: concept!.id, run, assessmentId: started.assessmentId as string };
}

describe("copilot over real answers", () => {
  it("says there is not enough information before anyone has answered, without calling the AI", async () => {
    const agent = await signedInAgent(app);
    const c = await checkedClass(agent, 5, 0);
    // A fresh class with a started but unanswered check:
    const agent2 = await signedInAgent(app, "t2@example.com", "T2");
    const classId = (await agent2.post(`${API}/classes`).send({ name: "6B", grade: 6, academicYear: "2026-27" })).body.id;
    await agent2.post(`${API}/classes/${classId}/students`).send({ name: "Only" });
    await agent2.post(`${API}/classes/${classId}/lessons/${c.conceptId}/run/check/start`).send({});
    const r = (await agent2.get(`${API}/classes/${classId}/lessons/${c.conceptId}/run/copilot`)).body;
    expect(r.basis).toBe("no_evidence");
    expect(r.suggestions).toEqual([]);
    expect(r.message).toMatch(/not enough information/i);
    expect(ai.calls).toHaveLength(0);
  });

  it("turns a common error pattern into suggestions that name their evidence, and never presents it as confirmed", async () => {
    const agent = await signedInAgent(app);
    const c = await checkedClass(agent, 8, 6);
    const r = (await agent.get(`${c.run}/copilot`)).body;
    expect(r.basis).toBe("enough");
    const visual = r.suggestions.find((s: { kind: string }) => s.kind === "visual_explanation");
    expect(visual).toBeTruthy();
    expect(visual.evidence.join(" ")).toMatch(/answers matched the pattern/);
    expect(visual.why).toMatch(/not a confirmed one/);
    expect(visual.certainty).toBe("medium");
    expect(visual.action).toEqual({ type: "preview_resource", level: "foundation" });
    const parallel = r.suggestions.find((s: { kind: string }) => s.kind === "parallel_example");
    expect(parallel.action.type).toBe("prepare_ai_draft");
    expect(r.aiAvailable).toBe(true);
    // Reading suggestions never calls the model.
    expect(ai.calls).toHaveLength(0);
  });

  it("offers the lesson's own guided example instead when the AI is not available", async () => {
    ai.available = false;
    try {
      const agent = await signedInAgent(app);
      const c = await checkedClass(agent, 8, 6);
      const r = (await agent.get(`${c.run}/copilot`)).body;
      expect(r.aiAvailable).toBe(false);
      expect(r.suggestions.find((s: { kind: string }) => s.kind === "parallel_example").action).toEqual({ type: "preview_resource", level: "guided" });
    } finally {
      ai.available = true;
    }
  });

  it("recommends moving on and offers a harder question when the class is secure", async () => {
    const agent = await signedInAgent(app);
    const c = await checkedClass(agent, 8, 0);
    const r = (await agent.get(`${c.run}/copilot`)).body;
    expect(r.suggestions.map((s: { kind: string }) => s.kind)).toContain("move_on");
    expect(r.suggestions.find((s: { kind: string }) => s.kind === "move_on").certainty).toBe("high");
  });

  it("prepares AI material only as a private draft that needs review, and a failing model leaves a clear error and no draft", async () => {
    const agent = await signedInAgent(app);
    const c = await checkedClass(agent, 8, 6);
    ai.queue({
      title: "Another look: unlike denominators",
      summary: "Cut both wholes into the same size pieces first.",
      steps: ["Find a common denominator.", "Rewrite both fractions.", "Add the tops."],
      workedExample: { problem: "Find 1/3 + 1/4.", steps: ["Common denominator is 12.", "4/12 + 3/12 = 7/12."] },
      commonError: "Adding the bottoms as well.",
      prompt: null,
    });
    const made = await agent.post(`${API}/concepts/${c.conceptId}/drafts/explanations`).send({ level: "guided" });
    expect([200, 201]).toContain(made.status);
    const rows = await db.select().from(learningResources).where(eq(learningResources.conceptId, c.conceptId));
    const draft = rows.find((r) => r.provenance.source === "ai_draft");
    expect(draft?.reviewStatus).toBe("draft"); // never usable in class until a teacher approves it

    ai.queue(new Error("provider down"));
    const failed = await agent.post(`${API}/concepts/${c.conceptId}/drafts/explanations`).send({ level: "foundation" });
    expect(failed.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(failed.body)).not.toMatch(/provider down|stack/i);
    expect((await db.select().from(learningResources).where(eq(learningResources.conceptId, c.conceptId))).filter((r) => r.provenance.source === "ai_draft")).toHaveLength(1);
  });

  it("puts an AI draft in front of the class only after the teacher confirms they checked it, and then the projector shows it", async () => {
    const agent = await signedInAgent(app);
    const c = await checkedClass(agent, 8, 6);
    ai.queue({
      title: "Another look: same-size pieces",
      summary: "Make both pieces the same size before adding.",
      steps: ["Find a common denominator.", "Rewrite both fractions.", "Add the tops."],
      workedExample: { problem: "Find 1/2 + 1/4.", steps: ["Common denominator is 4.", "2/4 + 1/4 = 3/4."] },
      commonError: "Adding the bottoms as well.",
      prompt: null,
    });
    const draft = (await agent.post(`${API}/concepts/${c.conceptId}/drafts/explanations`).send({ level: "guided" })).body;
    const shown = async () => (await agent.get(`${API}/concepts/${c.conceptId}/presentation`)).body.levels.find((l: { level: string }) => l.level === "guided");
    expect((await shown())?.title).not.toBe("Another look: same-size pieces"); // a draft is never on the projector

    // Approving without saying it was checked by hand is refused, and nothing changes.
    const unchecked = await agent.post(`${API}/resource-drafts/${draft.id}/review`).send({ decision: "approve" });
    expect(unchecked.status).toBe(400);
    expect((await shown())?.title).not.toBe("Another look: same-size pieces");

    expect((await agent.post(`${API}/resource-drafts/${draft.id}/review`).send({ decision: "approve", checkedByHand: true })).status).toBe(200);
    expect((await shown())?.title).toBe("Another look: same-size pieces");
  });

  it("is refused for another teacher's class", async () => {
    const owner = await signedInAgent(app, "owner@example.com", "Owner");
    const c = await checkedClass(owner, 5, 0);
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await other.get(`${c.run}/copilot`)).status).toBe(404);
    expect((await other.get(`${c.run}/history`)).status).toBe(404);
  });
});

describe("session history", () => {
  it("lists what actually happened, in order, from the audit log, and survives a reload", async () => {
    const agent = await signedInAgent(app);
    const c = await checkedClass(agent, 4, 1);
    await agent.post(`${c.run}/check/finish`).send({});
    await agent.post(`${API}/assessments/${c.assessmentId}/release-results`).send({});
    await agent.post(`${c.run}/wrap`).send({ markTaught: true });

    for (let reload = 0; reload < 2; reload++) {
      const labels = (await agent.get(`${c.run}/history`)).body.events.map((e: { label: string }) => e.label);
      expect(labels).toEqual(expect.arrayContaining(["Lesson started", "Check created", "Check opened to students", "Check closed", "Results shown to students", "Recorded as taught", "Lesson wrapped up"]));
      expect(labels.indexOf("Check opened to students")).toBeLessThan(labels.indexOf("Check closed"));
      expect(labels.indexOf("Check closed")).toBeLessThan(labels.indexOf("Lesson wrapped up"));
    }
  });

  it("is empty for a lesson that has not started", async () => {
    const agent = await signedInAgent(app);
    const c = await checkedClass(agent, 3, 0);
    const [other] = await db.select().from(concepts).where(eq(concepts.key, "factors-multiples"));
    expect((await agent.get(`${API}/classes/${c.classId}/lessons/${other!.id}/run/history`)).body.events).toEqual([]);
  });
});

it("an unavailable provider is reported as not available, not as an error", () => {
  expect(new UnavailableProvider().available).toBe(false);
});
