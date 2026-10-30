import { Router } from "express";
import type { Db } from "../../db/client";
import { requireRole } from "../auth/middleware";
import { getInsights } from "./insights.service";
import { getAtlasWorkspace } from "./atlas.service";

/** Insights and the Misconception Atlas workspace share one evidence model; both are teacher-only. */
export function insightsRoutes(db: Db): Router {
  const router = Router();
  const teacherOnly = requireRole("teacher", "admin");
  router.get("/classes/:classId/insights", teacherOnly, async (req, res) => {
    res.json(await getInsights(db, req.user!, String(req.params.classId)));
  });
  router.get("/classes/:classId/atlas", teacherOnly, async (req, res) => {
    res.json(await getAtlasWorkspace(db, req.user!, String(req.params.classId)));
  });
  return router;
}
