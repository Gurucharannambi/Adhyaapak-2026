import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { conceptPrerequisites, concepts, misconceptionPatterns, questions } from "../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { CONCEPTS, MISCONCEPTIONS, QUESTIONS } from "./seed/fractions-class6";
import { seedFractionsClass6 } from "./seed/seed";

const { app, db, pool } = buildTestApp();
beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const API = "/api/v1";

describe("seed content integrity (pure data checks)", () => {
  const conceptKeys = new Set(CONCEPTS.map((c) => c.key));
  const questionKeys = new Set(QUESTIONS.map((q) => q.key));
  const misconceptionKeys = new Set(MISCONCEPTIONS.map((m) => m.key));

  it("has unique keys", () => {
    expect(conceptKeys.size).toBe(CONCEPTS.length);
    expect(questionKeys.size).toBe(QUESTIONS.length);
    expect(misconceptionKeys.size).toBe(MISCONCEPTIONS.length);
  });

  it("only references concepts that exist", () => {
    for (const c of CONCEPTS) for (const p of c.prerequisites) expect(conceptKeys.has(p), `${c.key} -> ${p}`).toBe(true);
    for (const q of QUESTIONS) {
      expect(conceptKeys.has(q.concept), q.key).toBe(true);
      for (const a of q.alsoAssesses ?? []) expect(conceptKeys.has(a), `${q.key} also ${a}`).toBe(true);
    }
    for (const m of MISCONCEPTIONS) expect(conceptKeys.has(m.concept), m.key).toBe(true);
  });

  it("has an acyclic prerequisite graph", () => {
    const state = new Map<string, "visiting" | "done">();
    const byKey = new Map(CONCEPTS.map((c) => [c.key, c]));
    const visit = (k: string) => {
      if (state.get(k) === "done") return;
      expect(state.get(k), `cycle through ${k}`).not.toBe("visiting");
      state.set(k, "visiting");
      byKey.get(k)!.prerequisites.forEach(visit);
      state.set(k, "done");
    };
    CONCEPTS.forEach((c) => visit(c.key));
  });

  it("gives every question exactly one correct option among 2+ unique options", () => {
    for (const q of QUESTIONS) {
      const ids = q.options.map((o) => o.id);
      expect(new Set(ids).size, q.key).toBe(ids.length);
      expect(ids.length, q.key).toBeGreaterThanOrEqual(2);
      expect(ids.includes(q.correct), `${q.key} correct id`).toBe(true);
      expect(new Set(q.options.map((o) => o.text)).size, `${q.key} duplicate option text`).toBe(q.options.length);
    }
  });

  it("never tags the correct option with a misconception, and only uses known misconception keys", () => {
    for (const q of QUESTIONS) {
      for (const o of q.options) {
        if (o.misconceptionKey) {
          expect(misconceptionKeys.has(o.misconceptionKey), `${q.key}/${o.id}`).toBe(true);
          expect(o.id, `${q.key} tags its correct option`).not.toBe(q.correct);
        }
      }
    }
  });

  it("points every misconception at an existing follow-up question that is not the same item", () => {
    for (const m of MISCONCEPTIONS) {
      expect(questionKeys.has(m.followUpQuestion), m.key).toBe(true);
    }
  });

  it("covers every concept with all three teaching levels", () => {
    for (const c of CONCEPTS) expect(c.resources.map((r) => r.level).sort(), c.key).toEqual(["challenge", "foundation", "guided"]);
  });

  it("has at least one diagnostic question per concept", () => {
    for (const c of CONCEPTS) {
      expect(QUESTIONS.some((q) => q.concept === c.key && q.role === "diagnostic"), c.key).toBe(true);
    }
  });
});

