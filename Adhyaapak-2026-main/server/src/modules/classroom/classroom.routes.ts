import { Router } from "express";
import { CreateAssessmentRequest, GridEntryRequest, ReviewMisconceptionRequest, SuggestQuestionsRequest } from "@adhyaapak/shared";
import { z } from "zod";
import type { Db } from "../../db/client";
import { parseOrThrow } from "../../http/validate";
import { requireRole } from "../auth/middleware";
import { reviewMisconception } from "../learning/persistence/misconception.service";
import { changeAssessmentStatus, createClassAssessment, enterGridAnswers, getAssessmentDetail, listAllAssessments, listAssessments, releaseResults, suggestQuestions } from "./assessment.service";
import { loadAccessibleClass } from "../classes/class.access";
import { openStream } from "../live/hub";
import { getClassMisconceptions, getEvidenceDrilldown, getLearningMap } from "./map.service";

const StatusChange = z.object({ to: z.enum(["approved", "open", "closed"]) });

/** Teacher-side classroom routes. Ownership of the class or assessment is checked in each service. */
export function classroomRoutes(db: Db): Router {
  const router = Router();
  const teacherOnly = requireRole("teacher", "admin");
  const rid = (req: { id?: unknown }) => String(req.id);
  const p = (v: unknown) => String(v);

  router.get("/classes/:classId/assessments", teacherOnly, async (req, res) => {
    res.json({ assessments: await listAssessments(db, req.user!, p(req.params.classId)) });
  });

  router.post("/classes/:classId/assessments/suggest", teacherOnly, async (req, res) => {
    const input = parseOrThrow(SuggestQuestionsRequest, req.body);
    res.json({ questions: await suggestQuestions(db, req.user!, p(req.params.classId), input) });
  });

  router.post("/classes/:classId/assessments", teacherOnly, async (req, res) => {
    const input = parseOrThrow(CreateAssessmentRequest, req.body);
    const a = await createClassAssessment(db, req.user!, p(req.params.classId), input, rid(req));
    res.status(201).json({ id: a.id });
  });

  router.get("/assessments", teacherOnly, async (req, res) => {
    res.json({ assessments: await listAllAssessments(db, req.user!) });
  });

  router.get("/assessments/:assessmentId", teacherOnly, async (req, res) => {
    res.json(await getAssessmentDetail(db, req.user!, p(req.params.assessmentId)));
  });

  router.post("/assessments/:assessmentId/status", teacherOnly, async (req, res) => {
    const { to } = parseOrThrow(StatusChange, req.body);
    const a = await changeAssessmentStatus(db, req.user!, p(req.params.assessmentId), to, rid(req));
    res.json({ id: a.id, status: a.status });
  });

  // Live signals for the teacher's classroom screens. The page re-reads the normal API when one arrives.
  router.get("/classes/:classId/live", teacherOnly, async (req, res) => {
    const cls = await loadAccessibleClass(db, req.user!, p(req.params.classId));
    openStream(req, res, cls.id);
  });

  router.post("/assessments/:assessmentId/release-results", teacherOnly, async (req, res) => {
    res.json(await releaseResults(db, req.user!, p(req.params.assessmentId), rid(req)));
  });

  router.post("/assessments/:assessmentId/entry", teacherOnly, async (req, res) => {
    const input = parseOrThrow(GridEntryRequest, req.body);
    res.json(await enterGridAnswers(db, req.user!, p(req.params.assessmentId), input, rid(req)));
  });

  router.get("/classes/:classId/learning-map", teacherOnly, async (req, res) => {
    const conceptIds = typeof req.query.conceptIds === "string" ? req.query.conceptIds.split(",").filter(Boolean) : undefined;
    const assessmentId = typeof req.query.assessmentId === "string" ? req.query.assessmentId : undefined;
    res.json(await getLearningMap(db, req.user!, p(req.params.classId), { ...(conceptIds ? { conceptIds } : {}), ...(assessmentId ? { assessmentId } : {}) }));
  });

  router.get("/classes/:classId/students/:studentId/concepts/:conceptId/evidence", teacherOnly, async (req, res) => {
    res.json(await getEvidenceDrilldown(db, req.user!, p(req.params.classId), p(req.params.studentId), p(req.params.conceptId)));
  });

  router.get("/classes/:classId/misconceptions", teacherOnly, async (req, res) => {
    res.json(await getClassMisconceptions(db, req.user!, p(req.params.classId)));
  });

  router.post("/classes/:classId/misconceptions/review", teacherOnly, async (req, res) => {
    const input = parseOrThrow(ReviewMisconceptionRequest, req.body);
    res.json(await reviewMisconception(db, req.user!, { studentId: input.studentId, patternId: input.patternId, decision: input.decision, requestId: rid(req) }));
  });

  return router;
}
