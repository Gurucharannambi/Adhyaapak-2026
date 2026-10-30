import { Router } from "express";
import { StartCheckRequest, WrapRequest } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { parseOrThrow } from "../../http/validate";
import { requireRole } from "../auth/middleware";
import type { LlmProvider } from "../ai/provider";
import { getAttention } from "./attention.service";
import { getCopilot, getRunHistory } from "./copilot.service";
import { finishCheck, getRecap, getRun, getRunSummary, setPaused, startCheck, startRun, wrapRun } from "./run.service";

/** The lesson flow for a period: start, recap, one-tap check, summary and wrap-up. */
export function runRoutes(db: Db, ai: LlmProvider): Router {
  const router = Router();
  const teacherOnly = requireRole("teacher", "admin");
  const base = "/classes/:classId/lessons/:conceptId/run";
  const p = (v: unknown) => String(v);
  const ids = (req: { params: Record<string, unknown> }) => [p(req.params.classId), p(req.params.conceptId)] as const;

  router.get(base, teacherOnly, async (req, res) => {
    res.json(await getRun(db, req.user!, ...ids(req)));
  });
  router.post(base, teacherOnly, async (req, res) => {
    res.json(await startRun(db, req.user!, ...ids(req), p(req.id)));
  });
  router.get(`${base}/recap`, teacherOnly, async (req, res) => {
    res.json(await getRecap(db, req.user!, ...ids(req)));
  });
  router.post(`${base}/check/start`, teacherOnly, async (req, res) => {
    const input = parseOrThrow(StartCheckRequest, req.body ?? {});
    res.json(await startCheck(db, req.user!, ...ids(req), input, p(req.id)));
  });
  router.post(`${base}/check/finish`, teacherOnly, async (req, res) => {
    res.json(await finishCheck(db, req.user!, ...ids(req), p(req.id)));
  });
  router.post(`${base}/pause`, teacherOnly, async (req, res) => {
    res.json(await setPaused(db, req.user!, ...ids(req), true, p(req.id)));
  });
  router.post(`${base}/resume`, teacherOnly, async (req, res) => {
    res.json(await setPaused(db, req.user!, ...ids(req), false, p(req.id)));
  });
  router.get(`${base}/copilot`, teacherOnly, async (req, res) => {
    res.json(await getCopilot(db, ai, req.user!, ...ids(req)));
  });
  router.get(`${base}/history`, teacherOnly, async (req, res) => {
    res.json(await getRunHistory(db, req.user!, ...ids(req)));
  });
  router.get(`${base}/summary`, teacherOnly, async (req, res) => {
    res.json(await getRunSummary(db, req.user!, ...ids(req)));
  });
  router.post(`${base}/wrap`, teacherOnly, async (req, res) => {
    const input = parseOrThrow(WrapRequest, req.body ?? {});
    res.json(await wrapRun(db, req.user!, ...ids(req), input, p(req.id)));
  });

  router.get("/attention", teacherOnly, async (req, res) => {
    res.json({ items: await getAttention(db, req.user!) });
  });

  return router;
}
