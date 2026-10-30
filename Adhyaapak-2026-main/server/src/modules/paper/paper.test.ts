import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assessmentEvidence, auditLog, conceptMastery, extractionResults, questions, submissionFiles } from "../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { makeJpeg, makePng } from "../../test/make-image";
import { ScriptedProvider } from "../../test/scripted-provider";
import { seedFractionsClass6 } from "../curriculum/seed/seed";
import { aiError } from "../ai/errors";
import { LocalStorage } from "../files/storage";
import { purgeExpiredImages } from "./paper.service";

const API = "/api/v1";
const ai = new ScriptedProvider();
let dir: string;
let app: ReturnType<typeof buildTestApp>["app"];
let db: ReturnType<typeof buildTestApp>["db"];
let pool: ReturnType<typeof buildTestApp>["pool"];
let storage: LocalStorage;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "adhyaapak-paper-"));
  storage = new LocalStorage(dir);
  ({ app, db, pool } = buildTestApp(ai, storage));
});
afterAll(async () => {
  await pool.end();
  await rm(dir, { recursive: true, force: true });
});

type Agent = Awaited<ReturnType<typeof signedInAgent>>;
interface Ctx {
  teacher: Agent;
  classId: string;
  assessmentId: string;
  students: { id: string; name: string; rosterNumber: number }[];
  qid: (key: string) => string;
}
let c: Ctx;

