import { z } from "zod";
import { validateGraph } from "../../learning/graph/graph";
import { validateQuestion } from "../../learning/assessment/question-validation";
import { verifyFractionArithmetic } from "../../ai/verify-arithmetic";
import { verifyDecimalArithmetic } from "./verify-decimals";

/**
 * A content package: a chapter (or a set of translations) described as plain data. Adding a chapter is writing a
 * package and importing it; no code changes. Every package is checked before anything is written.
 */
const Level = z.enum(["foundation", "guided", "challenge"]);
const Key = z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/, "Use lower-case letters, digits and hyphens");

const Resource = z.object({ level: Level, title: z.string().min(1).max(120), content: z.record(z.string(), z.unknown()) });
const Concept = z.object({
  key: Key,
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  learningObjective: z.string().min(1).max(300),
  /** Keys of prerequisite concepts: in this package, or already in the same curriculum (for example from an earlier chapter). */
  prerequisites: z.array(Key).max(10),
  teacherNote: z.string().min(1).max(1000),
  resources: z.array(Resource).max(3),
});
const Question = z.object({
  key: Key,
  concept: Key,
  role: z.enum(["diagnostic", "guided", "challenge"]),
  difficulty: z.number().int().min(1).max(5),
  stem: z.string().min(1).max(500),
  options: z.array(z.object({ id: z.string().min(1).max(10), text: z.string().min(1).max(200), misconceptionKey: Key.optional() })).min(2).max(6),
  correct: z.string().min(1).max(10),
  explanation: z.string().min(1).max(600),
  alsoAssesses: z.array(Key).max(5).optional(),
});
const Misconception = z.object({
  key: Key,
  category: z.enum(["conceptual", "procedural", "arithmetic", "reading"]),
  concept: Key,
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  exampleWrongAnswers: z.array(z.string().min(1).max(200)).min(1).max(6),
  recommendedExplanation: z.string().min(1).max(800),
  followUpQuestion: Key,
});
const Translation = z.object({
  concept: Key,
  level: Level,
  language: z.string().min(2).max(16),
  title: z.string().min(1).max(160),
  content: z.record(z.string(), z.unknown()),
  note: z.string().max(300).optional(),
});

export const ContentPackage = z.object({
  formatVersion: z.literal(1),
  curriculum: z.object({
    subject: z.string().min(1).max(60),
    title: z.string().min(1).max(160),
    board: z.string().min(1).max(40),
    academicYear: z.string().regex(/^\d{4}-\d{2}$/),
    grade: z.number().int().min(6).max(10),
    language: z.string().min(2).max(16),
    version: z.number().int().min(1),
    sourceReference: z.string().min(1).max(400),
  }),
  chapter: z.object({
    title: z.string().min(1).max(120),
    /** Our own summary of the chapter and the key ideas to land (original text). */
    summary: z.string().min(1).max(1200).optional(),
    keyIdeas: z.array(z.string().min(1).max(200)).max(8).optional(),
  }),
  provenance: z.object({ source: z.enum(["original", "teacher_upload", "ai_draft", "licensed", "official_reference"]), note: z.string().max(400).optional() }),
  concepts: z.array(Concept).max(40).default([]),
  questions: z.array(Question).max(300).default([]),
  misconceptions: z.array(Misconception).max(100).default([]),
  translations: z.array(Translation).max(200).default([]),
});
export type ContentPackage = z.infer<typeof ContentPackage>;

export interface PackageIssue {
  path: string;
  message: string;
  /** "error" blocks the import; "warning" is shown but allowed. */
  severity: "error" | "warning";
}

export interface ExistingKeys {
  conceptKeys: ReadonlySet<string>;
  questionKeys: ReadonlySet<string>;
  misconceptionKeys: ReadonlySet<string>;
}

/**
 * Everything that can be checked without writing: references, duplicates, loops, question validity, and, where we
 * can, the arithmetic of fraction and decimal questions. Returns plain-language issues with a path.
 */
