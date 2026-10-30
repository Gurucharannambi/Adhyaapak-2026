import { createApp } from "./app";
import { loadConfig } from "./config";
import { createDb } from "./db/client";
import { createLogger } from "./logger";
import { ensureDemoTeacher } from "./modules/auth/demo-login";
import { deleteExpiredSessions } from "./modules/auth/session";
import { deleteExpiredStudentSessions } from "./modules/classroom/student-session";
import { LocalStorage } from "./modules/files/storage";
import { purgeExpiredImages } from "./modules/paper/paper.service";

const config = loadConfig();
const logger = createLogger(config);
const { db, pool } = createDb(config.DATABASE_URL);
const storage = new LocalStorage(config.UPLOAD_STORAGE_PATH);
const app = createApp({ config, db, logger, storage });

const server = app.listen(config.API_PORT, () => {
  logger.info({ port: config.API_PORT, app: config.APP_NAME }, "server listening");
});

ensureDemoTeacher(db, config)
  .then((created) => created && logger.info("demo teacher account created"))
  .catch((err) => logger.error({ err }, "could not create the demo teacher"));

// Housekeeping: drop expired sessions hourly.
const sweep = setInterval(() => {
  deleteExpiredSessions(db).catch((err) => logger.error({ err }, "session sweep failed"));
  deleteExpiredStudentSessions(db).catch((err) => logger.error({ err }, "student session sweep failed"));
  // Retention: photographed answer sheets are deleted once their retention period ends.
  purgeExpiredImages(db, storage)
    .then((n) => n > 0 && logger.info({ deleted: n }, "expired answer-sheet photos deleted"))
    .catch((err) => logger.error({ err }, "photo retention sweep failed"));
}, 3600_000);
sweep.unref();

function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close(() => {
    pool.end().finally(() => process.exit(0));
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
