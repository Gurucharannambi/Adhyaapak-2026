import { Router } from "express";
import { z } from "zod";
import { AssignRequest, FollowUpRequest } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { parseOrThrow } from "../../http/validate";
import { requireRole } from "../auth/middleware";
import { getBranchBoard } from "./board.service";
import { getStudentHistory } from "./history.service";
import { assignInterventions, createFollowUp, finishIntervention, listInterventions } from "./intervention.service";

const Finish = z.object({ to: z.enum(["completed", "dismissed"]) });

/** Teacher-side routes for the Branch Board, activities, follow-ups and student history. */
export function interventionRoutes(db: Db): Router {
  const router = Router();
  const teacherOnly = requireRole("teacher", "admin");
  const p = (v: unknown) => String(v);
  const rid = (req: { id?: unknown }) => String(req.id);
  const q = (v: unknown) => (typeof v === "string" && v ? v : undefined);

  router.get("/classes/:classId/branch-board", teacherOnly, async (req, res) => {
    res.json(await getBranchBoard(db, req.user!, p(req.params.classId), q(req.query.conceptId)));
  });

  router.post("/classes/:classId/interventions", teacherOnly, async (req, res) => {
    const input = parseOrThrow(AssignRequest, req.body);
    res.status(201).json(await assignInterventions(db, req.user!, p(req.params.classId), input, rid(req)));
  });

  router.get("/classes/:classId/interventions", teacherOnly, async (req, res) => {
    res.json({ interventions: await listInterventions(db, req.user!, p(req.params.classId), q(req.query.conceptId)) });
  });

  router.post("/classes/:classId/interventions/follow-up", teacherOnly, async (req, res) => {
    const input = parseOrThrow(FollowUpRequest, req.body);
    res.status(201).json(await createFollowUp(db, req.user!, p(req.params.classId), input, rid(req)));
  });

  router.post("/interventions/:interventionId/finish", teacherOnly, async (req, res) => {
    const { to } = parseOrThrow(Finish, req.body);
    res.json(await finishIntervention(db, req.user!, p(req.params.interventionId), to, rid(req)));
  });

  router.get("/classes/:classId/students/:studentId/history", teacherOnly, async (req, res) => {
    res.json(await getStudentHistory(db, req.user!, p(req.params.classId), p(req.params.studentId)));
  });

  return router;
}
