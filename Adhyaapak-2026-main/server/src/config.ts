import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");
const envFile = resolve(repoRoot, ".env");
// Real environment variables win over the file, so CI and tests can override.
if (existsSync(envFile)) process.loadEnvFile(envFile);

const bool = z
  .enum(["true", "false"])
  .transform((v) => v === "true");

const EnvSchema = z.object({
  APP_NAME: z.string().min(1).default("Adhyaapak"),
  APP_BASE_URL: z.url().default("http://localhost:5173"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1),
  TEST_DATABASE_URL: z.string().optional(),

  /** Optional public demo sign-in (never offered when NODE_ENV is production). See modules/auth/demo-login.ts. */
  DEMO_LOGIN_EMAIL: z.string().optional(),
  DEMO_LOGIN_PASSWORD: z.string().optional(),

  SESSION_SECRET: z.string().min(16),
  SESSION_COOKIE_SECURE: bool.default(false),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(24 * 7),
  RATE_LIMIT_ENABLED: bool.default(true),

  UPLOAD_STORAGE_PATH: z.string().default("./storage"),
  MAX_UPLOAD_SIZE_MB: z.coerce.number().positive().max(50).default(10),
  /** How long a photographed sheet is kept after a teacher approves it, before it is deleted automatically. */
  PAPER_RETENTION_DAYS: z.coerce.number().int().min(0).max(365).default(30),

  AI_ENABLED: bool.default(true),
  MESH_API_BASE_URL: z.url().default("https://api.meshapi.ai/v1"),
  MESH_API_KEY: z.string().optional(),
  MESH_API_MODEL: z.string().default("openai/gpt-4o-mini"),
  MESH_API_VISION_MODEL: z.string().default("openai/gpt-4o-mini"),
  MESH_API_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),
  MESH_API_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid configuration:\n${problems}\n(See .env.example)`);
  }
  return parsed.data;
}
