import { z } from "zod";
import { GridAnswer } from "./assessments";
import { Id } from "./common";
import { PresentationResponse } from "./lessons";
import { SelfConfidence } from "./evidence";

// --- queued operations ------------------------------------------------------

/**
 * The only things that may be done offline. Each type is designed for it; nothing else is queued
 * (CLAUDE.md §13). Students are identified by roll number, never by name.
 */
export const OPERATION_TYPES = ["record_responses"] as const;
export const OperationType = z.enum(OPERATION_TYPES);
export type OperationType = z.infer<typeof OperationType>;

export const RecordResponsesPayload = z.object({
  assessmentId: Id,
  rosterNumber: z.number().int().min(1).max(500),
  responses: z.array(z.object({ questionId: Id, answer: GridAnswer, confidence: SelfConfidence.optional() })).min(1).max(40),
});
export type RecordResponsesPayload = z.infer<typeof RecordResponsesPayload>;

export const SyncOperation = z.object({
  /** Generated on the device when the work is recorded. Retrying with the same key never creates a second record. */
  idempotencyKey: z.string().min(8).max(100),
  type: OperationType,
  /** The version of the pack the work was recorded against. The server refuses to guess if it has changed. */
  baseVersion: z.string().min(1).max(100),
  /** When the work was recorded on the device. */
  recordedAt: z.string().max(40),
  payload: RecordResponsesPayload,
});
export type SyncOperation = z.infer<typeof SyncOperation>;

export const SyncRequest = z.object({ operations: z.array(SyncOperation).min(1).max(50) });
export type SyncRequest = z.infer<typeof SyncRequest>;

export const SyncResultStatus = z.enum(["applied", "duplicate", "conflict", "rejected"]);
export type SyncResultStatus = z.infer<typeof SyncResultStatus>;

export const SyncResult = z.object({
  idempotencyKey: z.string(),
  status: SyncResultStatus,
  message: z.string().optional(),
  attemptId: Id.optional(),
  conflictId: Id.optional(),
});
export type SyncResult = z.infer<typeof SyncResult>;
export const SyncResponse = z.object({ results: z.array(SyncResult) });
export type SyncResponse = z.infer<typeof SyncResponse>;

export const SyncStatusResponse = z.object({
  applied: z.number().int(),
  conflicts: z.number().int(),
  rejected: z.number().int(),
  lastAppliedAt: z.string().nullable(),
});
export type SyncStatusResponse = z.infer<typeof SyncStatusResponse>;

export const ConflictReason = z.enum(["pack_stale", "already_answered"]);
export type ConflictReason = z.infer<typeof ConflictReason>;

export const ConflictDto = z.object({
  id: Id,
  assessmentId: Id,
  assessmentTitle: z.string(),
  rosterNumber: z.number().int(),
  studentName: z.string().nullable(),
  reason: ConflictReason,
  explanation: z.string(),
  responseCount: z.number().int(),
  recordedAt: z.string(),
  /** Applying is only possible when the server already holds nothing for this student. */
  canApply: z.boolean(),
});
export type ConflictDto = z.infer<typeof ConflictDto>;
export const ConflictListResponse = z.object({ conflicts: z.array(ConflictDto) });
export type ConflictListResponse = z.infer<typeof ConflictListResponse>;

export const ResolveConflictRequest = z.object({ action: z.enum(["apply", "discard"]) });
export type ResolveConflictRequest = z.infer<typeof ResolveConflictRequest>;

// --- packs ------------------------------------------------------------------

export const BuildPackRequest = z.object({ classId: Id, questionCount: z.number().int().min(2).max(5).default(4) });
export type BuildPackRequest = z.infer<typeof BuildPackRequest>;

/**
 * Everything a teacher needs to run one lesson and a short check with no connection. The student-facing
 * parts (explanations, questions) carry no answers. The key is a separate field, used only to print the teacher's key.
 * Students appear as roll numbers only.
 */
export const OfflinePackDto = z.object({
  id: Id,
  /** Hash of the question set the check was built from. Recorded work is tied to it. */
  version: z.string(),
  builtAt: z.string(),
  language: z.string(),
  className: z.string(),
  classId: Id,
  assessmentId: Id,
  conceptId: Id,
  conceptTitle: z.string(),
  presentation: PresentationResponse,
  questions: z.array(z.object({ id: Id, stem: z.string(), options: z.array(z.object({ id: z.string(), text: z.string() })) })),
  /** Teacher's key, for printing. Never shown to students. */
  answerKey: z.array(z.object({ questionId: Id, correctOptionId: z.string(), explanation: z.string().nullable() })),
  rollNumbers: z.array(z.number().int()),
  /** What works offline and what does not, in plain words. */
  offlineNotes: z.array(z.string()),
});
export type OfflinePackDto = z.infer<typeof OfflinePackDto>;

export const PackSummaryDto = z.object({ id: Id, conceptTitle: z.string(), assessmentId: Id, builtAt: z.string(), version: z.string() });
export const PackListResponse = z.object({ packs: z.array(PackSummaryDto) });
export type PackListResponse = z.infer<typeof PackListResponse>;
