import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

const envFile = resolve(__dirname, "../.env");
if (existsSync(envFile)) process.loadEnvFile(envFile);

const testDb = process.env.TEST_DATABASE_URL ?? "postgres://adhyaapak:adhyaapak@localhost:5433/adhyaapak_test";

export default defineConfig({
  test: {
    environment: "node",
    globalSetup: ["./src/test/global-setup.ts"],
    // Tests share one database, so run files one at a time.
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      // Tests must never touch the development database.
      DATABASE_URL: testDb,
      TEST_DATABASE_URL: testDb,
      RATE_LIMIT_ENABLED: "false",
      // Tests must not pick up the developer's demo sign-in.
      DEMO_LOGIN_EMAIL: "",
      DEMO_LOGIN_PASSWORD: "",
      SESSION_SECRET: "test-secret-test-secret-test-secret",
      APP_BASE_URL: "http://localhost:5173",
    },
  },
});
