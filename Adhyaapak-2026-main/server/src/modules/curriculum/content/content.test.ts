import { readFile } from "node:fs/promises";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { chapters, concepts, learningResources, questions } from "../../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../../test/helpers";
import { loadConceptGraph } from "../../learning/graph/graph.repo";
import { seedFractionsClass6 } from "../seed/seed";
import { ruleQuality } from "../atlas.service";
import { importPackage } from "./import";
import { checkPackage, ContentPackage, type ExistingKeys } from "./package";
import { parseDecimal, verifyDecimalArithmetic } from "./verify-decimals";

const { app, db, pool } = buildTestApp();
afterAll(() => pool.end());
const API = "/api/v1";

const load = async (name: string) => JSON.parse(await readFile(new URL(`../../../../content/${name}`, import.meta.url), "utf8")) as Record<string, any>;
const none: ExistingKeys = { conceptKeys: new Set(), questionKeys: new Set(), misconceptionKeys: new Set() };
const errors = (pkg: unknown, existing: ExistingKeys = none) => checkPackage(ContentPackage.parse(pkg), existing).filter((i) => i.severity === "error").map((i) => i.message);

const base = () => ({
  formatVersion: 1,
  curriculum: { subject: "Mathematics", title: "T", board: "CBSE", academicYear: "2026-27", grade: 6, language: "en", version: 1, sourceReference: "x" },
  chapter: { title: "Chapter" },
  provenance: { source: "original" },
  concepts: [
    { key: "alpha", title: "Alpha", description: "d", learningObjective: "o", prerequisites: [], teacherNote: "n", resources: ["foundation", "guided", "challenge"].map((level) => ({ level, title: level, content: { summary: "s" } })) },
    { key: "beta", title: "Beta", description: "d", learningObjective: "o", prerequisites: ["alpha"], teacherNote: "n", resources: ["foundation", "guided", "challenge"].map((level) => ({ level, title: level, content: { summary: "s" } })) },
  ],
  questions: [{ key: "q-1", concept: "beta", role: "diagnostic", difficulty: 1, stem: "0.5 + 0.25 = ?", options: [{ id: "a", text: "0.30", misconceptionKey: "m-1" }, { id: "b", text: "0.75" }], correct: "b", explanation: "e" }],
  misconceptions: [{ key: "m-1", category: "conceptual", concept: "beta", name: "M", description: "d", exampleWrongAnswers: ["x"], recommendedExplanation: "r", followUpQuestion: "q-1" }],
  translations: [],
});
const edit = (fn: (p: ReturnType<typeof base>) => void) => {
  const p = base();
  fn(p);
  return p;
};

