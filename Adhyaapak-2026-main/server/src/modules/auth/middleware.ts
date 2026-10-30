import type { RequestHandler } from "express";
import type { Role } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { forbidden, unauthenticated } from "../../http/errors";
import { SESSION_COOKIE, findSessionUser } from "./session";

/** Loads the signed-in user (if any) onto req.user. Does not reject anonymous requests. */
export function loadSession(db: Db): RequestHandler {
  return async (req, _res, next) => {
    try {
      const token = req.cookies?.[SESSION_COOKIE];
      if (typeof token === "string" && token.length > 0) {
        const found = await findSessionUser(db, token);
        if (found) {
          req.user = { id: found.id, name: found.name, email: found.email, role: found.role };
          req.sessionId = found.sessionId;
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) return next(unauthenticated());
  next();
};

/** Role gate. Object-level checks (this class, this student) live in modules/auth/permissions.ts. */
export const requireRole =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(unauthenticated());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
