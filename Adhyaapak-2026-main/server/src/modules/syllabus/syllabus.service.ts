import { createHash } from "node:crypto";
import { and, asc, desc, eq, max, ne } from "drizzle-orm";
import type {
  AddEdgeRequest,
  AddProposalConceptRequest,
  GenerateGraphRequest,
  PasteSyllabusRequest,
  ProposalDto,
  PublishResponse,
  SyllabusDocumentDto,
  UpdateProposalConceptRequest,
  UploadResponse,
} from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import {
  chapters,
  conceptPrerequisites,
  concepts,
  curriculumVersions,
  graphProposals,
  proposalConcepts,
  proposalEdges,
  subjects,
  syllabusDocuments,
} from "../../db/schema";
import { AppError, conflict, notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";
import { recordAudit } from "../audit/audit.service";
import type { LlmProvider } from "../ai/provider";
import { runAi } from "../ai/run-ai";
import type { StorageProvider } from "../files/storage";
import { ConceptGraph, validateGraph } from "../learning/graph/graph";
import { isUniqueViolation } from "../learning/persistence/db-types";
import { SyllabusGraphOutput, buildProposal, slugify } from "./build-proposal";
import { extractDocumentText, extractPastedText, type ExtractedDocument } from "./extract-text";
import { looksLikeInstructions } from "./grounding";
import { SYLLABUS_PROMPT_VERSION, syllabusPrompt } from "./syllabus-prompt";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const sha256 = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
const plain = (s: string, max: number) => s.replace(/<[^>]*>/g, " ").replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, max);
/** Unfinished graphs one teacher may hold per document, so abandoned drafts do not pile up. */
const MAX_DRAFTS_PER_DOCUMENT = 3;

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
type DocRow = typeof syllabusDocuments.$inferSelect;

async function toDocumentDto(db: Db, row: DocRow): Promise<SyllabusDocumentDto> {
  const props = await db.select({ id: graphProposals.id, title: graphProposals.title, status: graphProposals.status }).from(graphProposals).where(and(eq(graphProposals.documentId, row.id), ne(graphProposals.status, "discarded"))).orderBy(desc(graphProposals.createdAt));
  return {
    id: row.id,
    title: row.title,
    originalFilename: row.originalFilename,
    fileType: row.fileType as "pdf" | "text",
    pageCount: row.pageCount,
    characters: row.extractedText.length,
    suspicious: row.suspicious,
    createdAt: row.createdAt.toISOString(),
    proposals: props,
  };
}

async function saveDocument(db: Db, actor: Actor, input: { title: string; filename: string; hash: string; storageKey: string | null; extracted: ExtractedDocument }, storage?: StorageProvider, requestId?: string): Promise<UploadResponse> {
  const [existing] = await db.select().from(syllabusDocuments).where(and(eq(syllabusDocuments.uploadedBy, actor.id), eq(syllabusDocuments.contentHash, input.hash)));
  if (existing) {
    // Same content again: keep the first copy (no duplicate file on disk).
    if (input.storageKey && storage) await storage.delete(input.storageKey).catch(() => undefined);
    return { document: await toDocumentDto(db, existing), alreadyUploaded: true };
  }
  try {
    const [row] = await db
      .insert(syllabusDocuments)
      .values({
        uploadedBy: actor.id,
        title: input.title,
        originalFilename: input.filename,
        fileType: input.extracted.fileType,
        contentHash: input.hash,
        storageKey: input.storageKey,
        extractedText: input.extracted.text,
        pageCount: input.extracted.pageCount,
        suspicious: looksLikeInstructions(input.extracted.text),
      })
      .returning();
    await recordAudit(db, { actorId: actor.id, action: "syllabus.upload", entityType: "syllabus_document", entityId: row!.id, metadata: { type: input.extracted.fileType, characters: input.extracted.text.length, suspicious: row!.suspicious }, requestId });
    return { document: await toDocumentDto(db, row!), alreadyUploaded: false };
  } catch (err) {
    if (input.storageKey && storage) await storage.delete(input.storageKey).catch(() => undefined);
    if (isUniqueViolation(err)) {
      const [again] = await db.select().from(syllabusDocuments).where(and(eq(syllabusDocuments.uploadedBy, actor.id), eq(syllabusDocuments.contentHash, input.hash)));
      if (again) return { document: await toDocumentDto(db, again), alreadyUploaded: true };
    }
    throw err;
  }
}

