import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { conceptMastery, concepts, questions } from "../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { seedFractionsClass6 } from "../curriculum/seed/seed";
import { revisitDue } from "./revisit.service";

const { app, db, pool } = buildTestApp();
afterAll(() => pool.end());
const API = "/api/v1";

type Agent = Awaited<ReturnType<typeof signedInAgent>>;
interface Ctx {
  teacher: Agent;
  classId: string;
  conceptId: string;
  students: { id: string; name: string; rosterNumber: number }[];
  qid: (k: string) => string;
}
let c: Ctx;

/** Six students answer the adding-fractions check; then their statuses are set so the brief's rules are exercised exactly. */
async function setup(opts: { answers: boolean } = { answers: true }): Promise<Ctx> {
  await resetDb(db);
  await seedFractionsClass6(db);
  const teacher = await signedInAgent(app);
  const cls = (await teacher.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body;
  for (const name of ["Ravi Kumar", "Meera Rao", "Anu Das", "Kiran Pal", "Zoya Khan", "Dev Shah"]) await teacher.post(`${API}/classes/${cls.id}/students`).send({ name });
  const students = (await teacher.get(`${API}/classes/${cls.id}/students`)).body.students;
  const conceptId = (await db.select().from(concepts).where(eq(concepts.key, "adding-fractions")))[0]!.id;
  const qs = new Map((await db.select().from(questions)).map((q) => [q.key, q.id]));
  const ctx: Ctx = { teacher, classId: cls.id, conceptId, students, qid: (k) => qs.get(k)! };

  if (opts.answers) {
    const a = (await teacher.post(`${API}/classes/${cls.id}/assessments`).send({ title: "Check", type: "diagnostic", questionIds: [ctx.qid("q-af-1"), ctx.qid("q-af-2")] })).body.id;
    for (const to of ["approved", "open"]) await teacher.post(`${API}/assessments/${a}/status`).send({ to });
    const answer = (i: number, opt: string) => ({ studentId: students[i]!.id, answers: [ctx.qid("q-af-1"), ctx.qid("q-af-2")].map((questionId) => ({ questionId, answer: { kind: "option", optionId: opt } })) });
    await teacher.post(`${API}/assessments/${a}/entry`).send({ entries: [answer(0, "a"), answer(1, "a"), answer(2, "b"), answer(3, "b"), answer(4, "b")] });
    // Fix the statuses so the test checks the brief's rules, not the mastery algorithm (which has its own tests).
    const set = async (i: number, status: "needs_foundation" | "likely_secure" | "ready_for_challenge", last?: Date) =>
      db.update(conceptMastery).set({ status, ...(last ? { lastEvidenceAt: last } : {}) }).where(sql`${conceptMastery.studentId} = ${students[i]!.id} and ${conceptMastery.conceptId} = ${conceptId}`);
    await set(0, "needs_foundation");
    await set(1, "needs_foundation");
    await set(2, "likely_secure");
    await set(3, "likely_secure");
    await set(4, "ready_for_challenge");
  }
  return ctx;
}

const generate = async () => (await c.teacher.post(`${API}/classes/${c.classId}/teaching-briefs`).send({})).body;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const byId = (brief: any, prefix: string): any[] => brief.items.filter((i: { id: string }) => i.id.startsWith(prefix));

describe("teaching brief", () => {
  it("says so when there is nothing to summarise, instead of inventing something", async () => {
    c = await setup({ answers: false });
    const brief = await generate();
    expect(brief.basis).toMatchObject({ students: 6, answersRecorded: 0 });
    expect(brief.items).toHaveLength(1);
    expect(brief.items[0]).toMatchObject({ section: "assess", kind: "measured", text: expect.stringMatching(/No answers have been recorded/) });
  });

  it("builds measured lines from the stored records, with counts that match the learning map", async () => {
    c = await setup();
    const brief = await generate();
    const map = (await c.teacher.get(`${API}/classes/${c.classId}/learning-map`)).body;
    const adding = map.concepts.find((x: { title: string }) => x.title === "Adding fractions");
    const withEv = 6 - adding.counts.not_enough_evidence;

    expect(brief.basis.answersRecorded).toBeGreaterThan(0);
    const secure = byId(brief, "secure:")[0];
    expect(secure).toMatchObject({ section: "secure", kind: "measured", rollNumbers: [3, 4, 5] });
    expect(secure.text).toMatch(new RegExp(`3 of ${withEv} students`));
    const revision = byId(brief, "revision:")[0];
    expect(revision).toMatchObject({ section: "revision", kind: "measured", rollNumbers: [1, 2] });
    expect(revision.text).toMatch(new RegExp(`2 of ${withEv} students need more practice`));
    expect(byId(brief, "challenge:")[0]).toMatchObject({ rollNumbers: [5] });
    const notAnswered = byId(brief, "assess:").find((i: { kind: string }) => i.kind === "measured");
    expect(notAnswered.rollNumbers).toEqual([6]);
    expect(byId(brief, "patterns:")[0]?.text ?? "").toMatch(/provisional/);
  });

  it("every line points at records, and every suggestion names the measured lines it rests on", async () => {
    c = await setup();
    const brief = await generate();
    const ids = new Set(brief.items.map((i: { id: string }) => i.id));
    for (const item of brief.items) {
      if (item.kind === "measured") expect(item.evidence.length, item.id).toBeGreaterThan(0);
      else {
        expect(item.basedOn.length, item.id).toBeGreaterThan(0);
        for (const b of item.basedOn) {
          expect(ids.has(b), `${item.id} -> ${b}`).toBe(true);
          expect(brief.items.find((i: { id: string }) => i.id === b).kind).toBe("measured");
        }
      }
    }
    expect(brief.items.some((i: { kind: string; section: string }) => i.kind === "inferred" && i.section === "activity")).toBe(true);
    expect(brief.items.some((i: { section: string }) => i.section === "follow_up")).toBe(true);
  });

  it("identifies students by roll number only", async () => {
    c = await setup();
    const text = JSON.stringify(await generate());
    for (const name of ["Ravi", "Meera", "Anu", "Kiran", "Zoya", "Dev"]) expect(text).not.toContain(name);
  });

  it("makes no class-level claim from too few students", async () => {
    c = await setup();
    // Only two students keep any evidence on the concept.
    await db.delete(conceptMastery).where(sql`${conceptMastery.studentId} in (${c.students[2]!.id}, ${c.students[3]!.id}, ${c.students[4]!.id}, ${c.students[5]!.id})`);
    const brief = await generate();
    expect(byId(brief, "secure:")).toHaveLength(0);
    expect(byId(brief, "revision:")).toHaveLength(0);
    expect(byId(brief, "assess:thin:")[0].text).toMatch(/too few to say anything about the class/);
  });

  it("the teacher can accept, dismiss, reword and mark actions done; measured lines cannot be 'done'", async () => {
    c = await setup();
    const brief = await generate();
    const action = brief.items.find((i: { id: string }) => i.id === "activity:main");
    const measured = byId(brief, "revision:")[0];
    const patch = (id: string, body: object) => c.teacher.patch(`${API}/teaching-briefs/${brief.id}/items/${encodeURIComponent(id)}`).send(body);

    expect((await patch(action.id, { status: "accepted" })).body.items.find((i: { id: string }) => i.id === action.id).status).toBe("accepted");
    const edited = (await patch(action.id, { editedText: "Use the number line for 5 minutes" })).body.items.find((i: { id: string }) => i.id === action.id);
    expect(edited).toMatchObject({ editedText: "Use the number line for 5 minutes", text: action.text, evidence: action.evidence });
    expect((await patch(measured.id, { status: "dismissed" })).body.items.find((i: { id: string }) => i.id === measured.id).status).toBe("dismissed");
    expect((await patch(measured.id, { status: "done" })).status).toBe(409);
    expect((await patch(action.id, { status: "done" })).status).toBe(200);
    expect((await patch("no-such-line", { status: "accepted" })).status).toBe(404);
    expect((await patch(action.id, {})).status).toBe(400);
    expect((await patch(action.id, { status: "bogus" })).status).toBe(400);
    const stored = (await c.teacher.get(`${API}/teaching-briefs/${brief.id}`)).body;
    expect(stored.items.find((i: { id: string }) => i.id === action.id).status).toBe("done");
  });

  it("carries over planned actions that were accepted but not done", async () => {
    c = await setup();
    const first = await generate();
    for (const id of ["activity:main", "follow_up:main"]) await c.teacher.patch(`${API}/teaching-briefs/${first.id}/items/${encodeURIComponent(id)}`).send({ status: "accepted" });
    await c.teacher.patch(`${API}/teaching-briefs/${first.id}/items/${encodeURIComponent("follow_up:main")}`).send({ status: "done" });
    const second = await generate();
    const carried = byId(second, "carry_over:");
    expect(carried).toHaveLength(1);
    expect(carried[0].text).toMatch(/Planned in the last brief and not marked done/);
    expect(carried[0].evidence[0].type).toBe("earlier_brief");
    expect((await c.teacher.get(`${API}/classes/${c.classId}/teaching-briefs`)).body.briefs).toHaveLength(2);
  });

  it("lists a concept for revisit only when secure and not seen for a while, using approved questions", async () => {
    c = await setup();
    expect(byId(await generate(), "revisit:")).toHaveLength(0); // everything is fresh
    const old = new Date(Date.now() - 20 * 86_400_000);
    await db.update(conceptMastery).set({ lastEvidenceAt: old }).where(sql`${conceptMastery.studentId} in (${c.students[2]!.id}, ${c.students[0]!.id})`);

    const due = await revisitDue(db, c.students.map((s) => s.id));
    expect(due).toHaveLength(1); // student 0 is not secure, so only student 2 counts
    expect(due[0]).toMatchObject({ title: "Adding fractions", studentIds: [c.students[2]!.id] });
    expect(due[0]!.questionIds.length).toBeGreaterThan(0);
    expect(due[0]!.questionIds.length).toBeLessThanOrEqual(2);
    const stems = await db.select({ r: questions.reviewStatus }).from(questions).where(inArray(questions.id, due[0]!.questionIds));
    expect(stems.every((s) => s.r === "approved")).toBe(true);

    const brief = await generate();
    expect(byId(brief, "revisit:")[0]).toMatchObject({ kind: "measured", section: "revisit", evidence: [{ type: "revisit" }] });
  });

  it("is private to the class's teacher", async () => {
    c = await setup();
    const brief = await generate();
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await other.post(`${API}/classes/${c.classId}/teaching-briefs`).send({})).status).toBe(404);
    expect((await other.get(`${API}/classes/${c.classId}/teaching-briefs`)).status).toBe(404);
    expect((await other.get(`${API}/teaching-briefs/${brief.id}`)).status).toBe(404);
    expect((await other.patch(`${API}/teaching-briefs/${brief.id}/items/activity%3Amain`).send({ status: "accepted" })).status).toBe(404);
    expect((await (await import("supertest")).default(app).get(`${API}/teaching-briefs/${brief.id}`)).status).toBe(401);
  });
});