async function setup(status: "open" | "closed" | "approved" = "open"): Promise<Ctx> {
  await resetDb(db);
  await rm(dir, { recursive: true, force: true });
  ai.calls.length = 0;
  await seedFractionsClass6(db);
  const teacher = await signedInAgent(app);
  const cls = (await teacher.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body;
  for (const name of ["Ravi", "Meera", "Anu"]) await teacher.post(`${API}/classes/${cls.id}/students`).send({ name });
  const students = (await teacher.get(`${API}/classes/${cls.id}/students`)).body.students;
  const qs = new Map((await db.select().from(questions)).map((q) => [q.key, q.id]));
  const qid = (k: string) => qs.get(k)!;
  const created = await teacher.post(`${API}/classes/${cls.id}/assessments`).send({ title: "Adding check", type: "diagnostic", questionIds: [qid("q-af-1"), qid("q-af-2")] });
  const assessmentId = created.body.id as string;
  const steps = status === "approved" ? ["approved"] : status === "open" ? ["approved", "open"] : ["approved", "open", "closed"];
  for (const to of steps) await teacher.post(`${API}/assessments/${assessmentId}/status`).send({ to });
  return { teacher, classId: cls.id, assessmentId, students, qid };
}

const upload = (agent: Agent, assessmentId: string, studentId: string, file: Buffer = makeJpeg({ orientation: 6 }), name = "sheet.jpg") =>
  agent.post(`${API}/submission-files`).field("assessmentId", assessmentId).field("studentId", studentId).attach("file", file, name);

const reading = (mark: string, legibility = "clear", note: string | null = null) => ({ mark, legibility, note });
const modelOutput = (r1: ReturnType<typeof reading>, r2: ReturnType<typeof reading>) => ({ answers: [{ question: 1, ...r1 }, { question: 2, ...r2 }] });
const option = (optionId: string) => ({ kind: "option" as const, optionId });

beforeEach(async () => {
  c = await setup();
});

describe("uploading a sheet", () => {
  it("stores a private, cleaned copy and never exposes a URL", async () => {
    const res = await upload(c.teacher, c.assessmentId, c.students[0]!.id);
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ status: "uploaded", studentName: "Ravi", imageAvailable: true, metadataStripped: true, canApprove: false });
    expect(JSON.stringify(res.body)).not.toMatch(/storage|http/i);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.every((i: { needsDecision: boolean; extracted: unknown }) => i.needsDecision && i.extracted === null)).toBe(true);

    const [row] = await db.select().from(submissionFiles);
    const stored = await storage.get(row!.storageKey!);
    expect(stored.toString("latin1")).not.toContain("SECRET-CAMERA-MAKE");

    const img = await c.teacher.get(`${API}/submission-files/${res.body.id}/image`);
    expect(img.status).toBe(200);
    expect(img.headers["content-type"]).toBe("image/jpeg");
    expect(img.headers["cache-control"]).toMatch(/no-store/);
  });

  it("accepts PNG, and refuses anything that is not a real image whatever its name says", async () => {
    expect((await upload(c.teacher, c.assessmentId, c.students[0]!.id, makePng(), "sheet.png")).status).toBe(201);
    const bad: Array<[Buffer, string]> = [
      [Buffer.from("<script>alert(1)</script>"), "evil.jpg"],
      [Buffer.from("%PDF-1.4"), "scan.png"],
      [makeJpeg({ truncate: true }), "cut.jpg"],
    ];
    for (const [bytes, name] of bad) expect((await upload(c.teacher, c.assessmentId, c.students[1]!.id, bytes, name)).status).toBe(400);
    expect(await db.select().from(submissionFiles)).toHaveLength(1);
    expect(await readdir(dir)).toHaveLength(1); // nothing left behind by the refused uploads
  });

  it("checks the activity, the student and duplicates", async () => {
    const other = await signedInAgent(app, "other@example.com", "Other Teacher");
    const otherClass = (await other.post(`${API}/classes`).send({ name: "6B", grade: 6, academicYear: "2026-27" })).body;
    await other.post(`${API}/classes/${otherClass.id}/students`).send({ name: "Zed" });
    const outsider = (await other.get(`${API}/classes/${otherClass.id}/students`)).body.students[0];

    expect((await upload(c.teacher, c.assessmentId, outsider.id)).status).toBe(400); // not in this class
    expect((await upload(c.teacher, c.assessmentId, "not-an-id")).status).toBe(400);
    expect((await upload(c.teacher, "00000000-0000-4000-8000-000000000000", c.students[0]!.id)).status).toBe(404);
    expect((await upload(c.teacher, c.assessmentId, c.students[0]!.id)).status).toBe(201);
    expect((await upload(c.teacher, c.assessmentId, c.students[0]!.id)).status).toBe(409); // already waiting for review
    expect((await c.teacher.post(`${API}/submission-files`).field("assessmentId", c.assessmentId).field("studentId", c.students[1]!.id)).status).toBe(400); // no file

    const notStarted = await setup("approved");
    expect((await upload(notStarted.teacher, notStarted.assessmentId, notStarted.students[0]!.id)).status).toBe(409);
  });

  it("works for a closed activity (paper collected after the lesson)", async () => {
    const closed = await setup("closed");
    expect((await upload(closed.teacher, closed.assessmentId, closed.students[0]!.id)).status).toBe(201);
  });

  it("is invisible to other teachers and to anyone not signed in", async () => {
    const sheet = (await upload(c.teacher, c.assessmentId, c.students[0]!.id)).body;
    const other = await signedInAgent(app, "other@example.com", "Other Teacher");
    for (const path of [`/submission-files/${sheet.id}`, `/submission-files/${sheet.id}/image`, `/assessments/${c.assessmentId}/submission-files`]) {
      expect((await other.get(`${API}${path}`)).status).toBe(404);
    }
    for (const step of ["process", "review", "approve", "reject"]) {
      expect((await other.post(`${API}/submission-files/${sheet.id}/${step}`).send({ confirmSendToAi: true, items: [{ questionId: "00000000-0000-4000-8000-000000000000", reading: { kind: "blank" }, confirmed: true }] })).status).toBe(404);
    }
    expect((await other.delete(`${API}/submission-files/${sheet.id}/image`)).status).toBe(404);
    expect((await upload(other, c.assessmentId, c.students[1]!.id)).status).toBe(404);
    expect((await request(app).get(`${API}/submission-files/${sheet.id}/image`)).status).toBe(401);
  });
});

