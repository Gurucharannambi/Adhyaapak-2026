import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { assessments, assessmentEvidence, assessmentAttempts, classEnrolments, classes, concepts, conceptMastery, misconceptionObservations, questionResponses, questions, studentProfiles, users } from "../../../db/schema";
import { buildTestApp, resetDb } from "../../../test/helpers";
import { seedFractionsClass6 } from "../../curriculum/seed/seed";
import { advanceAssessment, createAssessment } from "../assessment/assessment.repo";
import type { StudentResponse } from "../assessment/types";
import { recommendNextActivity } from "../adaptation/policy";
import { loadConceptGraph } from "../graph/graph.repo";
import { BaselineMasteryEstimator } from "../mastery/baseline-estimator";
import { withLearningConfig } from "../config";
import { loadMasteryMap, recomputeAllMastery } from "./mastery.service";
import { misconceptionStats, reviewMisconception } from "./misconception.service";
import { submitAttempt } from "./attempt.service";

const { db, pool } = buildTestApp();
afterAll(() => pool.end());

interface World {
  teacherId: string;
  otherTeacherId: string;
  classId: string;
  studentId: string;
  cvId: string;
  qid: (key: string) => string;
  cid: (key: string) => string;
}

let keyCounter = 0;
const newKey = () => `key-${++keyCounter}`;

async function setup(): Promise<World> {
  await resetDb(db);
  const { curriculumVersionId } = await seedFractionsClass6(db);
  const [teacher] = await db.insert(users).values({ name: "T", email: "t@example.com", passwordHash: "x", role: "teacher" }).returning();
  const [other] = await db.insert(users).values({ name: "O", email: "o@example.com", passwordHash: "x", role: "teacher" }).returning();
  const [cls] = await db.insert(classes).values({ teacherId: teacher!.id, name: "6A", grade: 6, academicYear: "2026-27", joinCode: "ABC234" }).returning();
  const [student] = await db.insert(studentProfiles).values({ name: "Ravi" }).returning();
  await db.insert(classEnrolments).values({ classId: cls!.id, studentId: student!.id, rosterNumber: 1 });
  const qs = await db.select().from(questions);
  const cs = await db.select().from(concepts);
  const qMap = new Map(qs.map((q) => [q.key, q.id]));
  const cMap = new Map(cs.map((c) => [c.key, c.id]));
  return {
    teacherId: teacher!.id,
    otherTeacherId: other!.id,
    classId: cls!.id,
    studentId: student!.id,
    cvId: curriculumVersionId,
    qid: (k) => qMap.get(k)!,
    cid: (k) => cMap.get(k)!,
  };
}

async function openAssessment(w: World, questionKeys: string[], type: "diagnostic" | "follow_up" = "diagnostic") {
  // A class can have one open activity at a time, as in real use.
  await db.update(assessments).set({ status: "closed" }).where(and(eq(assessments.classId, w.classId), eq(assessments.status, "open")));
  const a = await createAssessment(db, { classId: w.classId, teacherId: w.teacherId, title: "Check", type, questionIds: questionKeys.map(w.qid) });
  await advanceAssessment(db, a.id, "approved");
  await advanceAssessment(db, a.id, "open");
  return a;
}

const pick = (optionId: string): StudentResponse => ({ kind: "option", optionId });

