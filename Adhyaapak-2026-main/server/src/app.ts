import { randomUUID } from "node:crypto";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type Express } from "express";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import type { Logger } from "pino";
import { sql } from "drizzle-orm";
import type { PublicConfig } from "@adhyaapak/shared";
import type { AppConfig } from "./config";
import type { Db } from "./db/client";
import { errorHandler, notFoundHandler } from "./http/error-handler";
import { originCheck } from "./http/origin-check";
import { authRoutes } from "./modules/auth/auth.routes";
import { demoLogin } from "./modules/auth/demo-login";
import { timetableRoutes } from "./modules/timetable/timetable.routes";
import { runRoutes } from "./modules/lessons/run.routes";
import { pollRoutes } from "./modules/polls/poll.routes";
import { insightsRoutes } from "./modules/insights/insights.routes";
import { agentRoutes } from "./modules/agents/agent.routes";
import { loadSession } from "./modules/auth/middleware";
import { classRoutes } from "./modules/classes/class.routes";
import { classroomRoutes } from "./modules/classroom/classroom.routes";
import { interventionRoutes } from "./modules/interventions/intervention.routes";
import { lessonRoutes } from "./modules/lessons/lesson.routes";
import { aiRoutes } from "./modules/ai/ai.routes";
import { createProvider } from "./modules/ai/mesh-provider";
import type { LlmProvider } from "./modules/ai/provider";
import { LocalStorage, type StorageProvider } from "./modules/files/storage";
import { syllabusRoutes } from "./modules/syllabus/syllabus.routes";
import { paperRoutes } from "./modules/paper/paper.routes";
import { offlineRoutes } from "./modules/offline/offline.routes";
import { briefRoutes } from "./modules/brief/brief.routes";
import { portalRoutes } from "./modules/portal/portal.routes";
import { loadStudentSession } from "./modules/classroom/student-session";
import { studentRoutes } from "./modules/classroom/student.routes";
import { curriculumRoutes } from "./modules/curriculum/curriculum.routes";

export interface AppDeps {
  config: AppConfig;
  db: Db;
  logger: Logger;
  /** AI provider. Defaults to Mesh (or an "unavailable" stand-in when AI is off). Tests pass a fake. */
  ai?: LlmProvider;
  /** Private file storage. Defaults to a local folder; tests pass a temporary one. */
  storage?: StorageProvider;
}

export function createApp({ config, db, logger, ai = createProvider(config, logger), storage = new LocalStorage(config.UPLOAD_STORAGE_PATH) }: AppDeps): Express {
  const app = express();
  app.disable("x-powered-by");
  // Running behind one reverse proxy in production; needed for correct client IPs in rate limiting.
  if (config.NODE_ENV === "production") app.set("trust proxy", 1);

  app.use(
    pinoHttp({
      logger,
      genReqId: (req, res) => {
        const incoming = req.headers["x-request-id"];
        const id = typeof incoming === "string" && /^[\w-]{8,64}$/.test(incoming) ? incoming : randomUUID();
        res.setHeader("x-request-id", id);
        return id;
      },
    }),
  );
  app.use(helmet());
  app.use(cors({ origin: config.APP_BASE_URL, credentials: true }));
  app.use(express.json({ limit: "100kb" }));
  app.use(cookieParser());
  app.use(originCheck(config.APP_BASE_URL));

  const api = express.Router();
  api.use(loadSession(db));
  api.use(loadStudentSession(db));

  api.get("/health", async (_req, res) => {
    try {
      await db.execute(sql`select 1`);
      res.json({ status: "ok", database: "up" });
    } catch {
      res.status(503).json({ status: "degraded", database: "down" });
    }
  });

  api.get("/config", (_req, res) => {
    const demo = demoLogin(config);
    const body: PublicConfig = { appName: config.APP_NAME, aiEnabled: ai.available, ...(demo ? { demoLogin: demo } : {}) };
    res.json(body);
  });

  api.use("/auth", authRoutes(db, config));
  api.use(classRoutes(db, storage));
  api.use(classroomRoutes(db));
  api.use(interventionRoutes(db));
  api.use(lessonRoutes(db));
  api.use(timetableRoutes(db));
  api.use(runRoutes(db, ai));
  api.use(pollRoutes(db));
  api.use(insightsRoutes(db));
  api.use(agentRoutes(db, ai));
  api.use(aiRoutes(db, ai, config));
  api.use(syllabusRoutes(db, ai, storage, config));
  api.use(paperRoutes(db, ai, storage, config));
  api.use(offlineRoutes(db, config));
  api.use(briefRoutes(db));
  api.use(portalRoutes(db, config));
  api.use(studentRoutes(db, config));
  api.use(curriculumRoutes(db));

  app.use("/api/v1", api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
