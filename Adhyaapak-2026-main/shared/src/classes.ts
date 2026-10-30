import { z } from "zod";
import { Grade, Id } from "./common";
import { SchedulePeriod } from "./timetable";
import { AttentionItem } from "./lesson-run";

const name = z.string().trim().min(1).max(100);

export const CreateClassRequest = z.object({
  name,
  grade: Grade,
  /** e.g. "2026-27" */
  academicYear: z.string().trim().regex(/^\d{4}-\d{2}$/, "Use the form 2026-27"),
});
export type CreateClassRequest = z.infer<typeof CreateClassRequest>;

export const UpdateClassRequest = CreateClassRequest.partial()
  .extend({ portalEnabled: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");
export type UpdateClassRequest = z.infer<typeof UpdateClassRequest>;

export const ClassDto = z.object({
  id: Id,
  name: z.string(),
  grade: Grade,
  academicYear: z.string(),
  /** Students type this to join a classroom session (Phase 4). Not a secret credential. */
  joinCode: z.string(),
  studentCount: z.number().int().min(0),
  /** Students may use the optional practice portal. */
  portalEnabled: z.boolean(),
});
export type ClassDto = z.infer<typeof ClassDto>;

export const AddStudentRequest = z.object({
  name,
  /** Optional school-issued reference (admission number etc.). Unique within a class. */
  referenceId: z.string().trim().min(1).max(50).optional(),
  /** Number the student uses with the join code. Assigned automatically if omitted. */
  rosterNumber: z.number().int().min(1).max(999).optional(),
});
export type AddStudentRequest = z.infer<typeof AddStudentRequest>;

/** Fixing a mistake in a student's record (a misspelt name, a wrong roll number). */
export const CorrectStudentRequest = z
  .object({
    name: z.string().trim().min(1).max(100).optional(),
    referenceId: z.string().trim().min(1).max(50).nullable().optional(),
    rosterNumber: z.number().int().min(1).max(999).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to correct");
export type CorrectStudentRequest = z.infer<typeof CorrectStudentRequest>;

/** Removes a student's personal details. The teacher confirms by sending the literal text. */
export const EraseStudentRequest = z.object({ confirm: z.literal("erase") });
export type EraseStudentRequest = z.infer<typeof EraseStudentRequest>;

export const StudentDto = z.object({
  id: Id,
  name: z.string(),
  referenceId: z.string().nullable(),
  rosterNumber: z.number().int(),
});
export type StudentDto = z.infer<typeof StudentDto>;

export const ImportRosterRequest = z.object({
  /** Raw CSV text. Header row required; columns: name, reference_id (optional), roster_number (optional). */
  csv: z.string().min(1).max(200_000),
  /** When true nothing is saved; the response previews what would happen. */
  dryRun: z.boolean().default(true),
});
export type ImportRosterRequest = z.infer<typeof ImportRosterRequest>;

export const ImportRowResult = z.object({
  line: z.number().int(),
  name: z.string(),
  rosterNumber: z.number().int().nullable(),
  status: z.enum(["ok", "error"]),
  message: z.string().optional(),
});
export type ImportRowResult = z.infer<typeof ImportRowResult>;

export const ImportRosterResponse = z.object({
  dryRun: z.boolean(),
  /** True only if the import was saved. Any row error blocks the whole import. */
  committed: z.boolean(),
  rows: z.array(ImportRowResult),
  okCount: z.number().int(),
  errorCount: z.number().int(),
});
export type ImportRosterResponse = z.infer<typeof ImportRosterResponse>;

export const TodayAction = z.object({
  id: z.string(),
  kind: z.enum(["create_first_class", "add_students", "start_teaching"]),
  classId: Id.optional(),
  text: z.string(),
});
export type TodayAction = z.infer<typeof TodayAction>;

export const DashboardResponse = z.object({
  classes: z.array(ClassDto),
  today: z.array(TodayAction),
  /** Today's periods across all of the teacher's classes, each Mathematics period with its planned lesson. */
  schedule: z.array(SchedulePeriod),
  /** The first Mathematics period of tomorrow, per class, so the teacher can get ready the evening before. */
  tomorrow: z.array(SchedulePeriod),
  /** This school week (Monday to Saturday). Lessons are planned from today on; earlier days show their timetable slots only. */
  week: z.array(SchedulePeriod),
  /** Monday of the week shown, YYYY-MM-DD. */
  weekStart: z.string(),
  /** What is waiting on the teacher: open checks, unwrapped lessons, sheets to review, patterns to confirm. */
  attention: z.array(AttentionItem),
  /** Real progress through first-time setup. */
  setup: z.object({ hasClass: z.boolean(), hasStudents: z.boolean(), hasTaught: z.boolean() }),
});
export type DashboardResponse = z.infer<typeof DashboardResponse>;
