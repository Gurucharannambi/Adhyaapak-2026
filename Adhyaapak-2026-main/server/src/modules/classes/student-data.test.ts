import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { assessmentEvidence, auditLog, studentProfiles, studentSessions, submissionFiles } from "../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { makeJpeg } from "../../test/make-image";
import { seedFractionsClass6 } from "../curriculum/seed/seed";
import { LocalStorage } from "../files/storage";
import { questions } from "../../db/schema";

const API = "/api/v1";
let dir: string;
let app: ReturnType<typeof buildTestApp>["app"];
let db: ReturnType<typeof buildTestApp>["db"];
let pool: ReturnType<typeof buildTestApp>["pool"];

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "adhyaapak-erase-"));
  ({ app, db, pool } = buildTestApp(undefined, new LocalStorage(dir)));
});
afterAll(async () => {
  await pool.end();
  await rm(dir, { recursive: true, force: true });
});

type Agent = Awaited<ReturnType<typeof signedInAgent>>;
let teacher: Agent;
let classId: string;
let joinCode: string;
let students: { id: string; name: string; rosterNumber: number }[];

beforeEach(async () => {
  await resetDb(db);
  await rm(dir, { recursive: true, force: true });
  await seedFractionsClass6(db);
  teacher = await signedInAgent(app);
  const cls = (await teacher.post(`${API}/classes`).send({ name: "6A", grade: 6, academicYear: "2026-27" })).body;
  classId = cls.id;
  joinCode = cls.joinCode;
  for (const name of ["Ravi Kumar", "Meera Rao"]) await teacher.post(`${API}/classes/${classId}/students`).send({ name, referenceId: `ADM-${name[0]}` });
  students = (await teacher.get(`${API}/classes/${classId}/students`)).body.students;
});

describe("correcting a student's record", () => {
  it("fixes a name, reference and roll number, and keeps roll numbers unique", async () => {
    const res = await teacher.patch(`${API}/classes/${classId}/students/${students[0]!.id}`).send({ name: "Ravi Kumaar", referenceId: "ADM-001", rosterNumber: 9 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ name: "Ravi Kumaar", referenceId: "ADM-001", rosterNumber: 9 });
    expect((await teacher.patch(`${API}/classes/${classId}/students/${students[0]!.id}`).send({ rosterNumber: students[1]!.rosterNumber })).status).toBe(409);
    expect((await teacher.patch(`${API}/classes/${classId}/students/${students[0]!.id}`).send({ referenceId: null })).body.referenceId).toBeNull();
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "student.correct"))).length).toBe(3 - 1); // the refused one is not logged
  });

  it("validates, and is private to the class's teacher", async () => {
    const url = `${API}/classes/${classId}/students/${students[0]!.id}`;
    expect((await teacher.patch(url).send({})).status).toBe(400);
    expect((await teacher.patch(url).send({ name: "" })).status).toBe(400);
    expect((await teacher.patch(url).send({ rosterNumber: 0 })).status).toBe(400);
    expect((await teacher.patch(`${API}/classes/${classId}/students/not-an-id`).send({ name: "x" })).status).toBe(404);
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await other.patch(url).send({ name: "Hacked" })).status).toBe(404);
    expect((await teacher.get(`${API}/classes/${classId}/students`)).body.students[0].name).toBe("Ravi Kumar");
  });
});

describe("erasing a student's personal details", () => {
  async function withData() {
    const a = students[0]!;
    // An answer in the ledger, a join session, and a photographed sheet.
    const qs = new Map((await db.select().from(questions)).map((q) => [q.key, q.id]));
    const act = (await teacher.post(`${API}/classes/${classId}/assessments`).send({ title: "x", type: "diagnostic", questionIds: [qs.get("q-af-1"), qs.get("q-af-2")] })).body.id;
    for (const to of ["approved", "open"]) await teacher.post(`${API}/assessments/${act}/status`).send({ to });
    await teacher.post(`${API}/assessments/${act}/entry`).send({ entries: [{ studentId: students[1]!.id, answers: [{ questionId: qs.get("q-af-1"), answer: { kind: "option", optionId: "b" } }] }] });
    const student = request.agent(app);
    expect((await student.post(`${API}/join`).send({ joinCode, rosterNumber: a.rosterNumber })).status).toBe(200);
    const up = await teacher.post(`${API}/submission-files`).field("assessmentId", act).field("studentId", a.id).attach("file", makeJpeg(), "s.jpg");
    expect(up.status).toBe(201);
    return { act, student };
  }

  it("removes the name, sessions and photos, but keeps anonymous answers in the ledger", async () => {
    await withData();
    // give the first student an answer too, so there is something to keep
    const qs = new Map((await db.select().from(questions)).map((q) => [q.key, q.id]));
    expect((await readdir(dir)).length).toBe(1);

    const res = await teacher.post(`${API}/classes/${classId}/students/${students[0]!.id}/erase`).send({ confirm: "erase" });
    expect(res.status).toBe(204);

    const [profile] = await db.select().from(studentProfiles).where(eq(studentProfiles.id, students[0]!.id));
    expect(profile).toMatchObject({ name: "Removed student", referenceId: null, userId: null });
    expect(await readdir(dir)).toHaveLength(0); // the photo is gone from storage
    const [sheet] = await db.select().from(submissionFiles).where(eq(submissionFiles.studentId, students[0]!.id));
    expect(sheet).toMatchObject({ storageKey: null, status: "rejected" });
    expect(await db.select().from(studentSessions).where(eq(studentSessions.studentId, students[0]!.id))).toHaveLength(0);

    // The roster no longer lists them, and they cannot join again.
    expect((await teacher.get(`${API}/classes/${classId}/students`)).body.students.map((s: { name: string }) => s.name)).toEqual(["Meera Rao"]);
    expect((await request(app).post(`${API}/join`).send({ joinCode, rosterNumber: students[0]!.rosterNumber })).status).toBe(404);

    // The other student's records are untouched.
    expect((await db.select().from(assessmentEvidence).where(eq(assessmentEvidence.studentId, students[1]!.id))).length).toBeGreaterThan(0);
    expect(qs.size).toBeGreaterThan(0);

    // The audit trail records that it happened, without the name.
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "student.erase"));
    expect(entry!.metadata).toMatchObject({ classId, photosDeleted: 1 });
    expect(JSON.stringify(entry)).not.toMatch(/Ravi/);
  });

  it("an erased student's old session stops working at once", async () => {
    const { student } = await withData();
    expect((await student.get(`${API}/student/activity`)).status).toBe(200);
    await teacher.post(`${API}/classes/${classId}/students/${students[0]!.id}/erase`).send({ confirm: "erase" });
    expect((await student.get(`${API}/student/activity`)).status).toBe(401);
  });

  it("needs explicit confirmation, and belongs to the class's teacher alone", async () => {
    const url = `${API}/classes/${classId}/students/${students[0]!.id}/erase`;
    expect((await teacher.post(url).send({})).status).toBe(400);
    expect((await teacher.post(url).send({ confirm: "yes" })).status).toBe(400);
    const other = await signedInAgent(app, "other@example.com", "Other");
    expect((await other.post(url).send({ confirm: "erase" })).status).toBe(404);
    expect((await request(app).post(url).send({ confirm: "erase" })).status).toBe(401);
    expect((await db.select().from(studentProfiles).where(eq(studentProfiles.id, students[0]!.id)))[0]!.name).toBe("Ravi Kumar");
  });
});
