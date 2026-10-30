import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { LoginRequest, RegisterRequest, type AuthResponse } from "@adhyaapak/shared";
import type { AppConfig } from "../../config";
import type { Db } from "../../db/client";
import { AppError } from "../../http/errors";
import { parseOrThrow } from "../../http/validate";
import { recordAudit } from "../audit/audit.service";
import { registerTeacher, verifyCredentials } from "./auth.service";
import { requireAuth } from "./middleware";
import { SESSION_COOKIE, cookieOptions, createSession, deleteSession } from "./session";

export function authRoutes(db: Db, config: AppConfig): Router {
  const router = Router();
  const cookie = cookieOptions({ secure: config.SESSION_COOKIE_SECURE, ttlHours: config.SESSION_TTL_HOURS });

  // Brute-force protection on the sensitive endpoints (CLAUDE.md §14).
  const limiter: RequestHandler = config.RATE_LIMIT_ENABLED
    ? rateLimit({
        windowMs: 15 * 60 * 1000,
        limit: 20,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        handler: (_req, _res, next) =>
          next(new AppError("rate_limited", "Too many attempts. Please wait a few minutes and try again.")),
      })
    : (_req, _res, next) => next();

  router.post("/register", limiter, async (req, res) => {
    const input = parseOrThrow(RegisterRequest, req.body);
    const user = await registerTeacher(db, input);
    await recordAudit(db, { actorId: user.id, action: "auth.register", entityType: "user", entityId: user.id, requestId: String(req.id) });
    const token = await createSession(db, user.id, config.SESSION_TTL_HOURS);
    res.cookie(SESSION_COOKIE, token, cookie);
    const body: AuthResponse = { user };
    res.status(201).json(body);
  });

  router.post("/login", limiter, async (req, res) => {
    const input = parseOrThrow(LoginRequest, req.body);
    let user;
    try {
      user = await verifyCredentials(db, input);
    } catch (err) {
      // No email in the audit record: failed attempts may involve other people's addresses.
      await recordAudit(db, { action: "auth.login_failed", requestId: String(req.id) });
      throw err;
    }
    await recordAudit(db, { actorId: user.id, action: "auth.login", entityType: "user", entityId: user.id, requestId: String(req.id) });
    const token = await createSession(db, user.id, config.SESSION_TTL_HOURS);
    res.cookie(SESSION_COOKIE, token, cookie);
    const body: AuthResponse = { user };
    res.json(body);
  });

  router.post("/logout", async (req, res) => {
    if (req.sessionId) await deleteSession(db, req.sessionId);
    if (req.user) await recordAudit(db, { actorId: req.user.id, action: "auth.logout", requestId: String(req.id) });
    res.clearCookie(SESSION_COOKIE, { ...cookie, maxAge: undefined });
    res.status(204).end();
  });

  router.get("/me", requireAuth, (req, res) => {
    const body: AuthResponse = { user: req.user! };
    res.json(body);
  });

  return router;
}
