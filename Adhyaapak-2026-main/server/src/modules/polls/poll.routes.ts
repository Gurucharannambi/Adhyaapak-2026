import { Router } from "express";
import { CreatePollRequest } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { parseOrThrow } from "../../http/validate";
import { requireRole } from "../auth/middleware";
import { closePoll, getCurrentPoll, startPoll } from "./poll.service";

/** Teacher side of quick polls. The student side lives with the other student routes. */
export function pollRoutes(db: Db): Router {
  const router = Router();
  const teacherOnly = requireRole("teacher", "admin");
  const p = (v: unknown) => String(v);

  router.post("/classes/:classId/lessons/:conceptId/polls", teacherOnly, async (req, res) => {
    const input = parseOrThrow(CreatePollRequest, req.body);
    res.status(201).json(await startPoll(db, req.user!, p(req.params.classId), p(req.params.conceptId), input, p(req.id)));
  });
  router.get("/classes/:classId/lessons/:conceptId/polls/current", teacherOnly, async (req, res) => {
    res.json(await getCurrentPoll(db, req.user!, p(req.params.classId), p(req.params.conceptId)));
  });
  router.post("/polls/:pollId/close", teacherOnly, async (req, res) => {
    res.json(await closePoll(db, req.user!, p(req.params.pollId), p(req.id)));
  });

  return router;
}