/** Validates and extracts first; only a file that passes is written to private storage. */
export async function addDocumentFromFile(db: Db, storage: StorageProvider, actor: Actor, file: { originalname: string; buffer: Buffer }, requestId?: string): Promise<UploadResponse> {
  const filename = plain(file.originalname, 120) || "syllabus";
  const extracted = await extractDocumentText(filename, file.buffer);
  const storageKey = await storage.put(file.buffer);
  return saveDocument(db, actor, { title: filename.replace(/\.[a-z0-9]{1,5}$/i, ""), filename, hash: sha256(file.buffer), storageKey, extracted }, storage, requestId);
}

export async function addDocumentFromText(db: Db, actor: Actor, input: PasteSyllabusRequest, requestId?: string): Promise<UploadResponse> {
  const extracted = extractPastedText(input.text);
  return saveDocument(db, actor, { title: plain(input.title, 120), filename: "pasted text", hash: sha256(extracted.text), storageKey: null, extracted }, undefined, requestId);
}

export async function listDocuments(db: Db, actor: Actor): Promise<SyllabusDocumentDto[]> {
  const rows = await db.select().from(syllabusDocuments).where(eq(syllabusDocuments.uploadedBy, actor.id)).orderBy(desc(syllabusDocuments.createdAt));
  return Promise.all(rows.map((r) => toDocumentDto(db, r)));
}

async function loadOwnDocument(db: Db, actor: Actor, id: string): Promise<DocRow> {
  if (!isUuid(id)) throw notFound("Document not found.");
  const [row] = await db.select().from(syllabusDocuments).where(eq(syllabusDocuments.id, id));
  if (!row || (actor.role !== "admin" && row.uploadedBy !== actor.id)) throw notFound("Document not found.");
  return row;
}

