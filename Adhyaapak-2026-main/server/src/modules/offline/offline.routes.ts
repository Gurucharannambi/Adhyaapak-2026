import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import { BuildPackRequest, ResolveConflictRequest, SyncRequest } from "@adhyaapak/shared";
import type { AppConfig } from "../../config";
import type { Db } from "../../db/client";
import { AppError } from "../../http/errors";
import { parseOrThrow } from "../../http/validate";
import { requireRole } from "../auth/middleware";
import { buildPack, getPack, listPacks } from "./pack.service";
import { listConflicts, processOperations, resolveConflict, syncStatus } from "./sync.service";

/** Teacher routes for offline lesson packs and for merging work recorded without a connection. */
export function offlineRoutes(db: Db, config: AppConfig): Router {
  const router = Router();
  const teacherOnly = requireRole("teacher", "admin");
  const p = (v: unknown) => String(v);
  const rid = (req: { id?: unknown }) => String(req.id);

  const syncLimiter: RequestHandler = config.RATE_LIMIT_ENABLED
    ? rateLimit({
        windowMs: 5 * 60 * 1000,
        limit: 120,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        keyGenerator: (req) => `sync:${req.user?.id ?? "anon"}`,
        validate: { keyGeneratorIpFallback: false },
        handler: (_req, _res, next) => next(new AppError("rate_limited", "Syncing too often. It will retry on its own in a moment.")),
      })
    : (_req, _res, next) => next();

  router.post("/lessons/:conceptId/offline-packs", teacherOnly, async (req, res) => {
    const input = parseOrThrow(BuildPackRequest, req.body);
    res.status(201).json(await buildPack(db, req.user!, p(req.params.conceptId), input, rid(req)));
  });

  router.get("/offline-packs/:packId", teacherOnly, async (req, res) => {
    res.json(await getPack(db, req.user!, p(req.params.packId)));
  });

  router.get("/classes/:classId/offline-packs", teacherOnly, async (req, res) => {
    res.json(await listPacks(db, req.user!, p(req.params.classId)));
  });

  router.post("/sync/operations", teacherOnly, syncLimiter, async (req, res) => {
    const input = parseOrThrow(SyncRequest, req.body);
    res.json(await processOperations(db, req.user!, input.operations, rid(req)));
  });

  router.get("/sync/status", teacherOnly, async (req, res) => {
    res.json(await syncStatus(db, req.user!));
  });

  router.get("/sync/conflicts", teacherOnly, async (req, res) => {
    res.json(await listConflicts(db, req.user!));
  });

  router.post("/sync/conflicts/:id/resolve", teacherOnly, async (req, res) => {
    const { action } = parseOrThrow(ResolveConflictRequest, req.body);
    res.json(await resolveConflict(db, req.user!, p(req.params.id), action, rid(req)));
  });

  return router;
}