describe("reading a sheet", () => {
  async function sheet() {
    return (await upload(c.teacher, c.assessmentId, c.students[0]!.id)).body as { id: string };
  }

  it("needs the teacher's confirmation that the photo goes to the AI", async () => {
    const s = await sheet();
    expect((await c.teacher.post(`${API}/submission-files/${s.id}/process`).send({})).status).toBe(400);
    expect((await c.teacher.post(`${API}/submission-files/${s.id}/process`).send({ confirmSendToAi: false })).status).toBe(400);
    expect(ai.calls).toHaveLength(0);
  });

  it("sends the photo and the questions (no answer key), and saves only what was read", async () => {
    const s = await sheet();
    ai.queue(modelOutput(reading("B"), reading("A", "unsure", "faint pencil")));
    const res = await c.teacher.post(`${API}/submission-files/${s.id}/process`).send({ confirmSendToAi: true });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("needs_review");
    expect(res.body.items[0]).toMatchObject({ extracted: { reading: option("b"), legibility: "clear" }, needsDecision: false });
    expect(res.body.items[1]).toMatchObject({ extracted: { reading: option("a"), legibility: "unsure", note: "faint pencil" }, needsDecision: true });

    const call = ai.calls[0]!;
    expect(call.images).toHaveLength(1);
    expect(call.images![0]).toMatchObject({ mimeType: "image/jpeg" });
    expect(call.user).not.toMatch(/correct/i);
    // Reading creates no evidence.
    expect(await db.select().from(assessmentEvidence)).toHaveLength(0);
    expect(await db.select().from(conceptMastery)).toHaveLength(0);
  });

  it("keeps the sheet usable when the AI fails, and says so kindly", async () => {
    const s = await sheet();
    ai.queue(aiError("timeout"));
    const res = await c.teacher.post(`${API}/submission-files/${s.id}/process`).send({ confirmSendToAi: true });
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toMatch(/stack|fake\/model/);
    const [failed] = await db.select().from(extractionResults);
    expect(failed).toMatchObject({ status: "failed", errorCode: "provider_error" });
    const after = (await c.teacher.get(`${API}/submission-files/${s.id}`)).body;
    expect(after.status).toBe("uploaded");
    expect(after.imageAvailable).toBe(true);
  });
});

