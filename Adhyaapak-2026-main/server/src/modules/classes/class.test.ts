import request from "supertest";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, classEnrolments, studentProfiles } from "../../db/schema";
import { buildTestApp, resetDb, signedInAgent } from "../../test/helpers";
import { canAccessClass } from "./class.access";
import { parseCsv } from "./csv";
import { generateJoinCode } from "./join-code";

const { app, db, pool } = buildTestApp();
beforeEach(() => resetDb(db));
afterAll(() => pool.end());

const newClass = { name: "6A", grade: 6, academicYear: "2026-27" };
const API = "/api/v1";

async function teacherWithClass(email = "asha@example.com") {
  const agent = await signedInAgent(app, email);
  const res = await agent.post(`${API}/classes`).send(newClass);
  return { agent, cls: res.body as { id: string; joinCode: string } };
}

describe("classes", () => {
  it("creates a class with a join code and lists it with a real student count", async () => {
    const { agent, cls } = await teacherWithClass();
    expect(cls.joinCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    await agent.post(`${API}/classes/${cls.id}/students`).send({ name: "Ravi" });

    const list = await agent.get(`${API}/classes`);
    expect(list.body.classes).toHaveLength(1);
    expect(list.body.classes[0]).toMatchObject({ name: "6A", grade: 6, studentCount: 1 });
  });

  it("validates grade range and year format", async () => {
    const agent = await signedInAgent(app);
    const res = await agent.post(`${API}/classes`).send({ name: "X", grade: 11, academicYear: "2026" });
    expect(res.status).toBe(400);
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(["grade", "academicYear"]));
  });

  it("updates a class", async () => {
    const { agent, cls } = await teacherWithClass();
    const res = await agent.patch(`${API}/classes/${cls.id}`).send({ name: "6B" });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("6B");
  });

  it("rejects an empty update", async () => {
    const { agent, cls } = await teacherWithClass();
    expect((await agent.patch(`${API}/classes/${cls.id}`).send({})).status).toBe(400);
  });
});

describe("access control", () => {
  it("hides one teacher's class from another teacher (404, not 403) for every route", async () => {
    const { cls } = await teacherWithClass("owner@example.com");
    const other = await signedInAgent(app, "other@example.com", "Other Teacher");

    expect((await other.get(`${API}/classes`)).body.classes).toEqual([]);
    for (const res of [
      await other.get(`${API}/classes/${cls.id}`),
      await other.patch(`${API}/classes/${cls.id}`).send({ name: "Hacked" }),
      await other.get(`${API}/classes/${cls.id}/students`),
      await other.post(`${API}/classes/${cls.id}/students`).send({ name: "Intruder" }),
      await other.post(`${API}/classes/${cls.id}/enrolments/import`).send({ csv: "name\nA", dryRun: false }),
    ]) {
      expect(res.status).toBe(404);
    }
    expect(await db.select().from(studentProfiles)).toHaveLength(0);
  });

  it("requires sign-in", async () => {
    expect((await request(app).get(`${API}/classes`)).status).toBe(401);
    expect((await request(app).get(`${API}/dashboard`)).status).toBe(401);
  });

  it("rejects a non-uuid class id without a database error", async () => {
    const agent = await signedInAgent(app);
    expect((await agent.get(`${API}/classes/not-a-uuid`)).status).toBe(404);
  });

  it("blocks student-role users from teacher routes", async () => {
    const agent = await signedInAgent(app);
    // Students are not created through registration; simulate one by changing the role in the database.
    await db.execute((await import("drizzle-orm")).sql`update users set role = 'student'`);
    expect((await agent.get(`${API}/classes`)).status).toBe(403);
    expect((await agent.get(`${API}/curriculum`)).status).toBe(403);
  });

  it("canAccessClass: owner and admin yes; other teacher and student no", () => {
    const cls = { teacherId: "t1" };
    expect(canAccessClass({ id: "t1", role: "teacher" }, cls)).toBe(true);
    expect(canAccessClass({ id: "a", role: "admin" }, cls)).toBe(true);
    expect(canAccessClass({ id: "t2", role: "teacher" }, cls)).toBe(false);
    expect(canAccessClass({ id: "t1", role: "student" }, cls)).toBe(false);
  });
});