describe("seeding", () => {
  it("loads the chapter into the database and is idempotent", async () => {
    await seedFractionsClass6(db);
    await seedFractionsClass6(db);
    expect(await db.select().from(concepts)).toHaveLength(CONCEPTS.length);
    expect(await db.select().from(questions)).toHaveLength(QUESTIONS.length);
    expect(await db.select().from(misconceptionPatterns)).toHaveLength(MISCONCEPTIONS.length);
    expect(await db.select().from(conceptPrerequisites)).toHaveLength(CONCEPTS.reduce((n, c) => n + c.prerequisites.length, 0));
  });

  it("does not overwrite content that was edited after seeding", async () => {
    await seedFractionsClass6(db);
    await db.update(questions).set({ stem: "Edited by a teacher" }).where(eq(questions.key, "q-mf-1"));
    await seedFractionsClass6(db);
    const [q] = await db.select().from(questions).where(eq(questions.key, "q-mf-1"));
    expect(q!.stem).toBe("Edited by a teacher");
  });

  it("stores no self-referencing prerequisite edge (database constraint)", async () => {
    await seedFractionsClass6(db);
    const [c] = await db.select().from(concepts).limit(1);
    await expect(db.insert(conceptPrerequisites).values({ prerequisiteConceptId: c!.id, dependentConceptId: c!.id })).rejects.toThrow();
  });
});

describe("curriculum API", () => {
  it("browses version -> chapters -> concepts -> concept detail from real records", async () => {
    await seedFractionsClass6(db);
    const agent = await signedInAgent(app);

    const curricula = (await agent.get(`${API}/curriculum`)).body.curricula;
    expect(curricula).toHaveLength(1);
    expect(curricula[0]).toMatchObject({ grade: 6, subject: "Mathematics", board: "CBSE", language: "en" });

    const chapters = (await agent.get(`${API}/curriculum/${curricula[0].id}/chapters`)).body.chapters;
    expect(chapters).toEqual([expect.objectContaining({ title: "Fractions", conceptCount: CONCEPTS.length })]);

    const list = (await agent.get(`${API}/chapters/${chapters[0].id}/concepts`)).body.concepts;
    expect(list.map((c: { key: string }) => c.key)).toEqual(CONCEPTS.map((c) => c.key));
    const adding = list.find((c: { key: string }) => c.key === "adding-fractions");
    expect(adding.prerequisiteIds).toHaveLength(1);

    const detail = (await agent.get(`${API}/concepts/${adding.id}`)).body;
    expect(detail.prerequisites.map((p: { title: string }) => p.title)).toEqual(["Finding a common denominator"]);
    expect(detail.dependents.map((p: { title: string }) => p.title)).toEqual(["Fraction word problems"]);
    expect(detail.resources.filter((r: { level: string | null }) => r.level).map((r: { level: string }) => r.level)).toEqual(["foundation", "guided", "challenge"]);
    expect(detail.questions.length).toBeGreaterThanOrEqual(4);
    expect(detail.misconceptions.map((m: { key: string }) => m.key)).toEqual(expect.arrayContaining(["adds-denominators"]));
    expect(detail.provenance.source).toBe("original");
  });

  it("returns the misconception tag on the 1/2 + 1/3 = 2/5 option", async () => {
    await seedFractionsClass6(db);
    const agent = await signedInAgent(app);
    const [c] = await db.select().from(concepts).where(and(eq(concepts.key, "adding-fractions")));
    const q = (await agent.get(`${API}/concepts/${c!.id}`)).body.questions.find((x: { key: string }) => x.key === "q-af-1");
    expect(q.correctOptionId).toBe("b");
    expect(q.options.find((o: { text: string }) => o.text === "2/5").misconceptionKey).toBe("adds-denominators");
  });

  it("requires sign-in and returns 404 for unknown or malformed ids", async () => {
    const anon = await import("supertest").then((m) => m.default(app).get(`${API}/curriculum`));
    expect(anon.status).toBe(401);
    const agent = await signedInAgent(app);
    expect((await agent.get(`${API}/concepts/not-a-uuid`)).status).toBe(404);
    expect((await agent.get(`${API}/concepts/00000000-0000-4000-8000-000000000000`)).status).toBe(404);
    expect((await agent.get(`${API}/curriculum/00000000-0000-4000-8000-000000000000/chapters`)).status).toBe(404);
  });
});