describe("submitAttempt: the assess → diagnose → mastery loop", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });

  it("stores responses, evidence and mastery together, and one wrong answer is only a candidate", async () => {
    const a = await openAssessment(w, ["q-af-1"]);
    const res = await submitAttempt(db, {
      assessmentId: a.id, studentId: w.studentId, source: "device_response", idempotencyKey: newKey(),
      responses: [{ questionId: w.qid("q-af-1"), response: pick("a"), selfConfidence: "sure" }], // 1/2+1/3 = 2/5
    });

    expect(res.duplicate).toBe(false);
    expect(res.responses[0]).toMatchObject({ result: "incorrect", reason: "wrong_option" });
    expect(res.responses[0]!.diagnosis).toMatchObject({ outcome: "insufficient_evidence", misconceptionStatus: "candidate", reviewRequired: false });
    expect(res.responses[0]!.diagnosis!.followUpQuestionId).toBe(w.qid("q-af-2"));

    expect(await db.select().from(questionResponses)).toHaveLength(1);
    const ev = await db.select().from(assessmentEvidence);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ result: "incorrect", confidence: "high", reviewStatus: "not_required", selfConfidence: "sure", relationship: "primary" });

    // One answer is never enough for a status (CLAUDE.md §7).
    const [m] = await db.select().from(conceptMastery);
    expect(m).toMatchObject({ status: "not_enough_evidence", evidenceCount: 1, algorithmVersion: "baseline-1.0.0" });
  });

  it("a second wrong answer with the same pattern on a DIFFERENT question makes it 'likely' and asks for teacher review", async () => {
    const a1 = await openAssessment(w, ["q-af-1"]);
    await submitAttempt(db, { assessmentId: a1.id, studentId: w.studentId, source: "device_response", idempotencyKey: newKey(), responses: [{ questionId: w.qid("q-af-1"), response: pick("a"), selfConfidence: "sure" }] });

    const a2 = await openAssessment(w, ["q-af-2"], "follow_up");
    const res = await submitAttempt(db, { assessmentId: a2.id, studentId: w.studentId, source: "device_response", idempotencyKey: newKey(), responses: [{ questionId: w.qid("q-af-2"), response: pick("a"), selfConfidence: "sure" }] }); // 2/7+3/7 = 5/14

    expect(res.responses[0]!.diagnosis).toMatchObject({ outcome: "likely_conceptual_misconception", misconceptionStatus: "likely", reviewRequired: true });
    const statuses = (await db.select().from(misconceptionObservations)).map((o) => o.status);
    expect(statuses).toEqual(["likely", "likely"]); // the earlier candidate was promoted too

    // Two confident wrong answers → mastery needs foundation, and the policy can now say why.
    const mastery = await loadMasteryMap(db, w.studentId);
    expect(mastery.get(w.cid("adding-fractions"))!.status).toBe("needs_foundation");
  });

  it("is idempotent: retrying with the same key returns the original attempt and writes nothing new", async () => {
    const a = await openAssessment(w, ["q-af-1", "q-af-2"]);
    const input = { assessmentId: a.id, studentId: w.studentId, source: "offline_synced" as const, idempotencyKey: "retry-me", responses: [{ questionId: w.qid("q-af-1"), response: pick("b") }] };
    const first = await submitAttempt(db, input);
    const second = await submitAttempt(db, input);
    expect(second.duplicate).toBe(true);
    expect(second.attemptId).toBe(first.attemptId);
    expect(await db.select().from(assessmentAttempts)).toHaveLength(1);
    expect(await db.select().from(assessmentEvidence)).toHaveLength(2); // primary + also_assesses(common-denominator)
  });

  it("handles two simultaneous retries of the same submission without duplicating anything", async () => {
    const a = await openAssessment(w, ["q-af-1"]);
    const input = { assessmentId: a.id, studentId: w.studentId, source: "offline_synced" as const, idempotencyKey: "race", responses: [{ questionId: w.qid("q-af-1"), response: pick("a") }] };
    const results = await Promise.all([submitAttempt(db, input), submitAttempt(db, input), submitAttempt(db, input)]);
    expect(new Set(results.map((r) => r.attemptId)).size).toBe(1);
    expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
    expect(await db.select().from(assessmentAttempts)).toHaveLength(1);
    expect(await db.select().from(misconceptionObservations)).toHaveLength(1);
  });

  it("rejects a second submission by the same student with a different key, and key reuse for another submission", async () => {
    const a = await openAssessment(w, ["q-af-1"]);
    await submitAttempt(db, { assessmentId: a.id, studentId: w.studentId, source: "device_response", idempotencyKey: "k1", responses: [{ questionId: w.qid("q-af-1"), response: pick("b") }] });
    await expect(submitAttempt(db, { assessmentId: a.id, studentId: w.studentId, source: "device_response", idempotencyKey: "k2", responses: [{ questionId: w.qid("q-af-1"), response: pick("a") }] })).rejects.toMatchObject({ code: "conflict" });

    const b = await openAssessment(w, ["q-af-2"]);
    await expect(submitAttempt(db, { assessmentId: b.id, studentId: w.studentId, source: "device_response", idempotencyKey: "k1", responses: [{ questionId: w.qid("q-af-2"), response: pick("b") }] })).rejects.toMatchObject({ code: "conflict" });
  });

  it("is atomic: an invalid response leaves nothing behind", async () => {
    const a = await openAssessment(w, ["q-af-1"]);
    await expect(
      submitAttempt(db, { assessmentId: a.id, studentId: w.studentId, source: "device_response", idempotencyKey: newKey(), responses: [{ questionId: w.qid("q-af-1"), response: pick("b") }, { questionId: w.qid("q-mf-1"), response: pick("b") }] }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(await db.select().from(assessmentAttempts)).toHaveLength(0);
    expect(await db.select().from(assessmentEvidence)).toHaveLength(0);
  });

  it("refuses closed assessments, students outside the class, duplicate answers and empty submissions", async () => {
    const draft = await createAssessment(db, { classId: w.classId, teacherId: w.teacherId, title: "d", type: "diagnostic", questionIds: [w.qid("q-af-1")] });
    const base = { studentId: w.studentId, source: "device_response" as const, responses: [{ questionId: w.qid("q-af-1"), response: pick("b") }] };
    await expect(submitAttempt(db, { ...base, assessmentId: draft.id, idempotencyKey: newKey() })).rejects.toMatchObject({ code: "conflict" });

    const open = await openAssessment(w, ["q-af-1"]);
    const [stranger] = await db.insert(studentProfiles).values({ name: "Stranger" }).returning();
    await expect(submitAttempt(db, { ...base, studentId: stranger!.id, assessmentId: open.id, idempotencyKey: newKey() })).rejects.toMatchObject({ code: "forbidden" });
    await expect(submitAttempt(db, { ...base, assessmentId: open.id, idempotencyKey: newKey(), responses: [...base.responses, ...base.responses] })).rejects.toMatchObject({ code: "validation_error" });
    await expect(submitAttempt(db, { ...base, assessmentId: open.id, idempotencyKey: newKey(), responses: [] })).rejects.toMatchObject({ code: "validation_error" });
  });

  it("withdrawn students cannot submit", async () => {
    const a = await openAssessment(w, ["q-af-1"]);
    await db.update(classEnrolments).set({ status: "withdrawn" });
    await expect(submitAttempt(db, { assessmentId: a.id, studentId: w.studentId, source: "device_response", idempotencyKey: newKey(), responses: [{ questionId: w.qid("q-af-1"), response: pick("b") }] })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("Case D: blank and unreadable answers are recorded as insufficient evidence and never change mastery or blame the student", async () => {
    const a = await openAssessment(w, ["q-af-1", "q-af-2", "q-af-3"]);
    const res = await submitAttempt(db, {
      assessmentId: a.id, studentId: w.studentId, source: "teacher_entered", idempotencyKey: newKey(),
      responses: [
        { questionId: w.qid("q-af-1"), response: { kind: "blank" } },
        { questionId: w.qid("q-af-2"), response: { kind: "unreadable" } },
        { questionId: w.qid("q-af-3"), response: { kind: "text", text: "banana" } },
      ],
    });
    expect(res.responses.map((r) => r.result)).toEqual(["insufficient", "insufficient", "insufficient"]);
    for (const r of res.responses) expect(r.diagnosis).toMatchObject({ outcome: "insufficient_evidence", reviewRequired: true });
    expect(await db.select().from(misconceptionObservations)).toHaveLength(0);
    const ev = await db.select().from(assessmentEvidence);
    expect(ev.filter((e) => e.reviewStatus === "pending")).toHaveLength(2); // unreadable + unrecognised text await review
    expect((await db.select().from(conceptMastery))[0]).toMatchObject({ evidenceCount: 0, status: "not_enough_evidence" });
  });

  it("typed paper answers are mapped to options and diagnosed like device answers", async () => {
    const a = await openAssessment(w, ["q-af-1"]);
    const res = await submitAttempt(db, { assessmentId: a.id, studentId: w.studentId, source: "teacher_entered", idempotencyKey: newKey(), responses: [{ questionId: w.qid("q-af-1"), response: { kind: "text", text: " 2 / 5 " } }] });
    expect(res.responses[0]!.diagnosis!.misconceptionStatus).toBe("candidate");
  });

  it("a correct answer also credits the prerequisite skills it used, but a wrong one does not blame them", async () => {
    const a = await openAssessment(w, ["q-af-1", "q-sf-2"]);
    await submitAttempt(db, {
      assessmentId: a.id, studentId: w.studentId, source: "device_response", idempotencyKey: newKey(),
      responses: [{ questionId: w.qid("q-af-1"), response: pick("b") }, { questionId: w.qid("q-sf-2"), response: pick("a") }],
    });
    const ev = await db.select().from(assessmentEvidence).where(eq(assessmentEvidence.conceptId, w.cid("common-denominator")));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ relationship: "also_assesses", result: "correct", confidence: "medium" });
  });

  it("a correct follow-up after one slip does not escalate, and a guess never corroborates", async () => {
    const a1 = await openAssessment(w, ["q-af-1"]);
    await submitAttempt(db, { assessmentId: a1.id, studentId: w.studentId, source: "device_response", idempotencyKey: newKey(), responses: [{ questionId: w.qid("q-af-1"), response: pick("a") }] });
    const a2 = await openAssessment(w, ["q-af-2"], "follow_up");
    const res = await submitAttempt(db, { assessmentId: a2.id, studentId: w.studentId, source: "device_response", idempotencyKey: newKey(), responses: [{ questionId: w.qid("q-af-2"), response: pick("b") }] });
    expect(res.responses[0]!.diagnosis!.outcome).toBe("correct_targeted_skill");
    expect((await db.select().from(misconceptionObservations))[0]!.status).toBe("candidate");

    const a3 = await openAssessment(w, ["q-af-3"]);
    const guess = await submitAttempt(db, { assessmentId: a3.id, studentId: w.studentId, source: "device_response", idempotencyKey: newKey(), responses: [{ questionId: w.qid("q-af-3"), response: pick("a"), selfConfidence: "guess" }] });
    expect(guess.responses[0]!.diagnosis!.misconceptionStatus).toBe("candidate");
  });

  it("uses the original answer time (offline sync) for evidence", async () => {
    const a = await openAssessment(w, ["q-af-1"]);
    const when = new Date("2026-09-01T09:00:00Z");
    await submitAttempt(db, { assessmentId: a.id, studentId: w.studentId, source: "offline_synced", idempotencyKey: newKey(), observedAt: when, responses: [{ questionId: w.qid("q-af-1"), response: pick("b") }] });
    expect((await db.select().from(assessmentEvidence))[0]!.observedAt.toISOString()).toBe(when.toISOString());
  });
});

describe("teacher review of misconceptions", () => {
  let w: World;
  beforeEach(async () => {
    w = await setup();
  });

  async function makeLikely() {
    for (const [k, q] of [["a1", "q-af-1"], ["a2", "q-af-2"]] as const) {
      const a = await openAssessment(w, [q]);
      await submitAttempt(db, { assessmentId: a.id, studentId: w.studentId, source: "device_response", idempotencyKey: k, responses: [{ questionId: w.qid(q), response: pick("a") }] });
    }
    const patternId = (await db.select({ patternId: misconceptionObservations.patternId }).from(misconceptionObservations).limit(1))[0]!.patternId;
    return patternId;
  }

  it("confirm marks every observation confirmed, records the reviewer, and keeps the diagnosis confirmed afterwards", async () => {
    const patternId = await makeLikely();
    expect(await reviewMisconception(db, { id: w.teacherId, role: "teacher" }, { studentId: w.studentId, patternId, decision: "confirm" })).toEqual({ updated: 2 });
    const obs = await db.select().from(misconceptionObservations);
    expect(obs.every((o) => o.status === "confirmed" && o.reviewedBy === w.teacherId && o.reviewedAt)).toBe(true);

    const a = await openAssessment(w, ["q-af-3"]);
    const res = await submitAttempt(db, { assessmentId: a.id, studentId: w.studentId, source: "device_response", idempotencyKey: "later", responses: [{ questionId: w.qid("q-af-3"), response: pick("a") }] });
    expect(res.responses[0]!.diagnosis).toMatchObject({ misconceptionStatus: "confirmed", reviewRequired: false });
  });

  it("cannot confirm a pattern seen only once (candidate)", async () => {
    const a = await openAssessment(w, ["q-af-1"]);
    await submitAttempt(db, { assessmentId: a.id, studentId: w.studentId, source: "device_response", idempotencyKey: "x", responses: [{ questionId: w.qid("q-af-1"), response: pick("a") }] });
    const patternId = (await db.select({ patternId: misconceptionObservations.patternId }).from(misconceptionObservations))[0]!.patternId;
    await expect(reviewMisconception(db, { id: w.teacherId, role: "teacher" }, { studentId: w.studentId, patternId, decision: "confirm" })).rejects.toMatchObject({ code: "conflict" });
    // …but it can be rejected.
    await expect(reviewMisconception(db, { id: w.teacherId, role: "teacher" }, { studentId: w.studentId, patternId, decision: "reject" })).resolves.toEqual({ updated: 1 });
  });

  it("rejected observations stop counting toward corroboration", async () => {
    const patternId = await makeLikely();
    await reviewMisconception(db, { id: w.teacherId, role: "teacher" }, { studentId: w.studentId, patternId, decision: "reject" });
    const a = await openAssessment(w, ["q-af-3"]);
    const res = await submitAttempt(db, { assessmentId: a.id, studentId: w.studentId, source: "device_response", idempotencyKey: "after-reject", responses: [{ questionId: w.qid("q-af-3"), response: pick("a") }] });
    expect(res.responses[0]!.diagnosis!.misconceptionStatus).toBe("candidate");
  });

  it("another teacher cannot review (404), and there is nothing to review once decided", async () => {
    const patternId = await makeLikely();
    await expect(reviewMisconception(db, { id: w.otherTeacherId, role: "teacher" }, { studentId: w.studentId, patternId, decision: "confirm" })).rejects.toMatchObject({ code: "not_found" });
    await expect(reviewMisconception(db, { id: w.teacherId, role: "student" }, { studentId: w.studentId, patternId, decision: "confirm" })).rejects.toMatchObject({ code: "not_found" });
    await reviewMisconception(db, { id: w.teacherId, role: "teacher" }, { studentId: w.studentId, patternId, decision: "confirm" });
    await expect(reviewMisconception(db, { id: w.teacherId, role: "teacher" }, { studentId: w.studentId, patternId, decision: "reject" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("reports honest per-rule stats: students observed, decisions and confirm rate (null until decided)", async () => {
    const patternId = await makeLikely();
    let stat = (await misconceptionStats(db)).find((s) => s.patternId === patternId)!;
    expect(stat).toMatchObject({ key: "adds-denominators", studentsObserved: 1, likely: 1, confirmed: 0, rejected: 0, confirmRate: null });
    await reviewMisconception(db, { id: w.teacherId, role: "teacher" }, { studentId: w.studentId, patternId, decision: "confirm" });
    stat = (await misconceptionStats(db)).find((s) => s.patternId === patternId)!;
    expect(stat).toMatchObject({ confirmed: 1, confirmRate: 1 });
    expect((await misconceptionStats(db)).filter((s) => s.studentsObserved === 0).length).toBeGreaterThan(5);
  });
});

describe("end to end: evidence → mastery → recommendation", () => {
  it("two confident wrong answers on adding fractions with no prerequisite evidence → probe the prerequisite, not foundation work", async () => {
    const w = await setup();
    for (const [k, q] of [["e1", "q-af-1"], ["e2", "q-af-2"]] as const) {
      const a = await openAssessment(w, [q]);
      await submitAttempt(db, { assessmentId: a.id, studentId: w.studentId, source: "device_response", idempotencyKey: k, responses: [{ questionId: w.qid(q), response: pick("a"), selfConfidence: "sure" }] });
    }
    const graph = await loadConceptGraph(db, w.cvId);
    const masteryByConcept = await loadMasteryMap(db, w.studentId);
    const rec = recommendNextActivity({ studentId: w.studentId, conceptId: w.cid("adding-fractions"), graph, masteryByConcept, misconceptions: [{ patternId: "p", name: "Adds the denominators" }] });

    expect(rec.activity.type).toBe("prerequisite_diagnostic");
    expect(rec.conceptId).toBe(w.cid("common-denominator"));
    expect(rec.evidenceIds).toEqual(masteryByConcept.get(w.cid("adding-fractions"))!.evidenceIds);
    expect(rec.reason).toMatch(/Adds the denominators/);
  });

  it("the real seeded graph loads, validates and gives a sensible sequence", async () => {
    const w = await setup();
    const graph = await loadConceptGraph(db, w.cvId);
    const names = (await db.select().from(concepts)).reduce((m, c) => m.set(c.id, c.key), new Map<string, string>());
    const seq = graph.learningSequence().map((id) => names.get(id));
    expect(seq.indexOf("equivalent-fractions")).toBeLessThan(seq.indexOf("common-denominator"));
    expect(seq.indexOf("common-denominator")).toBeLessThan(seq.indexOf("adding-fractions"));
    expect(seq.at(-1)).toBe("fraction-word-problems");
    expect(graph.ancestors(w.cid("fraction-word-problems"), { maxDepth: 1 }).map((a) => names.get(a.id))).toEqual(["adding-fractions", "subtracting-fractions"]);
  });
});

describe("reproducibility", () => {
  it("recomputeAllMastery rebuilds the cache from the ledger and applies a changed algorithm without touching evidence", async () => {
    const w = await setup();
    const a = await openAssessment(w, ["q-af-1", "q-af-2", "q-af-3"]);
    await submitAttempt(db, {
      assessmentId: a.id, studentId: w.studentId, source: "device_response", idempotencyKey: newKey(),
      responses: ["q-af-1", "q-af-2", "q-af-3"].map((k) => ({ questionId: w.qid(k), response: pick("b") })),
    });
    const before = (await db.select().from(conceptMastery).where(eq(conceptMastery.conceptId, w.cid("adding-fractions"))))[0]!;
    expect(before.status).toBe("likely_secure");
    const evidenceBefore = await db.select().from(assessmentEvidence);

    // Wipe the cache entirely, then rebuild it from evidence alone.
    await db.delete(conceptMastery);
    await recomputeAllMastery(db);
    const rebuilt = (await db.select().from(conceptMastery).where(eq(conceptMastery.conceptId, w.cid("adding-fractions"))))[0]!;
    expect({ status: rebuilt.status, estimate: rebuilt.estimate, count: rebuilt.evidenceCount }).toEqual({ status: before.status, estimate: before.estimate, count: before.evidenceCount });

    // A stricter configuration changes the status, from the same evidence.
    const strict = new BaselineMasteryEstimator(withLearningConfig({ mastery: { thresholds: { secureMinItems: 5 } } }).mastery);
    await recomputeAllMastery(db, { estimator: strict });
    const restricted = (await db.select().from(conceptMastery).where(and(eq(conceptMastery.conceptId, w.cid("adding-fractions")))))[0]!;
    expect(restricted.status).toBe("developing");
    expect(await db.select().from(assessmentEvidence)).toEqual(evidenceBefore);
  });
});