describe("home note", () => {
  it("gives a family plain words: first name, what is going well, a few questions to try, and no labels or answers", async () => {
    c = await setup();
    const strong = await c.teacher.get(`${API}/classes/${c.classId}/students/${c.students[2]!.id}/home-note`);
    expect(strong.body.studentFirstName).toBe("Anu");
    expect(strong.body.goingWell).toContain("Adding fractions");
    expect(strong.body.practise).toEqual([]);

    await db.update(conceptMastery).set({ status: "developing" }).where(sql`${conceptMastery.studentId} = ${c.students[0]!.id}`);
    const note = (await c.teacher.get(`${API}/classes/${c.classId}/students/${c.students[0]!.id}/home-note`)).body;
    expect(note.practise[0].topic).toBe("Adding fractions");
    expect(note.practise[0].tryThese.length).toBeGreaterThan(0);
    const text = JSON.stringify(note);
    expect(text).not.toMatch(/needs_foundation|developing|misconception|correct|weak|rank|score|Kumar/i);
  });

  it("says plainly when there is not enough work yet, and 404s for other teachers", async () => {
    c = await setup({ answers: false });
    expect((await c.teacher.get(`${API}/classes/${c.classId}/students/${c.students[0]!.id}/home-note`)).body.note).toMatch(/not had enough work/);
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await other.get(`${API}/classes/${c.classId}/students/${c.students[0]!.id}/home-note`)).status).toBe(404);
  });
});