describe("roster", () => {
  it("auto-assigns roster numbers in order and lists them sorted", async () => {
    const { agent, cls } = await teacherWithClass();
    await agent.post(`${API}/classes/${cls.id}/students`).send({ name: "Ravi" });
    await agent.post(`${API}/classes/${cls.id}/students`).send({ name: "Meera", referenceId: "A-17" });
    const list = await agent.get(`${API}/classes/${cls.id}/students`);
    expect(list.body.students.map((s: { name: string; rosterNumber: number }) => [s.rosterNumber, s.name])).toEqual([
      [1, "Ravi"],
      [2, "Meera"],
    ]);
  });

  it("rejects a duplicate roster number or reference id with 409", async () => {
    const { agent, cls } = await teacherWithClass();
    await agent.post(`${API}/classes/${cls.id}/students`).send({ name: "Ravi", rosterNumber: 5, referenceId: "R1" });
    const dupRoster = await agent.post(`${API}/classes/${cls.id}/students`).send({ name: "Meera", rosterNumber: 5 });
    const dupRef = await agent.post(`${API}/classes/${cls.id}/students`).send({ name: "Meera", referenceId: "R1" });
    expect(dupRoster.status).toBe(409);
    expect(dupRef.status).toBe(409);
    // The failed insert must not leave an orphan profile behind (transaction rollback).
    expect(await db.select().from(studentProfiles)).toHaveLength(1);
  });

  it("allows the same roster number in different classes", async () => {
    const a = await teacherWithClass("a@example.com");
    const b = await teacherWithClass("b@example.com");
    expect((await a.agent.post(`${API}/classes/${a.cls.id}/students`).send({ name: "X", rosterNumber: 1 })).status).toBe(201);
    expect((await b.agent.post(`${API}/classes/${b.cls.id}/students`).send({ name: "Y", rosterNumber: 1 })).status).toBe(201);
  });

  it("withdraws a student without deleting the record, and never reuses their roster number", async () => {
    const { agent, cls } = await teacherWithClass();
    const added = await agent.post(`${API}/classes/${cls.id}/students`).send({ name: "Ravi" });
    expect((await agent.delete(`${API}/classes/${cls.id}/students/${added.body.id}`)).status).toBe(204);

    expect((await agent.get(`${API}/classes/${cls.id}/students`)).body.students).toEqual([]);
    expect(await db.select().from(studentProfiles)).toHaveLength(1);
    expect((await db.select().from(classEnrolments))[0]!.status).toBe("withdrawn");

    const next = await agent.post(`${API}/classes/${cls.id}/students`).send({ name: "Meera" });
    expect(next.body.rosterNumber).toBe(2);
    expect((await agent.delete(`${API}/classes/${cls.id}/students/${added.body.id}`)).status).toBe(404);
  });

  it("records audit entries for teacher actions", async () => {
    const { agent, cls } = await teacherWithClass();
    await agent.post(`${API}/classes/${cls.id}/students`).send({ name: "Ravi" });
    const actions = (await db.select().from(auditLog)).map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["class.create", "student.add"]));
  });
});

