import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { GenerateExplanationRequest, GenerateQuestionsRequest, ReviewDraftRequest, UpdateQuestionDraftRequest, UpdateResourceDraftRequest } from "@adhyaapak/shared";
import type { AppConfig } from "../../config";
import type { Db } from "../../db/client";
import { AppError } from "../../http/errors";
import { parseOrThrow } from "../../http/validate";
import { requireRole } from "../auth/middleware";
import { generateExplanationDraft, generateQuestionDrafts, listDrafts, reviewQuestionDraft, reviewResourceDraft, updateQuestionDraft, updateResourceDraft } from "./drafts.service";
import type { LlmProvider } from "./provider";

/** Teacher routes for AI-drafted content. Nothing here publishes anything: drafts need a human review. */
export function aiRoutes(db: Db, ai: LlmProvider, config: AppConfig): Router {
  const router = Router();
  const teacherOnly = requireRole("teacher", "admin");
  const p = (v: unknown) => String(v);
  const rid = (req: { id?: unknown }) => String(req.id);

  // Each AI call costs money, so a person gets a small allowance (per account, not per network address).
  const generateLimiter: RequestHandler = config.RATE_LIMIT_ENABLED
    ? rateLimit({
        windowMs: 10 * 60 * 1000,
        limit: 20,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        keyGenerator: (req) => `ai:${req.user?.id ?? "anon"}`,
        validate: { keyGeneratorIpFallback: false },
        handler: (_req, _res, next) => next(new AppError("rate_limited", "You have asked the AI for a lot of drafts in a short time. Please review some, then try again in a few minutes.")),
      })
    : (_req, _res, next) => next();

  router.get("/concepts/:conceptId/drafts", teacherOnly, async (req, res) => {
    res.json(await listDrafts(db, ai, req.user!, p(req.params.conceptId)));
  });

  router.post("/concepts/:conceptId/drafts/questions", teacherOnly, generateLimiter, async (req, res) => {
    const input = parseOrThrow(GenerateQuestionsRequest, req.body ?? {});
    res.status(201).json(await generateQuestionDrafts(db, ai, req.user!, p(req.params.conceptId), input, rid(req)));
  });

  router.post("/concepts/:conceptId/drafts/explanations", teacherOnly, generateLimiter, async (req, res) => {
    const input = parseOrThrow(GenerateExplanationRequest, req.body);
    res.status(201).json(await generateExplanationDraft(db, ai, req.user!, p(req.params.conceptId), input, rid(req)));
  });

  router.patch("/question-drafts/:id", teacherOnly, async (req, res) => {
    res.json(await updateQuestionDraft(db, req.user!, p(req.params.id), parseOrThrow(UpdateQuestionDraftRequest, req.body), rid(req)));
  });

  router.patch("/resource-drafts/:id", teacherOnly, async (req, res) => {
    res.json(await updateResourceDraft(db, req.user!, p(req.params.id), parseOrThrow(UpdateResourceDraftRequest, req.body), rid(req)));
  });

  router.post("/question-drafts/:id/review", teacherOnly, async (req, res) => {
    const { decision, checkedByHand } = parseOrThrow(ReviewDraftRequest, req.body);
    res.json(await reviewQuestionDraft(db, req.user!, p(req.params.id), decision, { checkedByHand }, rid(req)));
  });

  router.post("/resource-drafts/:id/review", teacherOnly, async (req, res) => {
    const { decision, checkedByHand } = parseOrThrow(ReviewDraftRequest, req.body);
    res.json(await reviewResourceDraft(db, req.user!, p(req.params.id), decision, { checkedByHand }, rid(req)));
  });

  return router;
}
