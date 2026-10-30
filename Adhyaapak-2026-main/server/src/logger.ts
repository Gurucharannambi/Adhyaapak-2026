import { pino, type DestinationStream, type Logger } from "pino";
import type { AppConfig } from "./config";

/**
 * Database errors can carry the values of the row that failed (Drizzle appends the query parameters to its
 * message, and Postgres puts the failing row in `detail`). For a school app those values can be a child's name,
 * so errors are logged with their type, code, a trimmed message and a short stack, and nothing else.
 */
export function safeError(err: unknown): Record<string, unknown> {
  const e = err as { name?: string; message?: string; code?: string; stack?: string; cause?: { code?: string } } | null;
  if (!e || typeof e !== "object") return { message: String(err).slice(0, 200) };
  const full = e.message ?? "";
  const message = full.split(/\r?\n\s*params:/)[0]!.slice(0, 300);
  return {
    type: e.name ?? "Error",
    message,
    ...(e.code || e.cause?.code ? { code: e.code ?? e.cause?.code } : {}),
    // A stack trace begins with the original message, so swap it for the trimmed one before keeping a few frames.
    stack: e.stack ? (full ? e.stack.replace(full, message) : e.stack).split("\n").slice(0, 8).join("\n") : undefined,
  };
}

export function createLogger(config: Pick<AppConfig, "LOG_LEVEL" | "NODE_ENV">, destination?: DestinationStream): Logger {
  return pino(
    {
      level: config.NODE_ENV === "test" && !destination ? "silent" : config.LOG_LEVEL,
      serializers: { err: safeError },
      // Never log credentials, session tokens or API keys.
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          "res.headers['set-cookie']",
          "*.password",
          "*.passwordHash",
          "*.token",
          "*.apiKey",
        ],
        censor: "[redacted]",
      },
    },
    destination,
  );
}
