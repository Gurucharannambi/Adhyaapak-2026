import { readFile } from "node:fs/promises";
import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { chapters, curriculumVersions } from "../../../db/schema";
import { importPackage, type ImportReport } from "../content/import";
import { seedFractionsClass6 } from "./seed";

/**
 * Our own Class 6 Mathematics textbook, in teaching order: Fractions (seeded in code), then one content package per
 * chapter in server/content/. Every word is original (CLAUDE.md §2): chapter titles and topic scope follow the usual
 * Class 6 syllabus, but no textbook text, examples or illustrations are copied. Safe to run repeatedly.
 */
export const BOOK_PACKAGES = ["decimals-class6.json", "patterns-class6.json", "lines-angles-class6.json", "data-handling-class6.json"];

/** Chapter summaries for the two chapters whose content was authored before chapters had summaries. */
const SUMMARIES: Record<string, { summary: string; keyIdeas: string[] }> = {
  Fractions: {
    summary:
      "Fractions describe equal parts of a whole. The chapter starts from times-table facts and equal sharing, moves through equivalent fractions and common denominators, and ends with adding and subtracting fractions and using them in word problems. Pictures come first; rules come second.",
    keyIdeas: ["A fraction needs equal parts.", "Equivalent fractions name the same amount in different-sized pieces.", "Add or subtract only when the pieces are the same size.", "Always check: does the answer make sense?"],
  },
  Decimals: {
    summary:
      "Decimals are fractions whose denominator is 10, 100 or 1000, written with a point. Students connect tenths and hundredths to fraction bars, compare and add decimals by lining up place value, and use decimals for money and measurement.",
    keyIdeas: ["A decimal is a fraction with denominator 10, 100 or 1000.", "Line up the decimal points before you add or subtract.", "More digits do not mean a bigger number: compare place by place."],
  },
};

export async function seedBook(db: Db): Promise<{ reports: Record<string, ImportReport> }> {
  await seedFractionsClass6(db);
  const reports: Record<string, ImportReport> = {};
  for (const file of BOOK_PACKAGES) {
    const raw: unknown = JSON.parse(await readFile(new URL(`../../../../content/${file}`, import.meta.url), "utf8"));
    reports[file] = await importPackage(db, raw, { approve: true });
    if (!reports[file]!.ok) throw new Error(`Content package ${file} was not imported:\n${reports[file]!.issues.map((i) => `  ${i.path}: ${i.message}`).join("\n")}`);
  }
  // The curriculum started life as a one-chapter Fractions pack; it is now the whole Class 6 book.
  await db.update(curriculumVersions).set({ title: "Class 6 Mathematics" }).where(eq(curriculumVersions.title, "Class 6 Mathematics — Fractions"));
  for (const [title, s] of Object.entries(SUMMARIES)) {
    await db
      .update(chapters)
      .set({ summary: s.summary, keyIdeas: s.keyIdeas })
      .where(and(eq(chapters.title, title), isNull(chapters.summary)));
  }
  return { reports };
}
