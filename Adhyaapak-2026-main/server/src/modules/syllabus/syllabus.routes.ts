import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import multer from "multer";
import { AddEdgeRequest, AddProposalConceptRequest, DecideEdgeRequest, GenerateGraphRequest, PasteSyllabusRequest, PublishRequest, UpdateProposalConceptRequest } from "@adhyaapak/shared";
import type { AppConfig } from "../../config";
import type { Db } from "../../db/client";
import { AppError } from "../../http/errors";
import { parseOrThrow } from "../../http/validate";
import type { LlmProvider } from "../ai/provider";
import { requireRole } from "../auth/middleware";
import type { StorageProvider } from "../files/storage";
import {
  addDocumentFromFile,
  addDocumentFromText,
  addProposalConcept,
  addProposalEdge,
  decideEdge,
  deleteDocument,
  discardProposal,
  generateGraph,
  getProposal,
  listDocuments,
  publishProposal,
  removeProposalConcept,
  updateProposalConcept,
} from "./syllabus.service";

/** Teacher routes for uploading a syllabus and turning it into a reviewed concept graph. */
export function syllabusRoutes(db: Db, ai: LlmProvider, storage: StorageProvider, config: AppConfig): Router {
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
          keyGenerator: (req) => `syllabus:${req.user?.id ?? "anon"}`,
          validate: { keyGeneratorIpFallback: false },
          handler: (_req, _res, next) => next(new AppError("rate_limited", message)),
        })
      : (_req, _res, next) => next();
  const uploadLimiter = perUser(30, 60 * 60 * 1000, "You have uploaded a lot of files in the last hour. Please wait a little.");
  const generateLimiter = perUser(10, 10 * 60 * 1000, "You have asked the AI for several graphs in a short time. Please review one first, then try again in a few minutes.");

  const maxBytes = Math.floor(config.MAX_UPLOAD_SIZE_MB * 1024 * 1024);
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 4, parts: 6 } }).single("file");
  // Turn upload-library errors into our standard safe errors.
  const receiveFile: RequestHandler = (req, res, next) =>
    upload(req, res, (err: unknown) => {
      if (!err) return next();
      const code = (err as { code?: string }).code;
      if (code === "LIMIT_FILE_SIZE") return next(new AppError("validation_error", `That file is too large. The limit is ${config.MAX_UPLOAD_SIZE_MB} MB.`));
      return next(new AppError("validation_error", "We could not read that upload. Choose one PDF or text file."));
    });

  router.get("/syllabus-documents", teacherOnly, async (req, res) => {
    res.json({ documents: await listDocuments(db, req.user!) });
  });

  router.post("/syllabus-documents", teacherOnly, uploadLimiter, receiveFile, async (req, res) => {
    if (!req.file) throw new AppError("validation_error", "Choose a file to upload.");
    const r = await addDocumentFromFile(db, storage, req.user!, { originalname: req.file.originalname, buffer: req.file.buffer }, rid(req));
    res.status(r.alreadyUploaded ? 200 : 201).json(r);
  });

  router.post("/syllabus-documents/text", teacherOnly, uploadLimiter, async (req, res) => {
    const input = parseOrThrow(PasteSyllabusRequest, req.body);
    const r = await addDocumentFromText(db, req.user!, input, rid(req));
    res.status(r.alreadyUploaded ? 200 : 201).json(r);
  });

  router.delete("/syllabus-documents/:documentId", teacherOnly, async (req, res) => {
    await deleteDocument(db, storage, req.user!, p(req.params.documentId), rid(req));
    res.status(204).end();
  });

  router.post("/syllabus-documents/:documentId/generate-graph", teacherOnly, generateLimiter, async (req, res) => {
    const input = parseOrThrow(GenerateGraphRequest, req.body);
    res.status(201).json(await generateGraph(db, ai, req.user!, p(req.params.documentId), input, rid(req)));
  });

  router.get("/graph-proposals/:id", teacherOnly, async (req, res) => {
    res.json(await getProposal(db, req.user!, p(req.params.id)));
  });

  router.patch("/graph-proposals/:id/concepts/:conceptId", teacherOnly, async (req, res) => {
    res.json(await updateProposalConcept(db, req.user!, p(req.params.id), p(req.params.conceptId), parseOrThrow(UpdateProposalConceptRequest, req.body), rid(req)));
  });

  router.post("/graph-proposals/:id/concepts", teacherOnly, async (req, res) => {
    res.status(201).json(await addProposalConcept(db, req.user!, p(req.params.id), parseOrThrow(AddProposalConceptRequest, req.body), rid(req)));
  });

  router.delete("/graph-proposals/:id/concepts/:conceptId", teacherOnly, async (req, res) => {
    res.json(await removeProposalConcept(db, req.user!, p(req.params.id), p(req.params.conceptId), rid(req)));
  });

  router.patch("/graph-proposals/:id/edges/:edgeId", teacherOnly, async (req, res) => {
    const { decision } = parseOrThrow(DecideEdgeRequest, req.body);
    res.json(await decideEdge(db, req.user!, p(req.params.id), p(req.params.edgeId), decision, rid(req)));
  });

  router.post("/graph-proposals/:id/edges", teacherOnly, async (req, res) => {
    res.status(201).json(await addProposalEdge(db, req.user!, p(req.params.id), parseOrThrow(AddEdgeRequest, req.body), rid(req)));
  });

  router.post("/graph-proposals/:id/discard", teacherOnly, async (req, res) => {
    await discardProposal(db, req.user!, p(req.params.id), rid(req));
    res.status(204).end();
  });

  router.post("/graph-proposals/:id/publish", teacherOnly, async (req, res) => {
    parseOrThrow(PublishRequest, req.body);
    res.status(201).json(await publishProposal(db, req.user!, p(req.params.id), rid(req)));
  });

  return router;
}
