import { readFile } from "node:fs/promises";
import { loadConfig } from "../../../config";
import { createDb } from "../../../db/client";
import { importPackage } from "./import";

/**
 * Operator tool: npm run content:import -w server -- <file.json> [--dry-run] [--approve]
 * Checks a content package and imports it. Not exposed over HTTP, because published curricula are visible to every
 * teacher on the installation, so adding one is an administrator's decision.
 */
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
if (!file) {
  console.error("Usage: npm run content:import -w server -- <file.json> [--dry-run] [--approve]");
  process.exit(2);
}

async function main() {
const config = loadConfig();
const { db, pool } = createDb(config.DATABASE_URL);
try {
  const raw: unknown = JSON.parse(await readFile(file!, "utf8"));
  const report = await importPackage(db, raw, { dryRun: args.includes("--dry-run"), approve: args.includes("--approve") });
  for (const i of report.issues) console.log(`${i.severity === "error" ? "ERROR  " : "warning"} ${i.path}: ${i.message}`);
  console.log(report.ok ? `${report.dryRun ? "Checked (nothing written)" : "Imported"}: ${JSON.stringify(report.created)}; left unchanged: ${JSON.stringify(report.skipped)}` : "Not imported: fix the errors above and run again.");
  process.exitCode = report.ok ? 0 : 1;
} catch (err) {
  console.error("Import failed:", err instanceof Error ? err.message : err);
  process.exitCode = 1;
} finally {
  await pool.end();
}
}

void main();
