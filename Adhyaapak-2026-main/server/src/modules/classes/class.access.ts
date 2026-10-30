import { eq } from "drizzle-orm";
import type { Db } from "../../db/client";
import { classes } from "../../db/schema";
import { notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";

export type ClassRow = typeof classes.$inferSelect;

/** A teacher owns their classes; admins can see all. Pure so it can be unit-tested without a database. */
export const canAccessClass = (actor: Actor, cls: Pick<ClassRow, "teacherId">): boolean =>
  actor.role === "admin" || (actor.role === "teacher" && cls.teacherId === actor.id);

/**
 * Loads a class only if the actor may access it. Someone else's class and a missing class both
 * return 404, so ids cannot be probed to learn which classes exist (CLAUDE.md §14).
 */
export async function loadAccessibleClass(db: Db, actor: Actor, classId: string): Promise<ClassRow> {
  // A malformed id would otherwise surface as a database error.
  if (!/^[0-9a-f-]{36}$/i.test(classId)) throw notFound("Class not found.");
  const [cls] = await db.select().from(classes).where(eq(classes.id, classId)).limit(1);
  if (!cls || !canAccessClass(actor, cls)) throw notFound("Class not found.");
  return cls;
}