/** Deletes the file and its extracted text. Refused once a published curriculum came from it. */
export async function deleteDocument(db: Db, storage: StorageProvider, actor: Actor, id: string, requestId?: string): Promise<void> {
  const doc = await loadOwnDocument(db, actor, id);
  const published = await db.select({ id: graphProposals.id }).from(graphProposals).where(and(eq(graphProposals.documentId, doc.id), eq(graphProposals.status, "published")));
  if (published.length) throw conflict("A published curriculum was built from this document, so it cannot be deleted.");
  await db.delete(graphProposals).where(eq(graphProposals.documentId, doc.id));
  await db.delete(syllabusDocuments).where(eq(syllabusDocuments.id, doc.id));
  if (doc.storageKey) await storage.delete(doc.storageKey).catch(() => undefined);
  await recordAudit(db, { actorId: actor.id, action: "syllabus.delete", entityType: "syllabus_document", entityId: doc.id, requestId });
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------
type ProposalRow = typeof graphProposals.$inferSelect;

async function loadOwnProposal(db: Db, actor: Actor, id: string): Promise<ProposalRow> {
  if (!isUuid(id)) throw notFound("Graph not found.");
  const [row] = await db.select().from(graphProposals).where(eq(graphProposals.id, id));
  if (!row || (actor.role !== "admin" && row.createdBy !== actor.id)) throw notFound("Graph not found.");
  return row;
}

async function loadDraft(db: Db, actor: Actor, id: string): Promise<ProposalRow> {
  const row = await loadOwnProposal(db, actor, id);
  if (row.status !== "draft") throw conflict(`This graph is already ${row.status}.`);
  return row;
}

async function toProposalDto(db: Db, row: ProposalRow): Promise<ProposalDto> {
  const cs = await db.select().from(proposalConcepts).where(eq(proposalConcepts.proposalId, row.id)).orderBy(asc(proposalConcepts.position));
  const position = new Map(cs.map((c) => [c.id, c.position]));
  // Stable order (by the concepts' positions) so the screen does not shuffle between loads.
  const es = (await db.select().from(proposalEdges).where(eq(proposalEdges.proposalId, row.id))).sort(
    (a, b) => (position.get(a.prerequisiteConceptId) ?? 0) - (position.get(b.prerequisiteConceptId) ?? 0) || (position.get(a.dependentConceptId) ?? 0) - (position.get(b.dependentConceptId) ?? 0),
  );
  const [doc] = await db.select({ suspicious: syllabusDocuments.suspicious }).from(syllabusDocuments).where(eq(syllabusDocuments.id, row.documentId));

  const blockers: string[] = [];
  if (row.status !== "draft") blockers.push(`This graph is already ${row.status}.`);
  if (cs.length === 0) blockers.push("There are no concepts.");
  const pending = es.filter((e) => e.decision === "pending").length;
  if (pending) blockers.push(`${pending} prerequisite${pending === 1 ? " still needs" : "s still need"} your decision.`);
  const title = new Map(cs.map((c) => [c.id, c.title]));
  const loop = validateGraph(cs.map((c) => c.id), es.filter((e) => e.decision !== "rejected").map((e) => ({ prerequisiteId: e.prerequisiteConceptId, dependentId: e.dependentConceptId }))).find((i) => i.type === "cycle");
  if (loop) blockers.push(`Prerequisites form a loop: ${loop.nodes.map((n) => title.get(n)).join(" → ")}.`);

  return {
    id: row.id,
    documentId: row.documentId,
    status: row.status,
    title: row.title,
    board: row.board,
    academicYear: row.academicYear,
    grade: row.grade as ProposalDto["grade"],
    subject: row.subjectName,
    model: row.model,
    promptVersion: row.promptVersion,
    notes: row.notes,
    suspiciousDocument: doc?.suspicious ?? false,
    concepts: cs.map((c) => ({ id: c.id, key: c.key, title: c.title, description: c.description, learningObjective: c.learningObjective, evidenceQuote: c.evidenceQuote, grounded: c.grounded, addedByTeacher: c.addedByTeacher, position: c.position })),
    edges: es.map((e) => ({ id: e.id, prerequisiteConceptId: e.prerequisiteConceptId, dependentConceptId: e.dependentConceptId, evidenceQuote: e.evidenceQuote, grounding: e.grounding, confidence: e.confidence, decision: e.decision })),
    blockers,
    canPublish: blockers.length === 0,
    publishedCurriculumVersionId: row.publishedVersionId,
  };
}

export async function getProposal(db: Db, actor: Actor, id: string): Promise<ProposalDto> {
  return toProposalDto(db, await loadOwnProposal(db, actor, id));
}

/** Asks the AI for a graph, then cleans and grounds it. Nothing is published; the result is a draft for the teacher. */
export async function generateGraph(db: Db, ai: LlmProvider, actor: Actor, documentId: string, req: GenerateGraphRequest, requestId?: string): Promise<ProposalDto> {
  const doc = await loadOwnDocument(db, actor, documentId);
  const open = await db.select({ id: graphProposals.id }).from(graphProposals).where(and(eq(graphProposals.documentId, doc.id), eq(graphProposals.createdBy, actor.id), eq(graphProposals.status, "draft")));
  if (open.length >= MAX_DRAFTS_PER_DOCUMENT) throw conflict(`You already have ${open.length} unfinished graphs for this document. Publish or discard one first.`);

  const { system, user } = syllabusPrompt({ grade: req.grade, subject: req.subject, board: req.board, documentText: doc.extractedText });
  const output = await runAi(db, ai, actor, null, { workflow: "syllabus-graph", promptVersion: SYLLABUS_PROMPT_VERSION, system, user, schema: SyllabusGraphOutput, schemaName: "concept_graph", timeoutMs: 90_000 });

  const plan = buildProposal(output, doc.extractedText);
  if (plan.concepts.length < 2) {
    throw new AppError("processing_failed", "The AI could not find enough concepts in this document, so nothing was saved. Try a more detailed section of the syllabus.");
  }

  const notes = [...plan.notes];
  if (doc.suspicious) notes.unshift("This document contains wording that looks like instructions to an AI. It was treated as plain text and ignored as instructions, but have a look at it.");

  const proposalId = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(graphProposals)
      .values({ documentId: doc.id, createdBy: actor.id, title: plain(req.title, 120), board: req.board, academicYear: req.academicYear, grade: req.grade, subjectName: req.subject, model: ai.model, promptVersion: SYLLABUS_PROMPT_VERSION, notes })
      .returning({ id: graphProposals.id });
    const inserted = await tx
      .insert(proposalConcepts)
      .values(plan.concepts.map((c) => ({ proposalId: p!.id, key: c.key, title: c.title, description: c.description, learningObjective: c.learningObjective, evidenceQuote: c.evidenceQuote, grounded: c.grounded, position: c.position })))
      .returning({ id: proposalConcepts.id, key: proposalConcepts.key });
    const byKey = new Map(inserted.map((c) => [c.key, c.id]));
    if (plan.edges.length) {
      await tx.insert(proposalEdges).values(plan.edges.map((e) => ({ proposalId: p!.id, prerequisiteConceptId: byKey.get(e.prerequisiteKey)!, dependentConceptId: byKey.get(e.dependentKey)!, evidenceQuote: e.evidenceQuote, grounding: e.grounding, confidence: e.confidence, decision: e.decision })));
    }
    return p!.id;
  });

  await recordAudit(db, { actorId: actor.id, action: "syllabus.generate", entityType: "graph_proposal", entityId: proposalId, metadata: { concepts: plan.concepts.length, edges: plan.edges.length, model: ai.model, promptVersion: SYLLABUS_PROMPT_VERSION }, requestId });
  return getProposal(db, actor, proposalId);
}

