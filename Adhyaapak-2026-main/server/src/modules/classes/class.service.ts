import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  AddStudentRequest,
  ClassDto,
  CorrectStudentRequest,
  CreateClassRequest,
  DashboardResponse,
  ImportRosterResponse,
  ImportRowResult,
  StudentDto,
  TodayAction,
  UpdateClassRequest,
} from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { classEnrolments, classes, lessonCoverage, studentProfiles, studentSessions, submissionFiles } from "../../db/schema";
import type { StorageProvider } from "../files/storage";
import { AppError, conflict } from "../../http/errors";
import type { Actor } from "../auth/permissions";
import { ensureTimetable, getDayPlans } from "../timetable/timetable.service";
import { getAttention } from "../lessons/attention.service";
import { recordAudit } from "../audit/audit.service";
import { loadAccessibleClass, type ClassRow } from "./class.access";
import { parseCsv } from "./csv";
import { generateJoinCode } from "./join-code";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const pgCode = (e: unknown): string | undefined => (typeof e === "object" && e ? (e as { code?: string }).code : undefined);
const isUniqueViolation = (e: unknown) => pgCode(e) === "23505" || pgCode((e as { cause?: unknown } | null)?.cause) === "23505";

function toClassDto(c: ClassRow, studentCount: number): ClassDto {
  return { id: c.id, name: c.name, grade: c.grade, academicYear: c.academicYear, joinCode: c.joinCode, studentCount, portalEnabled: c.portalEnabled };
}

async function activeStudentCount(db: Db | Tx, classId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(classEnrolments)
    .where(and(eq(classEnrolments.classId, classId), eq(classEnrolments.status, "active")));
  return row?.n ?? 0;
}

export async function createClass(db: Db, actor: Actor, input: CreateClassRequest, requestId?: string): Promise<ClassDto> {
  // The join code is unique in the database; retry on the rare collision rather than checking first.
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [row] = await db
        .insert(classes)
        .values({ ...input, teacherId: actor.id, joinCode: generateJoinCode() })
        .returning();
      await recordAudit(db, { actorId: actor.id, action: "class.create", entityType: "class", entityId: row!.id, requestId });
      await ensureTimetable(db, row!.id);
      return toClassDto(row!, 0);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
  }
  throw new AppError("internal_error", "Could not create the class. Please try again.");
}

export async function listClasses(db: Db, actor: Actor): Promise<ClassDto[]> {
  const rows = await db
    .select({
      cls: classes,
      n: sql<number>`count(${classEnrolments.id}) filter (where ${classEnrolments.status} = 'active')`.mapWith(Number),
    })
    .from(classes)
    .leftJoin(classEnrolments, eq(classEnrolments.classId, classes.id))
    .where(actor.role === "admin" ? undefined : eq(classes.teacherId, actor.id))
    .groupBy(classes.id)
    .orderBy(desc(classes.createdAt));
  return rows.map((r) => toClassDto(r.cls, r.n));
}

export async function getClass(db: Db, actor: Actor, classId: string): Promise<ClassDto> {
  const cls = await loadAccessibleClass(db, actor, classId);
  return toClassDto(cls, await activeStudentCount(db, cls.id));
}

export async function updateClass(db: Db, actor: Actor, classId: string, input: UpdateClassRequest, requestId?: string): Promise<ClassDto> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const [row] = await db.update(classes).set({ ...input, updatedAt: new Date() }).where(eq(classes.id, cls.id)).returning();
  await recordAudit(db, { actorId: actor.id, action: "class.update", entityType: "class", entityId: cls.id, requestId });
  return toClassDto(row!, await activeStudentCount(db, cls.id));
}

export async function listStudents(db: Db, actor: Actor, classId: string): Promise<StudentDto[]> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const rows = await db
    .select({ id: studentProfiles.id, name: studentProfiles.name, referenceId: studentProfiles.referenceId, rosterNumber: classEnrolments.rosterNumber })
    .from(classEnrolments)
    .innerJoin(studentProfiles, eq(studentProfiles.id, classEnrolments.studentId))
    .where(and(eq(classEnrolments.classId, cls.id), eq(classEnrolments.status, "active")))
    .orderBy(asc(classEnrolments.rosterNumber));
  return rows;
}

/** Next free roster number, counting withdrawn students too so a number is never reused for someone else. */
async function nextRosterNumber(tx: Tx, classId: string): Promise<number> {
  const [row] = await tx
    .select({ max: sql<number | null>`max(${classEnrolments.rosterNumber})`.mapWith((v) => (v === null ? null : Number(v))) })
    .from(classEnrolments)
    .where(eq(classEnrolments.classId, classId));
  return (row?.max ?? 0) + 1;
}

