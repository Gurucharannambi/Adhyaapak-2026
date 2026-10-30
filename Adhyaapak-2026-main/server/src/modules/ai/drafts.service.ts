import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import type {
  DraftCheck,
  DraftQuestionDto,
  DraftResourceDto,
  DraftsResponse,
  GenerateExplanationRequest,
  GenerateQuestionsRequest,
  GenerateQuestionsResponse,
  UpdateQuestionDraftRequest,
  UpdateResourceDraftRequest,
} from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { chapters, conceptPrerequisites, concepts, curriculumVersions, learningResources, misconceptionPatterns, questions } from "../../db/schema";
import { AppError, conflict, notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";
import { recordAudit } from "../audit/audit.service";
import { normalizeAnswer } from "../learning/assessment/evaluate";
import { validateQuestion } from "../learning/assessment/question-validation";
import type { LlmProvider } from "./provider";
import { runAi } from "./run-ai";
import { EXPLANATION_PROMPT_VERSION, QUESTION_PROMPT_VERSION, explanationPrompt, questionPrompt, type ConceptContext } from "./prompts";
import { verifyFractionArithmetic, type Verification } from "./verify-arithmetic";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
/** Pending question drafts one teacher may hold per concept, so review keeps up with generation and cost stays bounded. */
export const MAX_PENDING_QUESTIONS = 6;

// ---------------------------------------------------------------------------
// What we ask the model for. Deliberately loose (no length or range keywords): the strict
// provider schema mode rejects them, so the real limits are enforced by our own checks below.
// ---------------------------------------------------------------------------
const QuestionOutput = z.object({
  questions: z.array(
    z.object({
      stem: z.string(),
      difficulty: z.number(),
      options: z.array(z.object({ text: z.string(), misconceptionKey: z.string().nullable() })),
      correctIndex: z.number(),
      explanation: z.string(),
    }),
  ),
});
const ExplanationOutput = z.object({
  title: z.string(),
  summary: z.string(),
  steps: z.array(z.string()),
  workedExample: z.object({ problem: z.string(), steps: z.array(z.string()) }).nullable(),
  commonError: z.string().nullable(),
  prompt: z.string().nullable(),
});

// ---------------------------------------------------------------------------
// Context (all from our own database, never from user-uploaded text)
// ---------------------------------------------------------------------------
async function loadContext(db: Db, conceptId: string) {
  if (!isUuid(conceptId)) throw notFound("Concept not found.");
  const [row] = await db
    .select({ concept: concepts, grade: curriculumVersions.grade, board: curriculumVersions.board, language: curriculumVersions.language })
    .from(concepts)
    .innerJoin(curriculumVersions, eq(curriculumVersions.id, concepts.curriculumVersionId))
    .innerJoin(chapters, eq(chapters.id, concepts.chapterId))
    .where(eq(concepts.id, conceptId));
  if (!row) throw notFound("Concept not found.");

  const prereqs = await db
    .select({ id: concepts.id, title: concepts.title })
    .from(conceptPrerequisites)
    .innerJoin(concepts, eq(concepts.id, conceptPrerequisites.prerequisiteConceptId))
    .where(eq(conceptPrerequisites.dependentConceptId, conceptId));
  const patternRows = await db
    .select()
    .from(misconceptionPatterns)
    .where(and(inArray(misconceptionPatterns.conceptId, [conceptId, ...prereqs.map((p) => p.id)]), eq(misconceptionPatterns.reviewStatus, "approved")));
  const allKeys = new Set((await db.select({ key: misconceptionPatterns.key }).from(misconceptionPatterns).where(eq(misconceptionPatterns.reviewStatus, "approved"))).map((r) => r.key));
  const existing = await db.select({ stem: questions.stem }).from(questions).where(and(eq(questions.conceptId, conceptId), ne(questions.reviewStatus, "rejected")));

  const context: ConceptContext = {
    grade: row.grade,
    board: row.board,
    language: row.language,
    title: row.concept.title,
    description: row.concept.description,
    learningObjective: row.concept.learningObjective,
    prerequisiteTitles: prereqs.map((p) => p.title),
    misconceptions: patternRows.map((p) => ({ key: p.key, name: p.name, description: p.description, exampleWrongAnswers: p.exampleWrongAnswers })),
    existingStems: existing.map((e) => e.stem),
  };
  return { concept: row.concept, context, allKeys };
}

// ---------------------------------------------------------------------------
// Deterministic checks
// ---------------------------------------------------------------------------
interface QuestionFields {
  stem: string;
  options: Array<{ id: string; text: string; misconceptionKey: string | null }>;
  correctOptionId: string;
  difficulty: number;
  role: "diagnostic" | "guided" | "challenge";
  explanation: string;
}

/** Models sometimes write the word null (or none, n/a) where JSON null was asked for. Treat those as no tag. */
export const cleanKey = (k: string | null): string | null => {
  const t = k?.trim() ?? "";
  return /^(|null|none|n\/a|na|undefined|-)$/i.test(t) ? null : t;
};

const hasMarkup = (s: string) => /[<>]/.test(s) || /^\s*#{1,6}\s|\*\*|```/.test(s);

/** Everything we can check without a human. `failed` blocks approval. */
export function checkQuestion(f: QuestionFields, knownKeys: ReadonlySet<string>, otherStems: ReadonlySet<string>): DraftCheck {
  const issues: string[] = [];
  if (hasMarkup(f.stem) || f.options.some((o) => hasMarkup(o.text)) || hasMarkup(f.explanation)) issues.push("Contains HTML or markdown, which is not allowed.");
  for (const o of f.options) {
    if (o.misconceptionKey && !knownKeys.has(o.misconceptionKey)) issues.push(`"${o.misconceptionKey}" is not a known error pattern.`);
  }
  if (otherStems.has(normalizeAnswer(f.stem))) issues.push("This repeats an existing question.");
  for (const i of validateQuestion({ id: "draft", key: "draft", conceptId: "draft", role: f.role, difficulty: f.difficulty, stem: f.stem, options: f.options.map((o) => ({ id: o.id, text: o.text, ...(o.misconceptionKey ? { misconceptionKey: o.misconceptionKey } : {}) })), correctOptionId: f.correctOptionId, reviewStatus: "draft" })) {
    issues.push(i.message);
  }
  if (issues.length) return { status: "failed", issues };

  const v: Verification = verifyFractionArithmetic({ stem: f.stem, options: f.options, correctIndex: f.options.findIndex((o) => o.id === f.correctOptionId) });
  return { status: v.status, issues: v.issues };
}

const roleFor = (difficulty: number): QuestionFields["role"] => (difficulty <= 2 ? "diagnostic" : difficulty === 3 ? "guided" : "challenge");

export function checkResource(level: "foundation" | "guided" | "challenge", c: UpdateResourceDraftRequest["content"], title: string): DraftCheck {
  const issues: string[] = [];
  const texts = [title, c.summary, ...c.steps, c.workedExample?.problem ?? "", ...(c.workedExample?.steps ?? []), c.commonError ?? "", c.prompt ?? ""];
  if (texts.some(hasMarkup)) issues.push("Contains HTML or markdown, which is not allowed.");
  if (!title.trim()) issues.push("Needs a title.");
  if (!c.summary.trim()) issues.push("Needs a summary.");
  if (c.steps.length > 8 || c.steps.some((s) => !s.trim() || s.length > 240)) issues.push("Steps must be short, non-empty sentences (at most 8).");
  if (level === "foundation" && c.steps.length < 2) issues.push("A foundation explanation needs at least two small steps.");
  if (level === "guided" && !c.workedExample) issues.push("A guided explanation needs a worked example.");
  if (level === "challenge" && !c.prompt) issues.push("A challenge explanation needs a task for students.");
  // Worked examples of the form "Find a/b + c/d." have their final line checked when it is a plain equation.
  return issues.length ? { status: "failed", issues } : { status: "not_applicable", issues: [] };
}

const ownsDraft = (actor: Actor, createdBy: string | null) => actor.role === "admin" || createdBy === actor.id;

// ---------------------------------------------------------------------------
// Question drafts
// ---------------------------------------------------------------------------
function toQuestionDto(row: typeof questions.$inferSelect, knownKeys: ReadonlySet<string>, otherStems: ReadonlySet<string>): DraftQuestionDto {
  const fields: QuestionFields = {
    stem: row.stem,
    options: row.options.map((o) => ({ id: o.id, text: o.text, misconceptionKey: o.misconceptionKey ?? null })),
    correctOptionId: row.correctOptionId,
    difficulty: row.difficulty,
    role: row.role,
    explanation: row.explanation,
  };
  const check = checkQuestion(fields, knownKeys, otherStems);
  return { id: row.id, key: row.key, role: row.role, difficulty: row.difficulty, stem: row.stem, options: fields.options, correctOptionId: row.correctOptionId, explanation: row.explanation, provenanceNote: row.provenance.note ?? "", createdAt: row.createdAt.toISOString(), check, approvable: check.status !== "failed" };
}

export async function generateQuestionDrafts(db: Db, ai: LlmProvider, actor: Actor, conceptId: string, req: GenerateQuestionsRequest, requestId?: string): Promise<GenerateQuestionsResponse> {
  const { concept, context, allKeys } = await loadContext(db, conceptId);

  const mine = await db.select({ id: questions.id }).from(questions).where(and(eq(questions.conceptId, conceptId), eq(questions.reviewStatus, "draft"), eq(questions.createdBy, actor.id)));
  if (mine.length + req.count > MAX_PENDING_QUESTIONS) {
    throw conflict(`You already have ${mine.length} question draft${mine.length === 1 ? "" : "s"} waiting on this concept. Approve or reject some first.`);
  }

  const { system, user } = questionPrompt(context, req.count, req.difficulty);
  const out = await runAi(db, ai, actor, concept.id, { workflow: "question-draft", promptVersion: QUESTION_PROMPT_VERSION, system, user, schema: QuestionOutput, schemaName: "question_drafts" });

  const stems = new Set(context.existingStems.map(normalizeAnswer));
  const saved: DraftQuestionDto[] = [];
  const discarded: GenerateQuestionsResponse["discarded"] = [];

  for (const q of out.questions.slice(0, req.count)) {
    const label = q.stem.slice(0, 60);
    if (q.options.length !== 4) {
      discarded.push({ reason: `"${label}": needs exactly 4 options.` });
      continue;
    }
    if (!Number.isInteger(q.correctIndex) || q.correctIndex < 0 || q.correctIndex > 3) {
      discarded.push({ reason: `"${label}": the correct answer position was invalid.` });
      continue;
    }
    if (!Number.isInteger(q.difficulty) || q.difficulty < 1 || q.difficulty > 5) {
      discarded.push({ reason: `"${label}": difficulty was not between 1 and 5.` });
      continue;
    }
    if (q.stem.length > 300 || q.options.some((o) => o.text.length > 80) || q.explanation.length > 400) {
      discarded.push({ reason: `"${label}": too long.` });
      continue;
    }
    const fields: QuestionFields = {
      stem: q.stem.trim(),
      options: q.options.map((o, i) => ({ id: "abcd"[i]!, text: o.text.trim(), misconceptionKey: cleanKey(o.misconceptionKey) })),
      correctOptionId: "abcd"[q.correctIndex]!,
      difficulty: q.difficulty,
      role: roleFor(q.difficulty),
      explanation: q.explanation.trim(),
    };
    const check = checkQuestion(fields, allKeys, stems);
    if (check.status === "failed") {
      discarded.push({ reason: `"${label}": ${check.issues.join(" ")}` });
      continue;
    }
    const othersAtSaveTime = new Set(stems);
    stems.add(normalizeAnswer(fields.stem)); // later drafts in this batch must not repeat this one either

    const [row] = await db
      .insert(questions)
      .values({
        key: `ai-${concept.key}-${randomUUID().slice(0, 8)}`,
        conceptId: concept.id,
        role: fields.role,
        difficulty: fields.difficulty,
        stem: fields.stem,
        options: fields.options.map((o) => ({ id: o.id, text: o.text, ...(o.misconceptionKey ? { misconceptionKey: o.misconceptionKey } : {}) })),
        correctOptionId: fields.correctOptionId,
        explanation: fields.explanation,
        language: context.language,
        provenance: { source: "ai_draft", note: `Drafted by ${ai.model} (${QUESTION_PROMPT_VERSION}). Automatic check: ${check.status === "verified" ? "arithmetic verified" : "not automatically checkable, check by hand"}.` },
        reviewStatus: "draft",
        createdBy: actor.id,
      })
      .returning();
    saved.push(toQuestionDto(row!, allKeys, othersAtSaveTime));
  }

  await recordAudit(db, { actorId: actor.id, action: "ai.question_draft", entityType: "concept", entityId: concept.id, metadata: { saved: saved.length, discarded: discarded.length, model: ai.model, promptVersion: QUESTION_PROMPT_VERSION }, requestId });
  return { drafts: saved, discarded };
}

// ---------------------------------------------------------------------------
// Explanation drafts
// ---------------------------------------------------------------------------
const strip = (s: string | null) => (s && s.trim() ? s.trim() : null);

function toResourceDto(row: typeof learningResources.$inferSelect): DraftResourceDto {
  const c = row.content as Record<string, unknown>;
  const we = c.workedExample as { problem?: string; steps?: string[] } | undefined;
  const content: DraftResourceDto["content"] = {
    summary: String(c.summary ?? ""),
    steps: Array.isArray(c.steps) ? (c.steps as string[]) : [],
    workedExample: we?.problem ? { problem: we.problem, steps: we.steps ?? [] } : null,
    commonError: typeof c.commonError === "string" ? c.commonError : null,
    prompt: typeof c.prompt === "string" ? c.prompt : null,
  };
  const level = row.level ?? "guided";
  const check = checkResource(level, content, row.title);
  return { id: row.id, key: row.key, level, title: row.title, content, provenanceNote: row.provenance.note ?? "", createdAt: row.createdAt.toISOString(), check, approvable: check.status !== "failed" };
}

export async function generateExplanationDraft(db: Db, ai: LlmProvider, actor: Actor, conceptId: string, req: GenerateExplanationRequest, requestId?: string): Promise<DraftResourceDto> {
  const { concept, context } = await loadContext(db, conceptId);

  const pending = await db
    .select({ id: learningResources.id })
    .from(learningResources)
    .where(and(eq(learningResources.conceptId, concept.id), eq(learningResources.level, req.level), eq(learningResources.reviewStatus, "draft"), eq(learningResources.createdBy, actor.id)));
  if (pending.length > 0) throw conflict(`You already have a ${req.level} explanation draft for this concept. Approve or reject it first.`);

  const { system, user } = explanationPrompt(context, req.level);
  const out = await runAi(db, ai, actor, concept.id, { workflow: "explanation-draft", promptVersion: EXPLANATION_PROMPT_VERSION, system, user, schema: ExplanationOutput, schemaName: "explanation_draft" });

  const content: DraftResourceDto["content"] = {
    summary: out.summary.trim(),
    steps: out.steps.map((s) => s.trim()).filter(Boolean),
    workedExample: out.workedExample && out.workedExample.problem.trim() ? { problem: out.workedExample.problem.trim(), steps: out.workedExample.steps.map((s) => s.trim()).filter(Boolean) } : null,
    commonError: strip(out.commonError),
    prompt: strip(out.prompt),
  };
  const check = checkResource(req.level, content, out.title.trim());
  if (check.status === "failed") {
    await recordAudit(db, { actorId: actor.id, action: "ai.explanation_draft_discarded", entityType: "concept", entityId: concept.id, metadata: { level: req.level, issues: check.issues.length }, requestId });
    throw new AppError("processing_failed", `The AI's draft did not pass our checks, so nothing was saved: ${check.issues.join(" ")}`);
  }

  const [row] = await db
    .insert(learningResources)
    .values({
      conceptId: concept.id,
      key: `ai-res-${concept.key}-${req.level}-${randomUUID().slice(0, 8)}`,
      type: "explanation",
      level: req.level,
      title: out.title.trim(),
      language: context.language,
      content: { summary: content.summary, steps: content.steps, ...(content.workedExample ? { workedExample: content.workedExample } : {}), ...(content.commonError ? { commonError: content.commonError } : {}), ...(content.prompt ? { prompt: content.prompt } : {}) },
      provenance: { source: "ai_draft", note: `Drafted by ${ai.model} (${EXPLANATION_PROMPT_VERSION}). Not automatically checked for correctness: read it before approving.` },
      reviewStatus: "draft",
      createdBy: actor.id,
    })
    .returning();
  await recordAudit(db, { actorId: actor.id, action: "ai.explanation_draft", entityType: "concept", entityId: concept.id, metadata: { level: req.level, model: ai.model, promptVersion: EXPLANATION_PROMPT_VERSION }, requestId });
  return toResourceDto(row!);
}

// ---------------------------------------------------------------------------
// Listing, editing and reviewing drafts
// ---------------------------------------------------------------------------
export async function listDrafts(db: Db, ai: LlmProvider, actor: Actor, conceptId: string): Promise<DraftsResponse> {
  const { concept, allKeys } = await loadContext(db, conceptId);
  const qRows = await db.select().from(questions).where(and(eq(questions.conceptId, concept.id), eq(questions.reviewStatus, "draft"), actor.role === "admin" ? undefined : eq(questions.createdBy, actor.id))).orderBy(asc(questions.createdAt));
  const rRows = await db.select().from(learningResources).where(and(eq(learningResources.conceptId, concept.id), eq(learningResources.reviewStatus, "draft"), actor.role === "admin" ? undefined : eq(learningResources.createdBy, actor.id))).orderBy(asc(learningResources.createdAt));
  const others = await db.select({ id: questions.id, stem: questions.stem }).from(questions).where(and(eq(questions.conceptId, concept.id), ne(questions.reviewStatus, "rejected")));

  const questionsOut = qRows.map((q) => toQuestionDto(q, allKeys, new Set(others.filter((o) => o.id !== q.id).map((o) => normalizeAnswer(o.stem)))));
  return { aiAvailable: ai.available, questionSlotsLeft: Math.max(0, MAX_PENDING_QUESTIONS - qRows.length), questions: questionsOut, resources: rRows.map(toResourceDto) };
}

async function loadOwnQuestionDraft(db: Db, actor: Actor, id: string) {
  if (!isUuid(id)) throw notFound("Draft not found.");
  const [row] = await db.select().from(questions).where(eq(questions.id, id));
  // Someone else's draft looks the same as a missing one.
  if (!row || !ownsDraft(actor, row.createdBy)) throw notFound("Draft not found.");
  if (row.reviewStatus !== "draft") throw conflict(`This question is already ${row.reviewStatus}.`);
  return row;
}

async function loadOwnResourceDraft(db: Db, actor: Actor, id: string) {
  if (!isUuid(id)) throw notFound("Draft not found.");
  const [row] = await db.select().from(learningResources).where(eq(learningResources.id, id));
  if (!row || !ownsDraft(actor, row.createdBy)) throw notFound("Draft not found.");
  if (row.reviewStatus !== "draft") throw conflict(`This explanation is already ${row.reviewStatus}.`);
  return row;
}

async function stemsExcluding(db: Db, conceptId: string, selfId: string): Promise<Set<string>> {
  const rows = await db.select({ id: questions.id, stem: questions.stem }).from(questions).where(and(eq(questions.conceptId, conceptId), ne(questions.reviewStatus, "rejected")));
  return new Set(rows.filter((r) => r.id !== selfId).map((r) => normalizeAnswer(r.stem)));
}

export async function updateQuestionDraft(db: Db, actor: Actor, id: string, input: UpdateQuestionDraftRequest, requestId?: string): Promise<DraftQuestionDto> {
  const row = await loadOwnQuestionDraft(db, actor, id);
  const ids = input.options.map((o) => o.id);
  if (new Set(ids).size !== ids.length) throw new AppError("validation_error", "Each option needs its own letter.");
  if (!ids.includes(input.correctOptionId)) throw new AppError("validation_error", "The correct answer must be one of the options.");

  const [updated] = await db
    .update(questions)
    .set({
      stem: input.stem,
      options: input.options.map((o) => ({ id: o.id, text: o.text, ...(o.misconceptionKey ? { misconceptionKey: o.misconceptionKey } : {}) })),
      correctOptionId: input.correctOptionId,
      difficulty: input.difficulty,
      role: input.role,
      explanation: input.explanation,
      provenance: { ...row.provenance, note: `${(row.provenance.note ?? "").replace(/ Edited by a teacher\.$/, "")} Edited by a teacher.` },
    })
    .where(and(eq(questions.id, row.id), eq(questions.reviewStatus, "draft")))
    .returning();
  if (!updated) throw conflict("This draft was changed by someone else. Reload and try again.");

  const known = new Set((await db.select({ key: misconceptionPatterns.key }).from(misconceptionPatterns)).map((r) => r.key));
  await recordAudit(db, { actorId: actor.id, action: "draft.question_edit", entityType: "question", entityId: row.id, requestId });
  return toQuestionDto(updated, known, await stemsExcluding(db, row.conceptId, row.id));
}

export async function updateResourceDraft(db: Db, actor: Actor, id: string, input: UpdateResourceDraftRequest, requestId?: string): Promise<DraftResourceDto> {
  const row = await loadOwnResourceDraft(db, actor, id);
  const c = input.content;
  const [updated] = await db
    .update(learningResources)
    .set({
      title: input.title,
      content: { summary: c.summary, steps: c.steps, ...(c.workedExample ? { workedExample: c.workedExample } : {}), ...(c.commonError ? { commonError: c.commonError } : {}), ...(c.prompt ? { prompt: c.prompt } : {}) },
      provenance: { ...row.provenance, note: `${(row.provenance.note ?? "").replace(/ Edited by a teacher\.$/, "")} Edited by a teacher.` },
    })
    .where(and(eq(learningResources.id, row.id), eq(learningResources.reviewStatus, "draft")))
    .returning();
  if (!updated) throw conflict("This draft was changed by someone else. Reload and try again.");
  await recordAudit(db, { actorId: actor.id, action: "draft.resource_edit", entityType: "learning_resource", entityId: row.id, requestId });
  return toResourceDto(updated);
}

/** Approve (only if every automatic check passes) or reject a question draft. Approved questions join the shared bank. */
export async function reviewQuestionDraft(db: Db, actor: Actor, id: string, decision: "approve" | "reject", opts: { checkedByHand?: boolean | undefined } = {}, requestId?: string) {
  const row = await loadOwnQuestionDraft(db, actor, id);
  if (decision === "approve") {
    const known = new Set((await db.select({ key: misconceptionPatterns.key }).from(misconceptionPatterns)).map((r) => r.key));
    const dto = toQuestionDto(row, known, await stemsExcluding(db, row.conceptId, row.id));
    if (!dto.approvable) throw new AppError("validation_error", `This question cannot be approved yet: ${dto.check.issues.join(" ")}`);
    // Anything the code could not verify needs the teacher's own word that they checked it.
    if (dto.check.status === "not_applicable" && !opts.checkedByHand) throw new AppError("validation_error", "We could not check this question automatically. Read the answer and every option, then confirm you checked it yourself.");
  }
  const status = decision === "approve" ? "approved" : "rejected";
  const [updated] = await db.update(questions).set({ reviewStatus: status, reviewedBy: actor.id, reviewedAt: new Date() }).where(and(eq(questions.id, row.id), eq(questions.reviewStatus, "draft"))).returning({ id: questions.id });
  if (!updated) throw conflict("This draft was changed by someone else. Reload and try again.");
  await recordAudit(db, { actorId: actor.id, action: `draft.question_${decision}`, entityType: "question", entityId: row.id, requestId });
  return { id: row.id, status };
}

export async function reviewResourceDraft(db: Db, actor: Actor, id: string, decision: "approve" | "reject", opts: { checkedByHand?: boolean | undefined } = {}, requestId?: string) {
  const row = await loadOwnResourceDraft(db, actor, id);
  if (decision === "approve") {
    const dto = toResourceDto(row);
    if (!dto.approvable) throw new AppError("validation_error", `This explanation cannot be approved yet: ${dto.check.issues.join(" ")}`);
    if (dto.check.status === "not_applicable" && !opts.checkedByHand) throw new AppError("validation_error", "Explanations are not checked automatically. Read it through, then confirm you checked it yourself.");
  }
  const status = decision === "approve" ? "approved" : "rejected";
  const [updated] = await db.update(learningResources).set({ reviewStatus: status, reviewedBy: actor.id, reviewedAt: new Date() }).where(and(eq(learningResources.id, row.id), eq(learningResources.reviewStatus, "draft"))).returning({ id: learningResources.id });
  if (!updated) throw conflict("This draft was changed by someone else. Reload and try again.");
  await recordAudit(db, { actorId: actor.id, action: `draft.resource_${decision}`, entityType: "learning_resource", entityId: row.id, requestId });
  return { id: row.id, status };
}
