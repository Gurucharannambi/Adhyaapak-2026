import { Router } from "express";
import { AddStudentRequest, CorrectStudentRequest, CreateClassRequest, EraseStudentRequest, ImportRosterRequest, UpdateClassRequest } from "@adhyaapak/shared";
import type { StorageProvider } from "../files/storage";
import type { Db } from "../../db/client";
import { parseOrThrow } from "../../http/validate";
import { requireRole } from "../auth/middleware";
import {
  addStudent,
  correctStudent,
  createClass,
  eraseStudent,
  getClass,
  getDashboard,
  importRoster,
  listClasses,
  listStudents,
  updateClass,
  withdrawStudent,
} from "./class.service";

export function classRoutes(db: Db, storage: StorageProvider): Router {
  const router = Router();
  // Classes belong to teachers; admins may inspect them. Per-class ownership is checked in the service.
  const teacherOnly = requireRole("teacher", "admin");

  const rid = (req: { id?: unknown }) => String(req.id);

  router.get("/dashboard", teacherOnly, async (req, res) => {
    res.json(await getDashboard(db, req.user!, typeof req.query.week === "string" && /^d{4}-d{2}-d{2}$/.test(req.query.week) ? req.query.week : undefined));
  });

  router.get("/classes", teacherOnly, async (req, res) => {
    res.json({ classes: await listClasses(db, req.user!) });
  });

  router.post("/classes", teacherOnly, async (req, res) => {
    const input = parseOrThrow(CreateClassRequest, req.body);
    res.status(201).json(await createClass(db, req.user!, input, rid(req)));
  });

  router.get("/classes/:classId", teacherOnly, async (req, res) => {
    res.json(await getClass(db, req.user!, String(req.params.classId)));
  });

  router.patch("/classes/:classId", teacherOnly, async (req, res) => {
    const input = parseOrThrow(UpdateClassRequest, req.body);
    res.json(await updateClass(db, req.user!, String(req.params.classId), input, rid(req)));
  });

  router.get("/classes/:classId/students", teacherOnly, async (req, res) => {
    res.json({ students: await listStudents(db, req.user!, String(req.params.classId)) });
  });

  router.post("/classes/:classId/students", teacherOnly, async (req, res) => {
    const input = parseOrThrow(AddStudentRequest, req.body);
    res.status(201).json(await addStudent(db, req.user!, String(req.params.classId), input, rid(req)));
  });

  router.patch("/classes/:classId/students/:studentId", teacherOnly, async (req, res) => {
    const input = parseOrThrow(CorrectStudentRequest, req.body);
    res.json(await correctStudent(db, req.user!, String(req.params.classId), String(req.params.studentId), input, rid(req)));
  });

  router.post("/classes/:classId/students/:studentId/erase", teacherOnly, async (req, res) => {
    parseOrThrow(EraseStudentRequest, req.body);
    await eraseStudent(db, storage, req.user!, String(req.params.classId), String(req.params.studentId), rid(req));
    res.status(204).end();
  });

  router.delete("/classes/:classId/students/:studentId", teacherOnly, async (req, res) => {
    await withdrawStudent(db, req.user!, String(req.params.classId), String(req.params.studentId), rid(req));
    res.status(204).end();
  });

  router.post("/classes/:classId/enrolments/import", teacherOnly, async (req, res) => {
    const input = parseOrThrow(ImportRosterRequest, req.body);
    res.json(await importRoster(db, req.user!, String(req.params.classId), input, rid(req)));
  });

  return router;
}
