import { z } from "zod";

export const ErrorCategory = z.enum(["conceptual", "procedural", "arithmetic", "reading"]);
export type ErrorCategory = z.infer<typeof ErrorCategory>;

/**
 * Misconception rules are validated data, never executable code stored in the database (CLAUDE.md §10).
 * Two trigger kinds exist today:
 *  - distractor_option: fires when the chosen option is tagged with this rule's key
 *  - answer_pattern:    fires when the (normalised) answer text equals one of `patterns`
 */
export const RuleTrigger = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("distractor_option"), category: ErrorCategory }),
  z.object({ kind: z.literal("answer_pattern"), category: ErrorCategory, patterns: z.array(z.string().min(1)).min(1) }),
]);
export type RuleTrigger = z.infer<typeof RuleTrigger>;

export const RuleFollowUp = z.object({ questionKey: z.string().min(1) });

export interface MisconceptionRule {
  id: string;
  key: string;
  conceptId: string;
  name: string;
  trigger: RuleTrigger;
  followUpQuestionKey: string;
  reviewStatus: "draft" | "reviewed" | "approved" | "rejected";
}

export class InvalidRuleError extends Error {
  constructor(key: string, detail: string) {
    super(`Misconception rule "${key}" is invalid: ${detail}`);
    this.name = "InvalidRuleError";
  }
}

export interface RuleRow {
  id: string;
  key: string;
  conceptId: string;
  name: string;
  triggerDefinition: unknown;
  followUpDefinition: unknown;
  reviewStatus: MisconceptionRule["reviewStatus"];
}

/** Turns a database row into a typed rule, or throws so a malformed rule is never silently ignored. */
export function parseRule(row: RuleRow): MisconceptionRule {
  const trigger = RuleTrigger.safeParse(row.triggerDefinition);
  if (!trigger.success) throw new InvalidRuleError(row.key, `trigger: ${trigger.error.issues[0]?.message ?? "unreadable"}`);
  const followUp = RuleFollowUp.safeParse(row.followUpDefinition);
  if (!followUp.success) throw new InvalidRuleError(row.key, `follow-up: ${followUp.error.issues[0]?.message ?? "unreadable"}`);
  return {
    id: row.id,
    key: row.key,
    conceptId: row.conceptId,
    name: row.name,
    trigger: trigger.data,
    followUpQuestionKey: followUp.data.questionKey,
    reviewStatus: row.reviewStatus,
  };
}