describe("review and approval", () => {
  async function readSheet(student = 0, first = reading("B"), second = reading("A", "unsure")) {
    const s = (await upload(c.teacher, c.assessmentId, c.students[student]!.id)).body as { id: string };
    ai.queue(modelOutput(first, second));
    await c.teacher.post(`${API}/submission-files/${s.id}/process`).send({ confirmSendToAi: true });
    return s.id;
  }
  const q1 = () => c.qid("q-af-1");
  const q2 = () => c.qid("q-af-2");
  const review = (id: string, items: Array<{ questionId: string; reading: unknown; confirmed: boolean }>) => c.teacher.post(`${API}/submission-files/${id}/review`).send({ items });
  const approve = (id: string) => c.teacher.post(`${API}/submission-files/${id}/approve`).send({});

  it("cannot be approved without a saved review, or while an unclear answer is unconfirmed", async () => {
    const id = await readSheet();
    const first = await approve(id);
    expect(first.status).toBe(409);
    expect(first.body.error.message).toMatch(/Check .*against the photo/);

    const saved = await review(id, [{ questionId: q1(), reading: option("b"), confirmed: false }, { questionId: q2(), reading: option("a"), confirmed: false }]);
    expect(saved.status).toBe(200);
    expect(saved.body.canApprove).toBe(false);
    expect(saved.body.blockers.join(" ")).toMatch(/1 answer was not read clearly/);
    expect((await approve(id)).status).toBe(409);
    expect(await db.select().from(assessmentEvidence)).toHaveLength(0);
  });

  it("turns a reviewed sheet into evidence, once", async () => {
    const id = await readSheet();
    await review(id, [{ questionId: q1(), reading: option("b"), confirmed: false }, { questionId: q2(), reading: option("a"), confirmed: true }]); // Q2: the teacher confirms "A"
    const res = await approve(id);
    expect(res.status).toBe(200);
    expect(res.body.alreadyApproved).toBe(false);

    const evidence = await db.select().from(assessmentEvidence);
    expect(evidence.length).toBeGreaterThanOrEqual(2);
    expect(evidence.every((e) => e.source === "paper_reviewed")).toBe(true);
    expect(evidence.some((e) => e.result === "correct")).toBe(true); // Q1 "b" is right
    expect(evidence.some((e) => e.result === "incorrect")).toBe(true); // Q2 "a" (adds denominators) is wrong
    expect((await db.select().from(conceptMastery)).length).toBeGreaterThan(0);

    const again = await approve(id);
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ alreadyApproved: true, attemptId: res.body.attemptId });
    expect(await db.select().from(assessmentEvidence)).toHaveLength(evidence.length); // nothing duplicated

    const sheet = (await c.teacher.get(`${API}/submission-files/${id}`)).body;
    expect(sheet.status).toBe("approved");
    expect(sheet.deleteAfter).toBeTruthy();
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "paper.approve"))).toHaveLength(1);
  });

  it("records an unreadable answer as no evidence, never as wrong", async () => {
    const id = await readSheet(0, reading("B"), reading("unreadable", "unreadable"));
    await review(id, [{ questionId: q1(), reading: option("b"), confirmed: false }, { questionId: q2(), reading: { kind: "unreadable" }, confirmed: true }]);
    expect((await approve(id)).status).toBe(200);
    const evidence = await db.select().from(assessmentEvidence);
    expect(evidence.filter((e) => e.result === "insufficient").length).toBeGreaterThan(0);
    expect(evidence.filter((e) => e.result === "incorrect")).toHaveLength(0);
  });

  it("counts a teacher's change as their own decision, and the accuracy log shows it", async () => {
    // The reader said "A" (clear) for Q1; the photo actually shows "B".
    const id = await readSheet(0, reading("A"), reading("B"));
    await review(id, [{ questionId: q1(), reading: option("b"), confirmed: false }, { questionId: q2(), reading: option("b"), confirmed: false }]);
    const saved = (await c.teacher.get(`${API}/submission-files/${id}`)).body;
    expect(saved.items[0].reviewed).toMatchObject({ reading: option("b"), confirmed: true }); // changed, so confirmed
    expect((await approve(id)).status).toBe(200);
    const acc = (await c.teacher.get(`${API}/paper-accuracy`)).body;
    expect(acc).toMatchObject({ sheetsReviewed: 1, answersReviewed: 2, answersAsRead: 1, answersCorrectedByTeacher: 1, clearReadings: 2, clearReadingsUnchanged: 1 });
  });

  it("supports entering answers by hand from the photo when nothing was read", async () => {
    const s = (await upload(c.teacher, c.assessmentId, c.students[1]!.id)).body;
    const partly = await review(s.id, [{ questionId: q1(), reading: option("b"), confirmed: false }, { questionId: q2(), reading: option("b"), confirmed: true }]);
    expect(partly.body.canApprove).toBe(false); // Q1 was never read, so the teacher must confirm it
    await review(s.id, [{ questionId: q1(), reading: option("b"), confirmed: true }, { questionId: q2(), reading: option("b"), confirmed: true }]);
    expect((await approve(s.id)).status).toBe(200);
    expect((await c.teacher.get(`${API}/paper-accuracy`)).body.sheetsReviewed).toBe(0); // nothing was read, so nothing to measure
  });

  it("validates the review", async () => {
    const id = await readSheet();
    expect((await review(id, [{ questionId: "00000000-0000-4000-8000-000000000000", reading: option("a"), confirmed: true }])).status).toBe(400);
    expect((await review(id, [{ questionId: q1(), reading: option("z"), confirmed: true }])).status).toBe(400);
    expect((await review(id, [{ questionId: q1(), reading: option("a"), confirmed: true }, { questionId: q1(), reading: option("b"), confirmed: true }])).status).toBe(400);
    expect((await c.teacher.post(`${API}/submission-files/${id}/review`).send({ items: [] })).status).toBe(400);
  });

  it("refuses when the student has since answered another way", async () => {
    const id = await readSheet();
    await review(id, [{ questionId: q1(), reading: option("b"), confirmed: true }, { questionId: q2(), reading: option("b"), confirmed: true }]);
    await c.teacher.post(`${API}/assessments/${c.assessmentId}/entry`).send({ entries: [{ studentId: c.students[0]!.id, answers: [{ questionId: q1(), answer: option("b") }] }] });
    const res = await approve(id);
    expect(res.status).toBe(409);
    expect((await db.select().from(submissionFiles).where(eq(submissionFiles.id, id)))[0]!.status).toBe("needs_review");
  });

  it("a rejected sheet never becomes evidence, its photo is deleted, and a new one can replace it", async () => {
    const id = await readSheet();
    await review(id, [{ questionId: q1(), reading: option("b"), confirmed: true }, { questionId: q2(), reading: option("b"), confirmed: true }]);
    expect((await c.teacher.post(`${API}/submission-files/${id}/reject`).send({})).status).toBe(204);
    expect(await readdir(dir)).toHaveLength(0);
    expect((await approve(id)).status).toBe(409);
    expect(await db.select().from(assessmentEvidence)).toHaveLength(0);
    expect((await c.teacher.get(`${API}/submission-files/${id}/image`)).status).toBe(404);
    expect((await upload(c.teacher, c.assessmentId, c.students[0]!.id)).status).toBe(201);
  });

  it("an approved sheet cannot be rejected", async () => {
    const id = await readSheet(0, reading("B"), reading("B"));
    await review(id, [{ questionId: q1(), reading: option("b"), confirmed: false }, { questionId: q2(), reading: option("b"), confirmed: false }]);
    expect((await approve(id)).status).toBe(200);
    expect((await c.teacher.post(`${API}/submission-files/${id}/reject`).send({})).status).toBe(409);
  });
});