async function referenceInUse(tx: Tx, classId: string, referenceId: string): Promise<boolean> {
  const rows = await tx
    .select({ id: classEnrolments.id })
    .from(classEnrolments)
    .innerJoin(studentProfiles, eq(studentProfiles.id, classEnrolments.studentId))
    .where(and(eq(classEnrolments.classId, classId), eq(classEnrolments.status, "active"), eq(studentProfiles.referenceId, referenceId)))
    .limit(1);
  return rows.length > 0;
}

async function insertStudent(tx: Tx, classId: string, input: AddStudentRequest): Promise<StudentDto> {
  if (input.referenceId && (await referenceInUse(tx, classId, input.referenceId))) {
    throw conflict(`Reference ID "${input.referenceId}" is already used in this class.`);
  }
  const rosterNumber = input.rosterNumber ?? (await nextRosterNumber(tx, classId));
  const [profile] = await tx
    .insert(studentProfiles)
    .values({ name: input.name, referenceId: input.referenceId ?? null })
    .returning();
  try {
    await tx.insert(classEnrolments).values({ classId, studentId: profile!.id, rosterNumber });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(`Roster number ${rosterNumber} is already taken in this class.`);
    throw err;
  }
  return { id: profile!.id, name: profile!.name, referenceId: profile!.referenceId, rosterNumber };
}

export async function addStudent(db: Db, actor: Actor, classId: string, input: AddStudentRequest, requestId?: string): Promise<StudentDto> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const student = await db.transaction((tx) => insertStudent(tx, cls.id, input));
  await recordAudit(db, { actorId: actor.id, action: "student.add", entityType: "student", entityId: student.id, metadata: { classId: cls.id }, requestId });
  return student;
}

/** Withdraws a student from the class. The profile and any future evidence are kept (records are not deleted). */
/** Corrects a mistake in a student's record. Roll numbers stay unique within the class. */
export async function correctStudent(db: Db, actor: Actor, classId: string, studentId: string, input: CorrectStudentRequest, requestId?: string): Promise<StudentDto> {
  const cls = await loadAccessibleClass(db, actor, classId);
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) throw new AppError("not_found", "Student not found in this class.");
  try {
    return await db.transaction(async (tx) => {
      const [enrolment] = await tx
        .select()
        .from(classEnrolments)
        .where(and(eq(classEnrolments.classId, cls.id), eq(classEnrolments.studentId, studentId), eq(classEnrolments.status, "active")));
      if (!enrolment) throw new AppError("not_found", "Student not found in this class.");
      if (input.name !== undefined || input.referenceId !== undefined) {
        await tx
          .update(studentProfiles)
          .set({ ...(input.name !== undefined ? { name: input.name } : {}), ...(input.referenceId !== undefined ? { referenceId: input.referenceId } : {}), updatedAt: new Date() })
          .where(eq(studentProfiles.id, studentId));
      }
      if (input.rosterNumber !== undefined) await tx.update(classEnrolments).set({ rosterNumber: input.rosterNumber }).where(eq(classEnrolments.id, enrolment.id));
      const [row] = await tx
        .select({ id: studentProfiles.id, name: studentProfiles.name, referenceId: studentProfiles.referenceId, rosterNumber: classEnrolments.rosterNumber })
        .from(classEnrolments)
        .innerJoin(studentProfiles, eq(studentProfiles.id, classEnrolments.studentId))
        .where(eq(classEnrolments.id, enrolment.id));
      await recordAudit(tx, { actorId: actor.id, action: "student.correct", entityType: "student", entityId: studentId, metadata: { fields: Object.keys(input) }, requestId });
      return row!;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new AppError("conflict", "That roll number or reference is already used in this class.");
    throw err;
  }
}

/**
 * Removes a student's personal details and everything that could identify them: their name and reference, their
 * sign-in sessions, and any photographed answer sheets (deleted from storage). Their answers stay in the evidence
 * ledger as anonymous records, because the ledger is append-only and class results depend on it. If a school needs
 * the answers gone too, that is a database operation for the administrator, described in docs/DEPLOYMENT.md.
 */
export async function eraseStudent(db: Db, storage: StorageProvider, actor: Actor, classId: string, studentId: string, requestId?: string): Promise<void> {
  const cls = await loadAccessibleClass(db, actor, classId);
  if (!/^[0-9a-f-]{36}$/i.test(studentId)) throw new AppError("not_found", "Student not found in this class.");
  const [member] = await db.select({ id: classEnrolments.id }).from(classEnrolments).where(and(eq(classEnrolments.classId, cls.id), eq(classEnrolments.studentId, studentId)));
  if (!member) throw new AppError("not_found", "Student not found in this class.");

  // A student who is also in someone else's class is not this teacher's to erase.
  const others = await db
    .select({ teacherId: classes.teacherId })
    .from(classEnrolments)
    .innerJoin(classes, eq(classes.id, classEnrolments.classId))
    .where(eq(classEnrolments.studentId, studentId));
  if (others.some((o) => o.teacherId !== cls.teacherId)) throw new AppError("conflict", "This student is also in another teacher's class, so only an administrator can erase them.");

  const photos = await db.select({ id: submissionFiles.id, key: submissionFiles.storageKey, status: submissionFiles.status }).from(submissionFiles).where(eq(submissionFiles.studentId, studentId));
  for (const p of photos) if (p.key) await storage.delete(p.key);

  await db.transaction(async (tx) => {
    const now = new Date();
    for (const p of photos) {
      await tx
        .update(submissionFiles)
        .set({ storageKey: null, imageDeletedAt: now, updatedAt: now, ...(p.status === "approved" ? {} : { status: "rejected" as const }) })
        .where(eq(submissionFiles.id, p.id));
    }
    await tx.delete(studentSessions).where(eq(studentSessions.studentId, studentId));
    await tx.update(classEnrolments).set({ status: "withdrawn" }).where(eq(classEnrolments.studentId, studentId));
    await tx.update(studentProfiles).set({ name: "Removed student", referenceId: null, userId: null, updatedAt: now }).where(eq(studentProfiles.id, studentId));
    await recordAudit(tx, { actorId: actor.id, action: "student.erase", entityType: "student", entityId: studentId, metadata: { classId: cls.id, photosDeleted: photos.length }, requestId });
  });
}

export async function withdrawStudent(db: Db, actor: Actor, classId: string, studentId: string, requestId?: string): Promise<void> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const updated = await db
    .update(classEnrolments)
    .set({ status: "withdrawn" })
    .where(and(eq(classEnrolments.classId, cls.id), eq(classEnrolments.studentId, studentId), eq(classEnrolments.status, "active")))
    .returning({ id: classEnrolments.id });
  if (updated.length === 0) throw new AppError("not_found", "Student not found in this class.");
  await recordAudit(db, { actorId: actor.id, action: "student.withdraw", entityType: "student", entityId: studentId, metadata: { classId: cls.id }, requestId });
}

