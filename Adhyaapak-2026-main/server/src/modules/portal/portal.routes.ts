import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { SubmitPracticeRequest } from "@adhyaapak/shared";
import type { AppConfig } from "../../config";
import type { Db } from "../../db/client";
import { AppError } from "../../http/errors";
import { parseOrThrow } from "../../http/validate";
import { requireStudent } from "../classroom/student-session";
import { getHint, getHome, startPractice, submitPractice, type StudentCtx } from "./portal.service";

const PracticeQuery = z.object({ conceptId: z.string().min(1).max(50), mode: z.enum(["foundation", "guided", "challenge", "revisit"]).default("guided") });
const HintQuery = z.object({ questionId: z.string().min(1).max(50), level: z.coerce.number().int().min(1).max(3) });

/** The optional student portal: a next step, short practice with hints, and friendly progress. Students only ever see their own data. */
export function portalRoutes(db: Db, config: AppConfig): Router {
  const router = Router();
  const ctx = (req: { student?: { studentId: string; classId: string; name: string } }): StudentCtx => ({ studentId: req.student!.studentId, classId: req.student!.classId, name: req.student!.name });

  const limiter = (limit: number, message: string): RequestHandler =>
    config.RATE_LIMIT_ENABLED
      ? rateLimit({
          windowMs: 10 * 60 * 1000,
          limit,
          standardHeaders: "draft-8",
          legacyHeaders: false,
          keyGenerator: (req) => `portal:${req.student?.studentId ?? "anon"}`,
          validate: { keyGeneratorIpFallback: false },
          handler: (_req, _res, next) => next(new AppError("rate_limited", message)),
        })
      : (_req, _res, next) => next();
  const practiceLimiter = limiter(60, "That is a lot of practice at once. Take a short break.");
  const hintLimiter = limiter(120, "Try the question first, then ask for another hint.");

  router.get("/student/home", requireStudent, async (req, res) => {
    res.json(await getHome(db, ctx(req)));
  });

  router.get("/student/practice", requireStudent, practiceLimiter, async (req, res) => {
    const q = parseOrThrow(PracticeQuery, req.query);
    res.json(await startPractice(db, ctx(req), q.conceptId, q.mode));
  });

  router.get("/student/practice/:setId/hint", requireStudent, hintLimiter, async (req, res) => {
    const q = parseOrThrow(HintQuery, req.query);
    res.json(await getHint(db, ctx(req), String(req.params.setId), q.questionId, q.level));
  });

  router.post("/student/practice/:setId/submit", requireStudent, practiceLimiter, async (req, res) => {
    const body = parseOrThrow(SubmitPracticeRequest, req.body);
    res.json(await submitPractice(db, ctx(req), String(req.params.setId), body, String(req.id)));
  });

  return router;
}