describe("roster import", () => {
  const csv = "name,reference_id,roster_number\nRavi,R1,\nMeera,R2,7\nAnu,,\n";

  it("dry run previews and saves nothing", async () => {
    const { agent, cls } = await teacherWithClass();
    const res = await agent.post(`${API}/classes/${cls.id}/enrolments/import`).send({ csv, dryRun: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, committed: false, okCount: 3, errorCount: 0 });
    expect(res.body.rows.map((r: { rosterNumber: number }) => r.rosterNumber)).toEqual([1, 7, 2]);
    expect(await db.select().from(studentProfiles)).toHaveLength(0);
  });

  it("commits when every row is valid", async () => {
    const { agent, cls } = await teacherWithClass();
    const res = await agent.post(`${API}/classes/${cls.id}/enrolments/import`).send({ csv, dryRun: false });
    expect(res.body.committed).toBe(true);
    const list = await agent.get(`${API}/classes/${cls.id}/students`);
    expect(list.body.students.map((s: { rosterNumber: number }) => s.rosterNumber)).toEqual([1, 2, 7]);
  });

  it("is all-or-nothing: one bad row blocks the whole import and explains why", async () => {
    const { agent, cls } = await teacherWithClass();
    const bad = "name,roster_number\nRavi,1\n,2\nMeera,1\nAnu,abc\n";
    const res = await agent.post(`${API}/classes/${cls.id}/enrolments/import`).send({ csv: bad, dryRun: false });
    expect(res.body.committed).toBe(false);
    expect(res.body.errorCount).toBe(3);
    const messages = res.body.rows.filter((r: { status: string }) => r.status === "error").map((r: { line: number; message: string }) => `${r.line}: ${r.message}`);
    expect(messages).toEqual(['3: Name is missing.', '4: Roster number 1 is already taken.', '5: Roster number "abc" must be a whole number from 1 to 999.']);
    expect(await db.select().from(studentProfiles)).toHaveLength(0);
  });

  it("detects clashes with students already in the class", async () => {
    const { agent, cls } = await teacherWithClass();
    await agent.post(`${API}/classes/${cls.id}/students`).send({ name: "Existing", rosterNumber: 1, referenceId: "R1" });
    const res = await agent.post(`${API}/classes/${cls.id}/enrolments/import`).send({ csv: "name,reference_id,roster_number\nNew,R1,\nNew2,,1", dryRun: true });
    expect(res.body.errorCount).toBe(2);
  });

  it("requires a name column and at least one student", async () => {
    const { agent, cls } = await teacherWithClass();
    const noHeader = await agent.post(`${API}/classes/${cls.id}/enrolments/import`).send({ csv: "foo,bar\n1,2", dryRun: true });
    expect(noHeader.body.errorCount).toBe(1);
    const empty = await agent.post(`${API}/classes/${cls.id}/enrolments/import`).send({ csv: "name\n", dryRun: false });
    expect(empty.body.committed).toBe(false);
    expect(empty.body.errorCount).toBe(1);
  });

  it("handles quoted names containing commas and Windows line endings", async () => {
    const { agent, cls } = await teacherWithClass();
    const res = await agent.post(`${API}/classes/${cls.id}/enrolments/import`).send({ csv: 'name\r\n"Rao, Asha"\r\nRavi\r\n', dryRun: false });
    expect(res.body.committed).toBe(true);
    const names = (await agent.get(`${API}/classes/${cls.id}/students`)).body.students.map((s: { name: string }) => s.name);
    expect(names).toEqual(["Rao, Asha", "Ravi"]);
  });
});

describe("dashboard", () => {
  it("prompts to create a first class, then to add students, then to open the class — all from real data", async () => {
    const agent = await signedInAgent(app);
    const empty = await agent.get(`${API}/dashboard`);
    expect(empty.body.today.map((a: { kind: string }) => a.kind)).toEqual(["create_first_class"]);

    const cls = (await agent.post(`${API}/classes`).send(newClass)).body;
    expect((await agent.get(`${API}/dashboard`)).body.today[0]).toMatchObject({ kind: "add_students", classId: cls.id });

    await agent.post(`${API}/classes/${cls.id}/students`).send({ name: "Ravi" });
    expect((await agent.get(`${API}/dashboard`)).body.today[0]).toMatchObject({ kind: "start_teaching", classId: cls.id });
  });
});

describe("helpers", () => {
  it("parseCsv handles quotes, escaped quotes, blank lines and a BOM", () => {
    expect(parseCsv('﻿a,b\n"x ""y"" z",2\n\n3,4')).toEqual([["a", "b"], ['x "y" z', "2"], ["3", "4"]]);
  });

  it("generates join codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) expect(generateJoinCode()).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
  });
});
