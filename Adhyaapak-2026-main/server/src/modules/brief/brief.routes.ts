import { Router } from "express";
import { UpdateBriefItemRequest } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { parseOrThrow } from "../../http/validate";
import { requireRole } from "../auth/middleware";
import { generateBrief, getBrief, listBriefs, updateBriefItem } from "./brief.service";
import { getHomeNote } from "./home-note.service";

/** Teacher routes for Tomorrow's Teaching Brief and the family home note. */
export function briefRoutes(db: Db): Router {
  const router = Router();
  const teacherOnly = requireRole("teacher", "admin");
  const p = (v: unknown) => String(v);
  const rid = (req: { id?: unknown }) => String(req.id);

  router.post("/classes/:classId/teaching-briefs", teacherOnly, async (req, res) => {
    res.status(201).json(await generateBrief(db, req.user!, p(req.params.classId), rid(req)));
  });
  router.get("/classes/:classId/teaching-briefs", teacherOnly, async (req, res) => {
    res.json(await listBriefs(db, req.user!, p(req.params.classId)));
  });
  router.get("/teaching-briefs/:id", teacherOnly, async (req, res) => {
    res.json(await getBrief(db, req.user!, p(req.params.id)));
  });
  router.patch("/teaching-briefs/:id/items/:itemId", teacherOnly, async (req, res) => {
    res.json(await updateBriefItem(db, req.user!, p(req.params.id), p(req.params.itemId), parseOrThrow(UpdateBriefItemRequest, req.body), rid(req)));
  });
  router.get("/classes/:classId/students/:studentId/home-note", teacherOnly, async (req, res) => {
    res.json(await getHomeNote(db, req.user!, p(req.params.classId), p(req.params.studentId)));
  });

  return router;
}