// ---------------------------------------------------------------------------
// Roster import
// ---------------------------------------------------------------------------

interface ParsedRow {
  line: number;
  name: string;
  referenceId?: string;
  rosterNumber?: number;
}

const HEADER_ALIASES: Record<string, "name" | "referenceId" | "rosterNumber"> = {
  name: "name",
  student_name: "name",
  reference_id: "referenceId",
  reference: "referenceId",
  admission_no: "referenceId",
  roster_number: "rosterNumber",
  roll_no: "rosterNumber",
  roll_number: "rosterNumber",
};

function validateRows(csv: string, existingRosters: Set<number>, existingRefs: Set<string>, nextFree: number) {
  const table = parseCsv(csv);
  const results: ImportRowResult[] = [];
  const valid: ParsedRow[] = [];

  const header = (table[0] ?? []).map((h) => HEADER_ALIASES[h.trim().toLowerCase().replace(/\s+/g, "_")]);
  if (!header.includes("name")) {
    return {
      results: [{ line: 1, name: "", rosterNumber: null, status: "error" as const, message: 'The first row must be a header containing a "name" column.' }],
      valid,
    };
  }

  const seenRosters = new Set(existingRosters);
  const seenRefs = new Set(existingRefs);
  let auto = nextFree;

  table.slice(1).forEach((cells, i) => {
    const line = i + 2;
    const get = (field: "name" | "referenceId" | "rosterNumber") => {
      const idx = header.indexOf(field);
      return idx === -1 ? "" : (cells[idx] ?? "").trim();
    };
    const name = get("name");
    const ref = get("referenceId");
    const rosterRaw = get("rosterNumber");

    let message: string | undefined;
    let roster: number | undefined;
    if (!name) message = "Name is missing.";
    else if (name.length > 100) message = "Name is longer than 100 characters.";
    else if (rosterRaw) {
      const n = Number(rosterRaw);
      if (!Number.isInteger(n) || n < 1 || n > 999) message = `Roster number "${rosterRaw}" must be a whole number from 1 to 999.`;
      else if (seenRosters.has(n)) message = `Roster number ${n} is already taken.`;
      else roster = n;
    }
    if (!message && ref) {
      if (ref.length > 50) message = "Reference ID is longer than 50 characters.";
      else if (seenRefs.has(ref)) message = `Reference ID "${ref}" is already used.`;
    }

    if (message) {
      results.push({ line, name, rosterNumber: roster ?? null, status: "error", message });
      return;
    }
    if (roster === undefined) {
      while (seenRosters.has(auto)) auto++;
      roster = auto;
    }
    seenRosters.add(roster);
    if (ref) seenRefs.add(ref);
    results.push({ line, name, rosterNumber: roster, status: "ok" });
    valid.push({ line, name, ...(ref ? { referenceId: ref } : {}), rosterNumber: roster });
  });

  if (results.length === 0) {
    results.push({ line: 2, name: "", rosterNumber: null, status: "error", message: "The file has a header but no students." });
  }
  return { results, valid };
}

