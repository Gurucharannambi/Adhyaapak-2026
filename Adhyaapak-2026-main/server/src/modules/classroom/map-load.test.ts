import { afterAll, describe, expect, it } from "vitest";
import { conceptMastery, concepts, questions } from "../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { seedFractionsClass6 } from "../curriculum/seed/seed";
import { importPackage } from "../curriculum/content/import";
import { readFile } from "node:fs/promises";

const { app, db, pool } = buildTestApp();
afterAll(() => pool.end());
const API = "/api/v1";

/**
 * Load check for the screens a teacher opens most: the class learning map, the misconception list and the
 * teaching brief, for a 40-student class across 15 concepts. The data is inserted directly (it is synthetic and
 * exists only in the test database). The limits are generous on purpose: they catch an accidental N+1 query, not a slow laptop.
 */
describe("learning map under a realistic class size", () => {
  it("answers within a second or two for 40 students and 15 concepts", async () => {
    await resetDb(db);
    await seedFractionsClass6(db);
    await importPackage(db, JSON.parse(await readFile(new URL("../../../content/decimals-class6.json", import.meta.url), "utf8")), { approve: true });
    const teacher = await signedInAgent(app);
    const cls = (await teacher.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body;
    const csv = ["name"].concat(Array.from({ length: 40 }, (_, i) => `Student ${i + 1}`)).join("\n");
    const imported = await teacher.post(`${API}/classes/${cls.id}/enrolments/import`).send({ csv, dryRun: false });
    expect(imported.status).toBe(200);
    const students = (await teacher.get(`${API}/classes/${cls.id}/students`)).body.students as Array<{ id: string }>;
    expect(students).toHaveLength(40);

    const allConcepts = await db.select().from(concepts);
    expect(allConcepts.length).toBe(15);
    const statuses = ["needs_foundation", "developing", "likely_secure", "ready_for_challenge", "not_enough_evidence"] as const;
    const rows = students.flatMap((s, si) =>
      allConcepts.map((c, ci) => ({ studentId: s.id, conceptId: c.id, estimate: 0.5, status: statuses[(si + ci) % statuses.length]!, evidenceCount: 3 + ((si + ci) % 4), evidenceIds: [], algorithmVersion: "x", lastEvidenceAt: new Date(Date.now() - ((si * 7 + ci) % 40) * 86_400_000) })),
    );
    await db.insert(conceptMastery).values(rows);
    // Fifteen students answer the way the "adds the denominators" pattern does, through the real pipeline.
    const qs = new Map((await db.select().from(questions)).map((q) => [q.key, q.id]));
    const act = (await teacher.post(`${API}/classes/${cls.id}/assessments`).send({ title: "Load check", type: "diagnostic", questionIds: [qs.get("q-af-1"), qs.get("q-af-2")] })).body.id;
    for (const to of ["approved", "open"]) await teacher.post(`${API}/assessments/${act}/status`).send({ to });
    const entries = students.slice(0, 15).map((s) => ({ studentId: s.id, answers: ["q-af-1", "q-af-2"].map((k) => ({ questionId: qs.get(k), answer: { kind: "option", optionId: "a" } })) }));
    expect((await teacher.post(`${API}/assessments/${act}/entry`).send({ entries })).status).toBe(200);

    const time = async (label: string, fn: () => Promise<{ status: number; body?: unknown }>) => {
      const t0 = performance.now();
      const res = await fn();
      const ms = Math.round(performance.now() - t0);
      console.log(`load: ${label} took ${ms} ms`);
      expect(res.status, label).toBeLessThan(300);
      return ms;
    };

    const map = await time("learning map (40 students x 15 concepts)", () => teacher.get(`${API}/classes/${cls.id}/learning-map`));
    const mis = await time("class misconceptions", () => teacher.get(`${API}/classes/${cls.id}/misconceptions`));
    const brief = await time("teaching brief", () => teacher.post(`${API}/classes/${cls.id}/teaching-briefs`).send({}));
    const board = await time("branch board", () => teacher.get(`${API}/classes/${cls.id}/branch-board`));
    for (const ms of [map, mis, brief, board]) expect(ms).toBeLessThan(3000);

    const body = (await teacher.get(`${API}/classes/${cls.id}/learning-map`)).body;
    expect(body.students).toHaveLength(40);
    expect(body.concepts).toHaveLength(15);
  });
});
