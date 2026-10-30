import { Router } from "express";
import { MarkTaughtRequest } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { parseOrThrow } from "../../http/validate";
import { requireRole } from "../auth/middleware";
import { getCoverage, getLesson, getPresentation, setTaught } from "./lesson.service";

export function lessonRoutes(db: Db): Router {
  const router = Router();
  const teacherOnly = requireRole("teacher", "admin");
  const p = (v: unknown) => String(v);

  router.get("/classes/:classId/lessons/:conceptId", teacherOnly, async (req, res) => {
    res.json(await getLesson(db, req.user!, p(req.params.classId), p(req.params.conceptId)));
  });

  router.put("/classes/:classId/lessons/:conceptId/taught", teacherOnly, async (req, res) => {
    const { taught } = parseOrThrow(MarkTaughtRequest, req.body);
    res.json(await setTaught(db, req.user!, p(req.params.classId), p(req.params.conceptId), taught, String(req.id)));
  });

  router.get("/classes/:classId/coverage", teacherOnly, async (req, res) => {
    res.json(await getCoverage(db, req.user!, p(req.params.classId)));
  });

  // Presentation content is not tied to a class on purpose: it cannot contain any class data.
  router.get("/concepts/:conceptId/presentation", teacherOnly, async (req, res) => {
    res.json(await getPresentation(db, p(req.params.conceptId)));
  });

  return router;
}
