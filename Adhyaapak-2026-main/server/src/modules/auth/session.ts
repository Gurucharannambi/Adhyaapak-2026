import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, lt } from "drizzle-orm";
import type { CookieOptions } from "express";
import type { Db } from "../../db/client";
import { sessions, users } from "../../db/schema";

export const SESSION_COOKIE = "adhyaapak_sid";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export function cookieOptions(opts: { secure: boolean; ttlHours: number }): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: opts.secure,
    path: "/",
    maxAge: opts.ttlHours * 3600 * 1000,
  };
}

export async function createSession(db: Db, userId: string, ttlHours: number): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + ttlHours * 3600 * 1000),
  });
  return token;
}

/** Returns the active user for a cookie token, or undefined if the token is unknown, expired, or the user is disabled. */
export async function findSessionUser(db: Db, token: string) {
  const rows = await db
    .select({
      sessionId: sessions.id,
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()), eq(users.status, "active")))
    .limit(1);
  return rows[0];
}

export async function deleteSession(db: Db, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function deleteExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
