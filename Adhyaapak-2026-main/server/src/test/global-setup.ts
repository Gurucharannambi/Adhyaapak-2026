import { runMigrations } from "../db/migrate";

export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set");
  // Guard: never run (and later truncate) against a database that is not clearly a test database.
  if (!/_test(\?|$)/.test(url)) {
    throw new Error("Refusing to run tests: TEST_DATABASE_URL must point to a database whose name ends with _test");
  }
  await runMigrations(url);
}
