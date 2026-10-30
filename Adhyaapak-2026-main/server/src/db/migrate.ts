import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { loadConfig } from "../config";
import { createDb } from "./client";

const migrationsFolder = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../drizzle");

export async function runMigrations(connectionString: string): Promise<void> {
  const { db, pool } = createDb(connectionString);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await pool.end();
  }
}

// `npm run db:migrate` executes this file directly.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const config = loadConfig();
  runMigrations(config.DATABASE_URL)
    .then(() => console.log("Migrations applied."))
    .catch((err) => {
      console.error("Migration failed:", err);
      process.exit(1);
    });
}
