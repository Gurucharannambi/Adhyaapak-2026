import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { ProcessPaperRequest, ReviewPaperRequest } from "@adhyaapak/shared";
import type { AppConfig } from "../../config";
import type { Db } from "../../db/client";
import { AppError } from "../../http/errors";
import { parseOrThrow } from "../../http/validate";
import type { LlmProvider } from "../ai/provider";
import { requireRole } from "../auth/middleware";
import type { StorageProvider } from "../files/storage";
import { approveSheet, deleteSheetImage, getSheet, getSheetImage, listSheets, processSheet, readingAccuracy, rejectSheet, saveReview, uploadSheet } from "./paper.service";

/** Teacher routes for photographed answer sheets: upload, read, review, approve. */
export function paperRoutes(db: Db, ai: LlmProvider, storage: StorageProvider, config: AppConfig): Router {
  const router = Router();
  const teacherOnly = requireRole("teacher", "admin");
  const p = (v: unknown) => String(v);
  const rid = (req: { id?: unknown }) => String(req.id);

  const perUser = (limit: number, windowMs: number, message: string): RequestHandler =>
    config.RATE_LIMIT_ENABLED
      ? rateLimit({
          windowMs,
          limit,
          standardHeaders: "draft-8",
          legacyHeaders: false,
          keyGenerator: (req) => `paper:${req.user?.id ?? "anon"}`,
          validate: { keyGeneratorIpFallback: false },
          handler: (_req, _res, next) => next(new AppError("rate_limited", message)),
        })
      : (_req, _res, next) => next();
  const uploadLimiter = perUser(120, 60 * 60 * 1000, "You have uploaded a lot of photos in the last hour. Please wait a little.");
  const readLimiter = perUser(60, 60 * 60 * 1000, "You have asked the AI to read a lot of sheets in the last hour. Please wait a little, or enter answers by hand.");

  const maxBytes = Math.floor(config.MAX_UPLOAD_SIZE_MB * 1024 * 1024);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 4, parts: 6 } }).single("file");
  const receiveFile: RequestHandler = (req, res, next) =>
    upload(req, res, (err: unknown) => {
      if (!err) return next();
      if ((err as { code?: string }).code === "LIMIT_FILE_SIZE") return next(new AppError("validation_error", `That photo is too large. The limit is ${config.MAX_UPLOAD_SIZE_MB} MB.`));
      return next(new AppError("validation_error", "We could not read that upload. Choose one JPEG or PNG photo."));
    });

  router.get("/assessments/:assessmentId/submission-files", teacherOnly, async (req, res) => {
    res.json(await listSheets(db, req.user!, p(req.params.assessmentId)));
  });

  router.post("/submission-files", teacherOnly, uploadLimiter, receiveFile, async (req, res) => {
    if (!req.file) throw new AppError("validation_error", "Choose a photo to upload.");
    const sheet = await uploadSheet(db, storage, req.user!, { assessmentId: p(req.body?.assessmentId), studentId: p(req.body?.studentId), file: req.file.buffer }, rid(req));
    res.status(201).json(sheet);
  });

  router.get("/paper-accuracy", teacherOnly, async (req, res) => {
    res.json(await readingAccuracy(db, req.user!));
  });

  router.get("/submission-files/:id", teacherOnly, async (req, res) => {
    res.json(await getSheet(db, req.user!, p(req.params.id)));
  });

  // The photo is private: only streamed here, never cached, never embeddable by another site.
  router.get("/submission-files/:id/image", teacherOnly, async (req, res) => {
    const { bytes, mimeType } = await getSheetImage(db, storage, req.user!, p(req.params.id));
    res.set({ "Content-Type": mimeType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline", "Cross-Origin-Resource-Policy": "same-site" });
    res.send(bytes);
  });

  router.post("/submission-files/:id/process", teacherOnly, readLimiter, async (req, res) => {
    parseOrThrow(ProcessPaperRequest, req.body);
    res.json(await processSheet(db, ai, storage, req.user!, p(req.params.id), rid(req)));
  });

  router.post("/submission-files/:id/review", teacherOnly, async (req, res) => {
    res.json(await saveReview(db, req.user!, p(req.params.id), parseOrThrow(ReviewPaperRequest, req.body), rid(req)));
  });

  router.post("/submission-files/:id/approve", teacherOnly, async (req, res) => {
    res.json(await approveSheet(db, req.user!, p(req.params.id), config.PAPER_RETENTION_DAYS, rid(req)));
  });

  router.post("/submission-files/:id/reject", teacherOnly, async (req, res) => {
    await rejectSheet(db, storage, req.user!, p(req.params.id), rid(req));
    res.status(204).end();
  });

  router.delete("/submission-files/:id/image", teacherOnly, async (req, res) => {
    await deleteSheetImage(db, storage, req.user!, p(req.params.id), rid(req));
    res.status(204).end();
  });

  return router;
}
