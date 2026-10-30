import { z } from "zod";
import { Id } from "./common";

/**
 * A quick poll is a one-question pulse of the class during a lesson. It is deliberately NOT an assessment: its answers are
 * class-level signals ("how sure do you feel?"), never scored, never mastery evidence, never stored against a student's
 * learning record. The teacher sees counts only.
 *
 * `short_answer` is the same idea with a typed answer: the teacher asks on the spot, students type a short answer, and the
 * teacher sees the distinct answers grouped (equal fractions together). An on-the-spot question has not been reviewed, so it
 * stays a class-level signal like the other kinds.
 */
export const PollKind = z.enum(["choice", "true_false", "confidence", "short_answer"]);
export type PollKind = z.infer<typeof PollKind>;

export const PollStatus = z.enum(["open", "closed"]);
export type PollStatus = z.infer<typeof PollStatus>;

/** The fixed wording for the "how sure are you" poll, so every class sees the same calm, non-judging choices. */
export const CONFIDENCE_PROMPT = "How sure do you feel about this idea?";
export const CONFIDENCE_OPTIONS = ["I could explain it to a friend", "I mostly get it", "I am not sure yet", "I would like more help"] as const;
export const TRUE_FALSE_OPTIONS = ["True", "False"] as const;

export const POLL_LIMITS = { promptMin: 3, promptMax: 200, optionMin: 2, optionMax: 4, optionTextMax: 80, answerMax: 24 } as const;

/** What a typed answer may contain: numbers, letters, fractions and a few signs. Keeps answers short and maths-shaped. */
export const SHORT_ANSWER_PATTERN = /^[\p{L}\p{N} /.,+=%-]+$/u;
const ShortAnswer = z
  .string()
  .trim()
  .min(1, "Type an answer.")
  .max(POLL_LIMITS.answerMax, `Keep it under ${POLL_LIMITS.answerMax} characters.`)
  .regex(SHORT_ANSWER_PATTERN, "Use numbers, letters and / only.");

export const CreatePollRequest = z
  .object({
    kind: PollKind,
    /** Required for `choice` and `true_false`; the `confidence` poll has fixed wording. */
    prompt: z.string().trim().min(POLL_LIMITS.promptMin).max(POLL_LIMITS.promptMax).optional(),
    /** Only for `choice`: two to four short options. */
    options: z.array(z.string().trim().min(1).max(POLL_LIMITS.optionTextMax)).min(POLL_LIMITS.optionMin).max(POLL_LIMITS.optionMax).optional(),
    /** Only for `short_answer`: the answer the teacher expects, so equal answers can be marked. Never sent to students. */
    expectedAnswer: ShortAnswer.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.kind !== "confidence" && !v.prompt) ctx.addIssue({ code: "custom", path: ["prompt"], message: "Write the question to ask." });
    if (v.kind === "choice") {
      if (!v.options) ctx.addIssue({ code: "custom", path: ["options"], message: "Give two to four choices." });
      else if (new Set(v.options.map((o) => o.toLowerCase())).size !== v.options.length) ctx.addIssue({ code: "custom", path: ["options"], message: "Each choice must be different." });
    }
    if (v.kind !== "choice" && v.options) ctx.addIssue({ code: "custom", path: ["options"], message: "Only a multiple-choice poll takes its own choices." });
    if (v.kind !== "short_answer" && v.expectedAnswer) ctx.addIssue({ code: "custom", path: ["expectedAnswer"], message: "Only a short-answer question takes an expected answer." });
  });
export type CreatePollRequest = z.infer<typeof CreatePollRequest>;

/** The teacher's view: counts per option, never who chose what. */
export const PollDto = z.object({
  id: Id,
  kind: PollKind,
  prompt: z.string(),
  status: PollStatus,
  options: z.array(z.object({ id: z.string(), text: z.string(), count: z.number().int() })),
  /** Short answer only: the typed answers grouped, most common first. Equal fractions and decimals share a group. */
  answers: z.array(
    z.object({
      label: z.string(),
      /** Other ways the same answer was written (for example 2/4 next to 1/2). */
      variants: z.array(z.string()),
      count: z.number().int(),
      /** Whether this group equals the expected answer; null when the teacher gave none. */
      matches: z.boolean().nullable(),
    }),
  ),
  expectedAnswer: z.string().nullable(),
  /** How many students have answered, out of the class size. */
  answered: z.number().int(),
  classSize: z.number().int(),
  createdAt: z.string(),
  closedAt: z.string().nullable(),
});
export type PollDto = z.infer<typeof PollDto>;

export const CurrentPollResponse = z.object({ poll: PollDto.nullable() });
export type CurrentPollResponse = z.infer<typeof CurrentPollResponse>;

/** The student's view: the question and choices only. Never other students' answers or the running counts. */
export const StudentPollDto = z.object({
  id: Id,
  /** "text" asks for a typed answer; "option" for a choice. */
  answerType: z.enum(["option", "text"]),
  prompt: z.string(),
  options: z.array(z.object({ id: z.string(), text: z.string() })),
  /** True once this student has answered, so the screen can say thanks instead of asking again. */
  answered: z.boolean(),
});
export type StudentPollDto = z.infer<typeof StudentPollDto>;

export const PollVoteRequest = z.union([z.object({ optionId: z.string().min(1).max(10) }).strict(), z.object({ text: ShortAnswer }).strict()]);
export type PollVoteRequest = z.infer<typeof PollVoteRequest>;