describe("retention and deletion", () => {
  async function approvedSheet() {
    const s = (await upload(c.teacher, c.assessmentId, c.students[0]!.id)).body;
    await c.teacher.post(`${API}/submission-files/${s.id}/review`).send({ items: [{ questionId: c.qid("q-af-1"), reading: option("b"), confirmed: true }, { questionId: c.qid("q-af-2"), reading: option("b"), confirmed: true }] });
    expect((await c.teacher.post(`${API}/submission-files/${s.id}/approve`).send({})).status).toBe(200);
    return s.id as string;
  }

  it("deletes the photo when its retention period ends, but keeps the answers", async () => {
    const id = await approvedSheet();
    expect(await purgeExpiredImages(db, storage)).toBe(0); // not yet due
    expect(await readdir(dir)).toHaveLength(1);
    const later = new Date(Date.now() + 31 * 24 * 3600_000);
    expect(await purgeExpiredImages(db, storage, later)).toBe(1);
    expect(await readdir(dir)).toHaveLength(0);
    expect((await c.teacher.get(`${API}/submission-files/${id}`)).body).toMatchObject({ status: "approved", imageAvailable: false });
    expect((await db.select().from(assessmentEvidence)).length).toBeGreaterThan(0);
    expect(await purgeExpiredImages(db, storage, later)).toBe(0); // safe to repeat
  });

  it("lets the teacher delete a photo at any time; a pending sheet is then rejected", async () => {
    const id = await approvedSheet();
    expect((await c.teacher.delete(`${API}/submission-files/${id}/image`)).status).toBe(204);
    expect(await readdir(dir)).toHaveLength(0);
    expect((await c.teacher.get(`${API}/submission-files/${id}`)).body.status).toBe("approved");

    const pending = (await upload(c.teacher, c.assessmentId, c.students[1]!.id)).body;
    expect((await c.teacher.delete(`${API}/submission-files/${pending.id}/image`)).status).toBe(204);
    expect((await c.teacher.get(`${API}/submission-files/${pending.id}`)).body.status).toBe("rejected");
  });

  it("lists the sheets for an activity", async () => {
    await approvedSheet();
    await upload(c.teacher, c.assessmentId, c.students[1]!.id);
    const list = (await c.teacher.get(`${API}/assessments/${c.assessmentId}/submission-files`)).body.submissions;
    expect(list.map((s: { studentName: string; status: string }) => `${s.studentName}:${s.status}`).sort()).toEqual(["Meera:uploaded", "Ravi:approved"]);
  });
});
