import { z } from "zod";
import { Id } from "./common";

/**
 * What the copilot can suggest, and the evidence behind each suggestion. Suggestions are built by deterministic rules from
 * stored answers; the AI is only ever used on request, to draft new material that a teacher must review (see drafts).
 *
 * `certainty` is the strength of the evidence, not a probability: low = thin or indirect, medium = a clear signal from
 * enough answers, high = strong and direct. An error pattern is only ever a possibility, so it never rates above medium.
 */
export const SuggestionKind = z.enum(["collect_more", "visual_explanation", "parallel_example", "prerequisite_check", "guided_practice", "extension", "move_on"]);
export type SuggestionKind = z.infer<typeof SuggestionKind>;

export const CopilotAction = z.discriminatedUnion("type", [
  /** Show approved material from the lesson at this level, for preview before it is used. */
  z.object({ type: z.literal("preview_resource"), level: z.enum(["foundation", "guided", "challenge"]) }),
  /** Run a short check on an earlier concept the lesson builds on. */
  z.object({ type: z.literal("launch_prerequisite_check"), conceptId: Id, conceptTitle: z.string() }),
  /** Ask the AI for a draft explanation. It becomes a private draft that the teacher reviews and edits before any use. */
  z.object({ type: z.literal("prepare_ai_draft"), level: z.enum(["foundation", "guided", "challenge"]) }),
  /** Preview a harder question from the lesson's approved bank. */
  z.object({ type: z.literal("preview_question"), questionId: Id, stem: z.string() }),
]);
export type CopilotAction = z.infer<typeof CopilotAction>;

export const Suggestion = z.object({
  id: z.string(),
  kind: SuggestionKind,
  title: z.string(),
  /** What the evidence suggests, in one sentence a teacher can check. */
  why: z.string(),
  /** The records behind it. */
  evidence: z.array(z.string()),
  certainty: z.enum(["low", "medium", "high"]),
  /** The recommended teaching action. Null when the suggestion is to wait for more information. */
  action: CopilotAction.nullable(),
});
export type Suggestion = z.infer<typeof Suggestion>;

export const CopilotResponse = z.object({
  /** no_evidence: nobody has answered. thin: too few answers to say anything. enough: suggestions below rest on real answers. */
  basis: z.enum(["no_evidence", "thin", "enough"]),
  answered: z.number().int(),
  studentCount: z.number().int(),
  /** Said plainly whenever there is not enough to go on. */
  message: z.string(),
  suggestions: z.array(Suggestion),
  /** Whether the server can draft material with the AI right now. When false, the AI action is shown as unavailable. */
  aiAvailable: z.boolean(),
});
export type CopilotResponse = z.infer<typeof CopilotResponse>;

export const RunEventDto = z.object({ at: z.string(), label: z.string() });
export type RunEventDto = z.infer<typeof RunEventDto>;
export const RunHistoryResponse = z.object({ events: z.array(RunEventDto) });
export type RunHistoryResponse = z.infer<typeof RunHistoryResponse>;
