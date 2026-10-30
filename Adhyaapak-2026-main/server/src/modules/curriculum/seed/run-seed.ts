import { loadConfig } from "../../../config";
import { createDb } from "../../../db/client";
import { seedBook } from "./book";

const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);

seedBook(db)
  .then(({ reports }) => {
    console.log("Seeded: Class 6 Mathematics textbook (Fractions + packages).");
    for (const [file, r] of Object.entries(reports)) console.log(`  ${file}: ${JSON.stringify(r.created)}; unchanged ${JSON.stringify(r.skipped)}`);
  })
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
