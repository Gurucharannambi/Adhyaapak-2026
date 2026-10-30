import type { Role } from "@adhyaapak/shared";
import { forbidden } from "../../http/errors";

/**
 * Object-level access checks live here, in one place, so no route re-implements them
 * (CLAUDE.md §14: never trust an identifier from the frontend).
 *
 * Phase 1 covers users. Class and student ownership checks (a teacher may only see their own
 * classes; a student only themselves) are added to this file in Phase 2 when those tables exist,
 * following the same pattern: a pure `can...` predicate plus an `assert...` that throws 403.
 */
export interface Actor {
  id: string;
  role: Role;
}

export const canViewUser = (actor: Actor, targetUserId: string): boolean =>
  actor.role === "admin" || actor.id === targetUserId;

export function assertCanViewUser(actor: Actor, targetUserId: string): void {
  if (!canViewUser(actor, targetUserId)) throw forbidden();
}
