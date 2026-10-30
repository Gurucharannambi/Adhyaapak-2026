import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { CookieOptions, RequestHandler } from "express";
import type { Db } from "../../db/client";
import { classEnrolments, classes, studentProfiles, studentSessions } from "../../db/schema";
import { unauthenticated } from "../../http/errors";

export const STUDENT_COOKIE = "adhyaapak_student";
/** A classroom session is short: it only needs to last one lesson. */
export const STUDENT_SESSION_HOURS = 3;

const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function studentCookieOptions(secure: boolean): CookieOptions {
  return { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: STUDENT_SESSION_HOURS * 3600 * 1000 };
}

/** Finds the active student in a class by join code and roster number, or undefined. */
export async function findJoinTarget(db: Db, joinCode: string, rosterNumber: number) {
  const [row] = await db
    .select({ classId: classes.id, studentId: studentProfiles.id, name: studentProfiles.name })
    .from(classes)
    .innerJoin(classEnrolments, and(eq(classEnrolments.classId, classes.id), eq(classEnrolments.rosterNumber, rosterNumber), eq(classEnrolments.status, "active")))
    .innerJoin(studentProfiles, eq(studentProfiles.id, classEnrolments.studentId))
    .where(eq(classes.joinCode, joinCode))
    .limit(1);
  return row;
}

export async function createStudentSession(db: Db, studentId: string, classId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(studentSessions).values({
    studentId,
    classId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + STUDENT_SESSION_HOURS * 3600 * 1000),
  });
  return token;
}

export async function deleteStudentSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(studentSessions).where(eq(studentSessions.id, sessionId));
}

export async function deleteExpiredStudentSessions(db: Db): Promise<void> {
  await db.delete(studentSessions).where(lt(studentSessions.expiresAt, new Date()));
}

/**
 * Loads the joined student (if any) onto req.student. A student whose enrolment was withdrawn
 * after joining loses access immediately.
 */
export function loadStudentSession(db: Db): RequestHandler {
  return async (req, _res, next) => {
    try {
      const token = req.cookies?.[STUDENT_COOKIE];
      if (typeof token === "string" && token) {
        const [row] = await db
          .select({ sessionId: studentSessions.id, studentId: studentSessions.studentId, classId: studentSessions.classId, name: studentProfiles.name })
          .from(studentSessions)
          .innerJoin(studentProfiles, eq(studentProfiles.id, studentSessions.studentId))
          .innerJoin(classEnrolments, and(eq(classEnrolments.classId, studentSessions.classId), eq(classEnrolments.studentId, studentSessions.studentId), eq(classEnrolments.status, "active")))
          .where(and(eq(studentSessions.tokenHash, hashToken(token)), gt(studentSessions.expiresAt, new Date())))
          .limit(1);
        if (row) req.student = row;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const requireStudent: RequestHandler = (req, _res, next) => {
  if (!req.student) return next(unauthenticated("Join again with your class code and number."));
  next();
};