// ---------------------------------------------------------------------------
// Teacher edits
// ---------------------------------------------------------------------------
async function loadConcept(db: Db, proposalId: string, conceptId: string) {
  if (!isUuid(conceptId)) throw notFound("Concept not found.");
  const [c] = await db.select().from(proposalConcepts).where(and(eq(proposalConcepts.id, conceptId), eq(proposalConcepts.proposalId, proposalId)));
  if (!c) throw notFound("Concept not found.");
  return c;
}

export async function updateProposalConcept(db: Db, actor: Actor, proposalId: string, conceptId: string, input: UpdateProposalConceptRequest, requestId?: string): Promise<ProposalDto> {
  const p = await loadDraft(db, actor, proposalId);
  const c = await loadConcept(db, p.id, conceptId);
  await db.update(proposalConcepts).set({ title: plain(input.title, 80), description: plain(input.description, 300), learningObjective: plain(input.learningObjective, 200) }).where(eq(proposalConcepts.id, c.id));
  await recordAudit(db, { actorId: actor.id, action: "proposal.edit_concept", entityType: "graph_proposal", entityId: p.id, requestId });
  return getProposal(db, actor, p.id);
}

export async function addProposalConcept(db: Db, actor: Actor, proposalId: string, input: AddProposalConceptRequest, requestId?: string): Promise<ProposalDto> {
  const p = await loadDraft(db, actor, proposalId);
  const existing = await db.select({ key: proposalConcepts.key, position: proposalConcepts.position }).from(proposalConcepts).where(eq(proposalConcepts.proposalId, p.id));
  const title = plain(input.title, 80);
  const base = slugify(title);
  if (!base) throw new AppError("validation_error", "Give the concept a name made of letters or numbers.");
  let key = base;
  for (let n = 2; existing.some((e) => e.key === key); n++) key = `${base}-${n}`.slice(0, 64);
  await db.insert(proposalConcepts).values({ proposalId: p.id, key, title, description: plain(input.description ?? title, 300), learningObjective: plain(input.learningObjective ?? `Understand ${title.toLowerCase()}.`, 200), grounded: false, addedByTeacher: true, position: Math.max(0, ...existing.map((e) => e.position)) + 1 });
  await recordAudit(db, { actorId: actor.id, action: "proposal.add_concept", entityType: "graph_proposal", entityId: p.id, requestId });
  return getProposal(db, actor, p.id);
}

export async function removeProposalConcept(db: Db, actor: Actor, proposalId: string, conceptId: string, requestId?: string): Promise<ProposalDto> {
  const p = await loadDraft(db, actor, proposalId);
  const c = await loadConcept(db, p.id, conceptId);
  await db.delete(proposalConcepts).where(eq(proposalConcepts.id, c.id)); // its prerequisites go with it
  await recordAudit(db, { actorId: actor.id, action: "proposal.remove_concept", entityType: "graph_proposal", entityId: p.id, requestId });
  return getProposal(db, actor, p.id);
}