export async function importRoster(
  db: Db,
  actor: Actor,
  classId: string,
  input: { csv: string; dryRun: boolean },
  requestId?: string,
): Promise<ImportRosterResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);

  const run = async (tx: Tx): Promise<ImportRosterResponse> => {
    // Withdrawn students keep their roster numbers reserved; reference IDs only clash with active students.
    const rosterRows = await tx.select({ n: classEnrolments.rosterNumber }).from(classEnrolments).where(eq(classEnrolments.classId, cls.id));
    const refRows = await tx
      .select({ r: studentProfiles.referenceId })
      .from(classEnrolments)
      .innerJoin(studentProfiles, eq(studentProfiles.id, classEnrolments.studentId))
      .where(and(eq(classEnrolments.classId, cls.id), eq(classEnrolments.status, "active")));
    const rosters = new Set(rosterRows.map((r) => r.n));
    const refs = new Set(refRows.map((r) => r.r).filter((r): r is string => !!r));
    const nextFree = Math.max(0, ...rosters) + 1;

    const { results, valid } = validateRows(input.csv, rosters, refs, nextFree);
    const errorCount = results.filter((r) => r.status === "error").length;
    const okCount = results.length - errorCount;

    // All-or-nothing: one bad row blocks the import, so a half-imported class never has to be untangled.
    const committed = !input.dryRun && errorCount === 0 && valid.length > 0;
    if (committed) {
      for (const row of valid) {
        await insertStudent(tx, cls.id, { name: row.name, referenceId: row.referenceId, rosterNumber: row.rosterNumber });
      }
    }
    return { dryRun: input.dryRun, committed, rows: results, okCount, errorCount };
  };

  const result = await db.transaction(run);
  if (result.committed) {
    await recordAudit(db, { actorId: actor.id, action: "student.import", entityType: "class", entityId: cls.id, metadata: { count: result.okCount }, requestId });
  }
  return result;
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

/**
 * Everything here comes from real records. Items for assessments and reviews are added in
 * later phases when those records exist; nothing is hardcoded or invented (CLAUDE.md §5 Feature 1).
 */
export async function getDashboard(db: Db, actor: Actor, weekOf?: string): Promise<DashboardResponse> {
  const list = await listClasses(db, actor);
  const today: TodayAction[] = [];

  if (list.length === 0) {
    today.push({ id: "create-first-class", kind: "create_first_class", text: "Create your first class to get started." });
  }
  for (const c of list) {
    if (c.studentCount === 0) {
      today.push({ id: `add-students-${c.id}`, kind: "add_students", classId: c.id, text: `Add students to ${c.name}.` });
    } else {
      today.push({ id: `start-${c.id}`, kind: "start_teaching", classId: c.id, text: `Open ${c.name} (${c.studentCount} students).` });
    }
  }
  const plans = await getDayPlans(db, actor, undefined, weekOf);
  const [taught] = list.length
    ? await db.select({ id: lessonCoverage.id }).from(lessonCoverage).where(inArray(lessonCoverage.classId, list.map((c) => c.id))).limit(1)
    : [];
  return {
    classes: list,
    today,
    schedule: plans.today,
    tomorrow: plans.tomorrow,
    week: plans.week,
    weekStart: plans.weekStart,
    attention: await getAttention(db, actor),
    setup: { hasClass: list.length > 0, hasStudents: list.some((c) => c.studentCount > 0), hasTaught: !!taught },
  };
}
