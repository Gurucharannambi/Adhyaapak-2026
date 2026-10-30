import { Router } from "express";
import { SaveTimetableRequest } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { parseOrThrow } from "../../http/validate";
import { requireRole } from "../auth/middleware";
import { getTimetable, saveTimetable } from "./timetable.service";

export function timetableRoutes(db: Db): Router {
  const router = Router();
  const teacherOnly = requireRole("teacher", "admin");

  router.get("/classes/:classId/timetable", teacherOnly, async (req, res) => {
    res.json(await getTimetable(db, req.user!, String(req.params.classId)));
  });

  router.put("/classes/:classId/timetable", teacherOnly, async (req, res) => {
    const input = parseOrThrow(SaveTimetableRequest, req.body);
    await saveTimetable(db, req.user!, String(req.params.classId), input, String(req.id));
    res.json(await getTimetable(db, req.user!, String(req.params.classId)));
  });

  return router;
}
