import { Router } from "express";
import type { Db } from "../../db/client";
import { requireRole } from "../auth/middleware";
import { getAtlas, getTranslations } from "./atlas.service";
import { getConceptDetail, listChapters, listConcepts, listCurriculum } from "./curriculum.service";

/**
 * Curriculum content includes answer keys and misconception notes, so it is teacher/admin only.
 * Student-facing views (answers hidden) are added with the student session in Phase 4.
 */
export function curriculumRoutes(db: Db): Router {
  const router = Router();
  const teacherOnly = requireRole("teacher", "admin");

  router.get("/curriculum", teacherOnly, async (_req, res) => {
    res.json({ curricula: await listCurriculum(db) });
  });
  router.get("/curriculum/:curriculumId/chapters", teacherOnly, async (req, res) => {
    res.json({ chapters: await listChapters(db, String(req.params.curriculumId)) });
  });
  router.get("/chapters/:chapterId/concepts", teacherOnly, async (req, res) => {
    res.json({ concepts: await listConcepts(db, String(req.params.chapterId)) });
  });
  router.get("/concepts/:conceptId", teacherOnly, async (req, res) => {
    res.json(await getConceptDetail(db, String(req.params.conceptId)));
  });

  router.get("/misconceptions/atlas", teacherOnly, async (req, res) => {
    res.json(await getAtlas(db, req.user!));
  });
  router.get("/concepts/:conceptId/translations", teacherOnly, async (req, res) => {
    const language = typeof req.query.language === "string" && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(req.query.language) ? req.query.language : undefined;
    res.json(await getTranslations(db, String(req.params.conceptId), language));
  });

  return router;
}
