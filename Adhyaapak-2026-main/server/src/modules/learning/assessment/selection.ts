import type { ConceptGraph } from "../graph/graph";
import { DEFAULT_LEARNING_CONFIG, type LearningConfig } from "../config";
import { validateQuestion } from "./question-validation";
import type { BankQuestion } from "./types";

export interface SelectionOptions {
  /** Which question roles may be used. Defaults to diagnostic only; follow-ups also allow guided practice items. */
  roles?: ReadonlyArray<BankQuestion["role"]>;
  /** How many questions to pick (clamped to the configured 2..5). */
  count: number;
  /** Question keys to leave out (already asked). */
  excludeKeys?: ReadonlySet<string>;
  /** At most this many questions per concept, so a short quiz spreads across concepts. */
  maxPerConcept?: number;
  /** Highest difficulty to include. */
  maxDifficulty?: number;
  config?: LearningConfig["selection"];
}

/**
 * Picks a short diagnostic (CLAUDE.md Feature 6) from the teacher-approved bank. Deterministic:
 * concepts are visited round-robin in the order given, and within a concept the easiest unused
 * question that can reveal a misconception comes first. Never uses an unapproved or invalid question.
 * May return fewer than `count` questions when the bank is small; callers must handle that.
 */
export function selectDiagnosticQuestions(conceptIds: readonly string[], bank: readonly BankQuestion[], opts: SelectionOptions): BankQuestion[] {
  const cfg = opts.config ?? DEFAULT_LEARNING_CONFIG.selection;
  const count = Math.min(cfg.maxQuestions, Math.max(cfg.minQuestions, opts.count));
  const maxPer = opts.maxPerConcept ?? count;

  const usable = bank.filter(
    (q) =>
      q.reviewStatus === "approved" &&
      (opts.roles ?? ["diagnostic"]).includes(q.role) &&
      !opts.excludeKeys?.has(q.key) &&
      (opts.maxDifficulty === undefined || q.difficulty <= opts.maxDifficulty) &&
      validateQuestion(q).length === 0,
  );

  const queues = conceptIds.map((id) =>
    usable
      .filter((q) => q.conceptId === id)
      .sort((a, b) => taggedCount(b) - taggedCount(a) || a.difficulty - b.difficulty || a.key.localeCompare(b.key)),
  );

  const picked: BankQuestion[] = [];
  const perConcept = new Map<string, number>();
  let progressed = true;
  while (picked.length < count && progressed) {
    progressed = false;
    for (const queue of queues) {
      if (picked.length >= count) break;
      const q = queue[0];
      if (!q) continue;
      if ((perConcept.get(q.conceptId) ?? 0) >= maxPer) {
        queue.length = 0;
        continue;
      }
      queue.shift();
      picked.push(q);
      perConcept.set(q.conceptId, (perConcept.get(q.conceptId) ?? 0) + 1);
      progressed = true;
    }
  }
  return picked;
}

/** Prefer questions whose wrong options reveal something. */
const taggedCount = (q: BankQuestion) => q.options.filter((o) => o.misconceptionKey).length;

/**
 * Prerequisite Pulse (standout feature 1): a 2–3 question check on what a new topic builds on,
 * run before teaching it. One question per direct prerequisite, nearest-in-sequence first, easier items only.
 */
export function prerequisitePulse(graph: ConceptGraph, targetConceptId: string, bank: readonly BankQuestion[], opts: { count?: number; config?: LearningConfig["selection"] } = {}): BankQuestion[] {
  const prereqs = graph.directPrerequisites(targetConceptId);
  return selectDiagnosticQuestions(prereqs, bank, {
    count: opts.count ?? 3,
    maxPerConcept: 1,
    maxDifficulty: 3,
    ...(opts.config ? { config: opts.config } : {}),
  });
}