/** Throws if keeping these edges would make a loop; the message names the loop in plain words. */
async function assertNoLoop(db: Db, proposalId: string, edges: Array<{ prerequisiteConceptId: string; dependentConceptId: string }>) {
  const cs = await db.select({ id: proposalConcepts.id, title: proposalConcepts.title }).from(proposalConcepts).where(eq(proposalConcepts.proposalId, proposalId));
  const title = new Map(cs.map((c) => [c.id, c.title]));
  const loop = validateGraph(cs.map((c) => c.id), edges.map((e) => ({ prerequisiteId: e.prerequisiteConceptId, dependentId: e.dependentConceptId }))).find((i) => i.type === "cycle");
  if (loop) throw new AppError("validation_error", `That would make a loop: ${loop.nodes.map((n) => title.get(n)).join(" → ")}.`);
}

export async function decideEdge(db: Db, actor: Actor, proposalId: string, edgeId: string, decision: "accepted" | "rejected", requestId?: string): Promise<ProposalDto> {
  const p = await loadDraft(db, actor, proposalId);
  if (!isUuid(edgeId)) throw notFound("Prerequisite not found.");
  const all = await db.select().from(proposalEdges).where(eq(proposalEdges.proposalId, p.id));
  const edge = all.find((e) => e.id === edgeId);
  if (!edge) throw notFound("Prerequisite not found.");
  if (decision === "accepted") {
    // Accepting one that was rejected earlier must not close a loop with the others.
    await assertNoLoop(db, p.id, all.filter((e) => e.decision !== "rejected" || e.id === edge.id));
  }
  await db.update(proposalEdges).set({ decision }).where(eq(proposalEdges.id, edge.id));
  await recordAudit(db, { actorId: actor.id, action: `proposal.edge_${decision}`, entityType: "graph_proposal", entityId: p.id, requestId });
  return getProposal(db, actor, p.id);
}

export async function addProposalEdge(db: Db, actor: Actor, proposalId: string, input: AddEdgeRequest, requestId?: string): Promise<ProposalDto> {
  const p = await loadDraft(db, actor, proposalId);
  if (input.prerequisiteConceptId === input.dependentConceptId) throw new AppError("validation_error", "A concept cannot be its own prerequisite.");
  await loadConcept(db, p.id, input.prerequisiteConceptId);
  await loadConcept(db, p.id, input.dependentConceptId);
  const all = await db.select().from(proposalEdges).where(eq(proposalEdges.proposalId, p.id));
  if (all.some((e) => e.prerequisiteConceptId === input.prerequisiteConceptId && e.dependentConceptId === input.dependentConceptId)) throw conflict("That prerequisite is already in the graph.");
  await assertNoLoop(db, p.id, [...all.filter((e) => e.decision !== "rejected"), input]);
  await db.insert(proposalEdges).values({ proposalId: p.id, prerequisiteConceptId: input.prerequisiteConceptId, dependentConceptId: input.dependentConceptId, evidenceQuote: null, grounding: "teacher", confidence: "high", decision: "accepted" });
  await recordAudit(db, { actorId: actor.id, action: "proposal.add_edge", entityType: "graph_proposal", entityId: p.id, requestId });
  return getProposal(db, actor, p.id);
}