describe("decimal arithmetic checker", () => {
  it("parses plain decimals exactly, in thousandths", () => {
    expect(parseDecimal("0.25")).toBe(250);
    expect(parseDecimal("₹3.50")).toBe(3500);
    expect(parseDecimal("7")).toBe(7000);
    expect(["1/2", "abc", "-1", "1.2345", ""].map(parseDecimal)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
  const q = (stem: string, options: string[], correctIndex: number) => ({ stem, options: options.map((text) => ({ text })), correctIndex });
  it("verifies sums, differences and comparisons, and catches a wrong or doubled answer", () => {
    expect(verifyDecimalArithmetic(q("0.5 + 0.25 = ?", ["0.30", "0.75", "0.55"], 1)).status).toBe("verified");
    expect(verifyDecimalArithmetic(q("2.5 − 0.75 = ?", ["1.75", "1.25"], 0)).status).toBe("verified");
    expect(verifyDecimalArithmetic(q("0.5 + 0.25 = ?", ["0.30", "0.75"], 0))).toMatchObject({ status: "failed" });
    expect(verifyDecimalArithmetic(q("0.5 + 0.25 = ?", ["0.75", "0.750"], 0)).issues[0]).toMatch(/also correct/);
    expect(verifyDecimalArithmetic(q("Which is smaller: 0.5 or 0.45?", ["0.5", "0.45"], 1)).status).toBe("verified");
    expect(verifyDecimalArithmetic(q("Which is greater: 0.7 or 0.25?", ["0.7", "0.25"], 1)).status).toBe("failed");
    expect(verifyDecimalArithmetic(q("Which list is in order?", ["a", "b"], 0)).status).toBe("not_applicable");
    expect(verifyDecimalArithmetic(q("1 − 2 = ?", ["-1"], 0)).status).toBe("not_applicable"); // negatives are out of scope
  });
});

describe("package checks", () => {
  it("accepts a well-formed package", () => {
    expect(errors(base())).toEqual([]);
  });
  it("refuses unknown references, loops, missing levels and duplicates, with plain messages", () => {
    expect(errors(edit((p) => (p.concepts[1]!.prerequisites = ["nope"])))).toEqual(['Prerequisite "nope" is not a known concept.']);
    expect(errors(edit((p) => (p.concepts[0]!.prerequisites = ["beta"]))).join()).toMatch(/loop/);
    expect(errors(edit((p) => (p.concepts[0]!.resources = p.concepts[0]!.resources.slice(0, 2)))).join()).toMatch(/Missing the challenge explanation/);
    expect(errors(edit((p) => p.concepts.push({ ...p.concepts[0]! }))).join()).toMatch(/concept key "alpha" appears twice/);
    expect(errors(edit((p) => (p.questions[0]!.concept = "ghost"))).join()).toMatch(/concept "ghost" is not known/);
    expect(errors(edit((p) => (p.misconceptions[0]!.followUpQuestion = "ghost"))).join()).toMatch(/follow-up question "ghost" does not exist/);
    expect(errors(edit((p) => (p.questions[0]!.options[0]!.misconceptionKey = "ghost"))).join()).toMatch(/unknown misconception "ghost"/);
  });
  it("refuses a question whose marked answer is wrong, tagged correct answers, and duplicate options", () => {
    expect(errors(edit((p) => (p.questions[0]!.correct = "a"))).join()).toMatch(/Arithmetic check|tagged as a misconception/);
    expect(errors(edit((p) => (p.questions[0]!.options[1]!.text = "0.30"))).join()).toMatch(/Two options both say/);
    expect(errors(edit((p) => (p.questions[0]!.correct = "z"))).join()).toMatch(/not one of the options/);
  });
  it("allows references to concepts that already exist (an earlier chapter), and warns about what it cannot check", () => {
    const existing = { ...none, conceptKeys: new Set(["earlier"]) };
    expect(errors(edit((p) => (p.concepts[0]!.prerequisites = ["earlier"])), existing)).toEqual([]);
    const warnings = checkPackage(ContentPackage.parse(edit((p) => (p.questions[0]!.stem = "Pick one"))), none).filter((i) => i.severity === "warning");
    expect(warnings.map((w) => w.message).join()).toMatch(/Check it by hand/);
  });
  it("rejects bad shapes before anything else", async () => {
    await resetDb(db);
    const report = await importPackage(db, { formatVersion: 2 });
    expect(report.ok).toBe(false);
    expect(report.issues.length).toBeGreaterThan(0);
  });
});

describe("adding a chapter by data only", () => {
  beforeEach(async () => {
    await resetDb(db);
    await seedFractionsClass6(db);
  });

  it("the shipped Decimals chapter checks clean", async () => {
    const report = await importPackage(db, await load("decimals-class6.json"), { dryRun: true });
    expect(report.issues.filter((i) => i.severity === "error")).toEqual([]);
    expect(report).toMatchObject({ ok: true, dryRun: true, created: { concepts: 6, questions: 21, misconceptions: 4 } });
    expect(await db.select().from(chapters)).toHaveLength(1); // a dry run writes nothing
  });

  it("imports a second chapter into the same curriculum, linked to the first by prerequisites", async () => {
    const report = await importPackage(db, await load("decimals-class6.json"), { approve: true });
    expect(report.ok).toBe(true);
    const ch = await db.select().from(chapters).orderBy(chapters.chapterOrder);
    expect(ch.map((c) => [c.title, c.chapterOrder])).toEqual([["Fractions", 1], ["Decimals", 2]]);

    const [cv] = await db.select({ id: concepts.curriculumVersionId }).from(concepts).limit(1);
    const graph = await loadConceptGraph(db, cv!.id);
    const ids = new Map((await db.select().from(concepts)).map((c) => [c.key, c.id]));
    const ancestors = graph.ancestors(ids.get("adding-decimals")!, { maxDepth: 10 }).map((a) => a.id);
    expect(ancestors).toContain(ids.get("fraction-as-part")); // a prerequisite in the Fractions chapter
    expect(ancestors).toContain(ids.get("decimal-place-value"));
    const order = (await db.select().from(concepts).where(eq(concepts.key, "tenths-hundredths")))[0]!.conceptOrder;
    expect(order).toBe(10); // after the nine fractions concepts
  });

  it("is safe to run twice: existing content is left alone", async () => {
    const pkg = await load("decimals-class6.json");
    await importPackage(db, pkg, { approve: true });
    const before = (await db.select().from(questions)).length;
    const again = await importPackage(db, pkg, { approve: true });
    expect(again.ok).toBe(true);
    expect(again.created).toMatchObject({ concepts: 0, questions: 0, misconceptions: 0 });
    expect(again.skipped).toMatchObject({ concepts: 6, questions: 21, misconceptions: 4 });
    expect((await db.select().from(questions)).length).toBe(before);
  });

  it("arrives as drafts unless the author approves, so nothing unreviewed reaches a classroom", async () => {
    await importPackage(db, await load("decimals-class6.json"));
    const agent = await signedInAgent(app);
    const id = (await db.select().from(concepts).where(eq(concepts.key, "comparing-decimals")))[0]!.id;
    const detail = (await agent.get(`${API}/concepts/${id}`)).body;
    expect(detail.questions).toEqual([]); // drafts are not shown, and cannot be used in an assessment
    expect(detail.resources ?? []).toEqual([]);
  });

  it("writes nothing when the package has an error", async () => {
    const pkg = await load("decimals-class6.json");
    pkg.questions[10].correct = "a"; // 0.5 + 0.25 marked as 0.30
    const report = await importPackage(db, pkg, { approve: true });
    expect(report.ok).toBe(false);
    expect(report.issues.filter((i) => i.severity === "error").map((i) => i.message).join()).toMatch(/Arithmetic check/);
    expect(await db.select().from(chapters)).toHaveLength(1);
    expect(await db.select().from(concepts).where(eq(concepts.key, "adding-decimals"))).toHaveLength(0);
  });

  it("the new chapter runs the whole learning loop with no code changes: a diagnostic flags the decimal misconception", async () => {
    await importPackage(db, await load("decimals-class6.json"), { approve: true });
    const teacher = await signedInAgent(app);
    const cls = (await teacher.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body;
    for (const name of ["Ravi", "Meera"]) await teacher.post(`${API}/classes/${cls.id}/students`).send({ name });
    const students = (await teacher.get(`${API}/classes/${cls.id}/students`)).body.students;
    const qs = new Map((await db.select().from(questions)).map((q) => [q.key, q.id]));
    const a = (await teacher.post(`${API}/classes/${cls.id}/assessments`).send({ title: "Decimals check", type: "diagnostic", questionIds: [qs.get("qd-add-1"), qs.get("qd-add-4")] })).body.id;
    for (const to of ["approved", "open"]) await teacher.post(`${API}/assessments/${a}/status`).send({ to });
    const answers = (first: string, second: string) => [{ questionId: qs.get("qd-add-1"), answer: { kind: "option", optionId: first } }, { questionId: qs.get("qd-add-4"), answer: { kind: "option", optionId: second } }];
    // Ravi adds the digits as whole numbers on both questions; Meera is right.
    await teacher.post(`${API}/assessments/${a}/entry`).send({ entries: [{ studentId: students[0].id, answers: answers("a", "b") }, { studentId: students[1].id, answers: answers("b", "a") }] });

    const mis = (await teacher.get(`${API}/classes/${cls.id}/misconceptions`)).body;
    const pattern = mis.patterns.find((p: { name: string }) => p.name === "Adds decimal digits as whole numbers");
    expect(pattern).toBeTruthy();
    expect(pattern.students).toEqual([expect.objectContaining({ name: "Ravi", status: "likely" })]);
    const map = (await teacher.get(`${API}/classes/${cls.id}/learning-map?assessmentId=${a}`)).body;
    expect(map.concepts.map((c: { title: string }) => c.title)).toContain("Adding decimals");
  });
});

describe("translations", () => {
  beforeEach(async () => {
    await resetDb(db);
    await seedFractionsClass6(db);
  });

  it("imports as drafts that never replace the original or reach students, and shows side by side to the teacher", async () => {
    const report = await importPackage(db, await load("fractions-hi-poc.json"), { approve: true });
    expect(report).toMatchObject({ ok: true, created: { translations: 4 } });
    const hindi = await db.select().from(learningResources).where(eq(learningResources.language, "hi"));
    expect(hindi).toHaveLength(4);
    expect(hindi.every((r) => r.reviewStatus === "draft")).toBe(true); // even with --approve, a translation needs a reader of the language

    const teacher = await signedInAgent(app);
    const id = (await db.select().from(concepts).where(eq(concepts.key, "adding-fractions")))[0]!.id;
    const detail = (await teacher.get(`${API}/concepts/${id}`)).body;
    expect(JSON.stringify(detail)).not.toMatch(/[ऀ-ॿ]/); // the normal view stays in the concept's language

    const view = (await teacher.get(`${API}/concepts/${id}/translations`)).body;
    expect(view).toMatchObject({ language: "en", available: ["hi"] });
    const guided = view.levels.find((l: { level: string }) => l.level === "guided");
    expect(guided.original.title).toBe("Adding with unlike denominators");
    expect(guided.translations[0]).toMatchObject({ language: "hi", reviewStatus: "draft", note: expect.stringMatching(/reviewed by a Hindi-medium/) });
    expect(JSON.stringify(guided.translations[0].content)).toContain("1/2 + 1/3"); // notation preserved
    expect(JSON.stringify(guided.translations[0].content)).toContain("5/6");
    expect((await teacher.get(`${API}/concepts/${id}/translations?language=ta`)).body.levels.every((l: { translations: unknown[] }) => l.translations.length === 0)).toBe(true);

    const again = await importPackage(db, await load("fractions-hi-poc.json"));
    expect(again.created.translations).toBe(0);
    expect(again.skipped.translations).toBe(4);
  });

  it("is private to signed-in teachers", async () => {
    const id = (await db.select().from(concepts).where(eq(concepts.key, "adding-fractions")))[0]!.id;
    expect((await (await import("supertest")).default(app).get(`${API}/concepts/${id}/translations`)).status).toBe(401);
  });
});

describe("misconception atlas", () => {
  it("classifies a rule only after enough teacher decisions, and never calls it valid", () => {
    expect(ruleQuality(0, 0, 0)).toBe("no_data");
    expect(ruleQuality(2, 1, 3)).toBe("too_few_decisions");
    expect(ruleQuality(5, 1, 6)).toBe("holding_up");
    expect(ruleQuality(1, 5, 6)).toBe("often_rejected");
    expect(ruleQuality(3, 3, 6)).toBe("mixed");
  });

  it("lists every approved rule by concept with its examples, and counts only the teacher's own students", async () => {
    await resetDb(db);
    await seedFractionsClass6(db);
    const a = await signedInAgent(app);
    const atlas = (await a.get(`${API}/misconceptions/atlas`)).body;
    expect(atlas.minDecisions).toBe(5);
    const adding = atlas.concepts.find((c: { title: string }) => c.title === "Adding fractions");
    const rule = adding.rules.find((r: { key: string }) => r.key === "adds-denominators");
    expect(rule).toMatchObject({ name: "Adds the denominators", category: "conceptual", quality: "no_data", followUpQuestion: expect.stringContaining("2/7") });
    expect(rule.exampleWrongAnswers.length).toBeGreaterThan(0);

    // Evidence in teacher A's class...
    const cls = (await a.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body;
    for (const n of ["Ravi", "Meera"]) await a.post(`${API}/classes/${cls.id}/students`).send({ name: n });
    const st = (await a.get(`${API}/classes/${cls.id}/students`)).body.students;
    const qs = new Map((await db.select().from(questions)).map((q) => [q.key, q.id]));
    const act = (await a.post(`${API}/classes/${cls.id}/assessments`).send({ title: "x", type: "diagnostic", questionIds: [qs.get("q-af-1"), qs.get("q-af-2")] })).body.id;
    for (const to of ["approved", "open"]) await a.post(`${API}/assessments/${act}/status`).send({ to });
    await a.post(`${API}/assessments/${act}/entry`).send({ entries: [{ studentId: st[0].id, answers: ["q-af-1", "q-af-2"].map((k) => ({ questionId: qs.get(k), answer: { kind: "option", optionId: "a" } })) }] });

    const mine = (await a.get(`${API}/misconceptions/atlas`)).body.concepts.find((c: { title: string }) => c.title === "Adding fractions").rules.find((r: { key: string }) => r.key === "adds-denominators");
    expect(mine.stats.studentsObserved).toBe(1);
    expect(mine.quality).toBe("too_few_decisions");
    // ...is invisible to teacher B.
    const b = await signedInAgent(app, "b@example.com", "B");
    const theirs = (await b.get(`${API}/misconceptions/atlas`)).body.concepts.find((c: { title: string }) => c.title === "Adding fractions").rules.find((r: { key: string }) => r.key === "adds-denominators");
    expect(theirs.stats.studentsObserved).toBe(0);
  });
});