export function checkPackage(pkg: ContentPackage, existing: ExistingKeys): PackageIssue[] {
  const issues: PackageIssue[] = [];
  const err = (path: string, message: string) => issues.push({ path, message, severity: "error" });
  const warn = (path: string, message: string) => issues.push({ path, message, severity: "warning" });

  if (pkg.concepts.length === 0 && pkg.translations.length === 0) err("concepts", "A package needs concepts or translations.");

  const dupes = (items: string[], label: string, path: string) => {
    const seen = new Set<string>();
    for (const k of items) {
      if (seen.has(k)) err(path, `The ${label} key "${k}" appears twice.`);
      seen.add(k);
    }
  };
  dupes(pkg.concepts.map((c) => c.key), "concept", "concepts");
  dupes(pkg.questions.map((q) => q.key), "question", "questions");
  dupes(pkg.misconceptions.map((m) => m.key), "misconception", "misconceptions");

  const newConcepts = new Set(pkg.concepts.map((c) => c.key));
  const allConcepts = new Set([...existing.conceptKeys, ...newConcepts]);
  const newQuestions = new Set(pkg.questions.map((q) => q.key));
  const allQuestions = new Set([...existing.questionKeys, ...newQuestions]);
  const allMisconceptions = new Set([...existing.misconceptionKeys, ...pkg.misconceptions.map((m) => m.key)]);

  pkg.concepts.forEach((c, i) => {
    const p = `concepts[${i}] (${c.key})`;
    for (const pre of c.prerequisites) if (!allConcepts.has(pre)) err(p, `Prerequisite "${pre}" is not a known concept.`);
    if (c.prerequisites.includes(c.key)) err(p, "A concept cannot be its own prerequisite.");
    const levels = new Set(c.resources.map((r) => r.level));
    for (const l of ["foundation", "guided", "challenge"] as const) if (!levels.has(l)) err(p, `Missing the ${l} explanation. Every concept needs all three levels.`);
    if (levels.size !== c.resources.length) err(p, "Two explanations share the same level.");
    if (existing.conceptKeys.has(c.key)) warn(p, "This concept already exists and will be left unchanged.");
  });

  // Loops, across the new edges and the ones already stored is not possible here; new concepts only point back at existing ones, never the reverse.
  const edges = pkg.concepts.flatMap((c) => c.prerequisites.filter((p) => allConcepts.has(p)).map((p) => ({ prerequisiteId: p, dependentId: c.key })));
  for (const issue of validateGraph([...allConcepts], edges)) if (issue.type === "cycle" || issue.type === "self_edge") err("concepts", `Prerequisites form a loop: ${issue.nodes.join(" → ")}.`);

  pkg.questions.forEach((q, i) => {
    const p = `questions[${i}] (${q.key})`;
    if (!allConcepts.has(q.concept)) err(p, `The concept "${q.concept}" is not known.`);
    for (const a of q.alsoAssesses ?? []) if (!allConcepts.has(a)) err(p, `Also-assesses "${a}" is not a known concept.`);
    for (const o of q.options) if (o.misconceptionKey && !allMisconceptions.has(o.misconceptionKey)) err(p, `Option ${o.id} names the unknown misconception "${o.misconceptionKey}".`);
    for (const issue of validateQuestion({
      id: q.key, key: q.key, conceptId: q.concept, role: q.role, difficulty: q.difficulty, stem: q.stem,
      options: q.options.map((o) => ({ id: o.id, text: o.text, ...(o.misconceptionKey ? { misconceptionKey: o.misconceptionKey } : {}) })),
      correctOptionId: q.correct, reviewStatus: "approved",
    })) err(p, issue.message);

    const correctIndex = q.options.findIndex((o) => o.id === q.correct);
    const like = { stem: q.stem, options: q.options.map((o) => ({ text: o.text, misconceptionKey: o.misconceptionKey ?? null })), correctIndex };
    const f = verifyFractionArithmetic(like);
    const d = f.status === "not_applicable" ? verifyDecimalArithmetic(like) : f;
    if (d.status === "failed") for (const m of d.issues) err(p, `Arithmetic check: ${m}`);
    else if (d.status === "not_applicable") warn(p, "The answer could not be checked automatically. Check it by hand.");
  });

  pkg.misconceptions.forEach((m, i) => {
    const p = `misconceptions[${i}] (${m.key})`;
    if (!allConcepts.has(m.concept)) err(p, `The concept "${m.concept}" is not known.`);
    if (!allQuestions.has(m.followUpQuestion)) err(p, `The follow-up question "${m.followUpQuestion}" does not exist.`);
    const used = pkg.questions.some((q) => q.options.some((o) => o.misconceptionKey === m.key));
    if (!used && !existing.misconceptionKeys.has(m.key)) warn(p, "No question option points at this misconception, so it can never be detected.");
  });

  pkg.translations.forEach((t, i) => {
    const p = `translations[${i}] (${t.concept}/${t.level}/${t.language})`;
    if (!allConcepts.has(t.concept)) err(p, `The concept "${t.concept}" is not known.`);
    if (t.language === pkg.curriculum.language) warn(p, "This is the curriculum's own language, not a translation.");
  });

  return issues;
}