export async function discardProposal(db: Db, actor: Actor, proposalId: string, requestId?: string): Promise<void> {
  const p = await loadDraft(db, actor, proposalId);
  await db.update(graphProposals).set({ status: "discarded" }).where(eq(graphProposals.id, p.id));
  await recordAudit(db, { actorId: actor.id, action: "syllabus.discard", entityType: "graph_proposal", entityId: p.id, requestId });
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------
/**
 * Turns a reviewed draft into a NEW curriculum version. It never overwrites an existing version: a
 * second graph for the same board, year, grade and subject becomes version 2, 3 and so on, so evidence
 * recorded against earlier versions stays valid (CLAUDE.md §3).
 */
export async function publishProposal(db: Db, actor: Actor, proposalId: string, requestId?: string): Promise<PublishResponse> {
  const p = await loadDraft(db, actor, proposalId);
  const dto = await toProposalDto(db, p);
  if (!dto.canPublish) throw new AppError("validation_error", `This graph cannot be published yet: ${dto.blockers.join(" ")}`);
  const [doc] = await db.select().from(syllabusDocuments).where(eq(syllabusDocuments.id, p.documentId));

  const accepted = dto.edges.filter((e) => e.decision === "accepted");
  // Defence in depth: the real graph class refuses anything invalid (loops, duplicates, unknown ids).
  try {
    new ConceptGraph(dto.concepts.map((c) => c.id), accepted.map((e) => ({ prerequisiteId: e.prerequisiteConceptId, dependentId: e.dependentConceptId })));
  } catch {
    throw conflict("The graph is not valid, so it was not published.");
  }

  const sourceReference = `${doc?.originalFilename ?? "syllabus"} (sha256 ${doc?.contentHash.slice(0, 12) ?? "unknown"})`;
  const provenance = { source: "teacher_upload" as const, reference: sourceReference, note: `Proposed by ${p.model} (${p.promptVersion}) from an uploaded syllabus, then reviewed and approved by the teacher.` };

  const result = await db.transaction(async (tx) => {
    await tx.insert(subjects).values({ name: p.subjectName }).onConflictDoNothing();
    const [subject] = await tx.select().from(subjects).where(eq(subjects.name, p.subjectName));
    const [latest] = await tx
      .select({ v: max(curriculumVersions.version) })
      .from(curriculumVersions)
      .where(and(eq(curriculumVersions.board, p.board), eq(curriculumVersions.academicYear, p.academicYear), eq(curriculumVersions.grade, p.grade), eq(curriculumVersions.subjectId, subject!.id), eq(curriculumVersions.language, p.language)));
    const version = (latest?.v ?? 0) + 1;

    const [cv] = await tx
      .insert(curriculumVersions)
      .values({ title: p.title, board: p.board, academicYear: p.academicYear, grade: p.grade, subjectId: subject!.id, language: p.language, version, sourceReference, reviewStatus: "approved" })
      .returning();
    const [chapter] = await tx.insert(chapters).values({ curriculumVersionId: cv!.id, title: p.title, chapterOrder: 1 }).returning();

    const ordered = [...dto.concepts].sort((a, b) => a.position - b.position);
    const inserted = await tx
      .insert(concepts)
      .values(ordered.map((c, i) => ({ curriculumVersionId: cv!.id, chapterId: chapter!.id, key: c.key, title: c.title, description: c.description, learningObjective: c.learningObjective, conceptOrder: i + 1, language: p.language, reviewStatus: "approved" as const, provenance })))
      .returning({ id: concepts.id, key: concepts.key });
    const newId = new Map(inserted.map((c) => [c.key, c.id]));
    const keyOf = new Map(dto.concepts.map((c) => [c.id, c.key]));
    if (accepted.length) {
      await tx.insert(conceptPrerequisites).values(
        accepted.map((e) => ({
          prerequisiteConceptId: newId.get(keyOf.get(e.prerequisiteConceptId)!)!,
          dependentConceptId: newId.get(keyOf.get(e.dependentConceptId)!)!,
          sourceReference: e.evidenceQuote ? `From the document: "${e.evidenceQuote}"` : e.grounding === "teacher" ? "Added by the teacher" : "Not stated in the document; accepted by the teacher",
          reviewStatus: "approved" as const,
        })),
      );
    }
    await tx.update(graphProposals).set({ status: "published", publishedVersionId: cv!.id, publishedAt: new Date() }).where(eq(graphProposals.id, p.id));
    return { curriculumVersionId: cv!.id, version, conceptCount: ordered.length, edgeCount: accepted.length };
  });

  await recordAudit(db, { actorId: actor.id, action: "syllabus.publish", entityType: "curriculum_version", entityId: result.curriculumVersionId, metadata: { proposalId: p.id, version: result.version, concepts: result.conceptCount, edges: result.edgeCount }, requestId });
  return result;
}

