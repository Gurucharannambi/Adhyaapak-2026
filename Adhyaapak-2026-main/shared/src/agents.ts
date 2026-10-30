import { z } from "zod";
import { Id } from "./common";

/**
 * Agentic workflows: bounded tool-using loops. The model chooses one tool per step and gives a short, teacher-readable
 * reason; the server runs the tool and feeds the result back. Tools only read records or create private drafts.
 * Anything that changes a class (assigning work, creating a check) happens only when the teacher approves the plan.
 * Students are shown to the model as S1, S2 … never by name.
 */
export const AgentKind = z.enum(["intervention_planner", "lesson_prep", "check_followup"]);
export type AgentKind = z.infer<typeof AgentKind>;

export const AgentRunStatus = z.enum(["running", "awaiting_approval", "approved", "rejected", "failed"]);
export type AgentRunStatus = z.infer<typeof AgentRunStatus>;

export const AGENT_LIMITS = { maxSteps: 8 } as const;

const Level = z.enum(["foundation", "guided", "challenge"]);

// --- plans (all fields required and nullable rather than optional, so strict JSON-schema output works) ---------

export const InterventionPlan = z.object({
  summary: z.string().min(1).max(600),
  /** The likely reasoning error, in plain words, grounded in the evidence the agent looked at. */
  diagnosis: z.string().min(1).max(600),
  /** What the evidence is and how strong it is, so the teacher can check it. */
  evidenceNote: z.string().min(1).max(600),
  /** Revisit an earlier idea first, if the readiness data supports it. */
  prerequisiteFirst: z.object({ conceptId: Id, reason: z.string().max(300) }).nullable(),
  explanation: z.object({ level: Level, resourceId: Id.nullable(), draftId: Id.nullable(), why: z.string().max(300) }),
  /** A short small-group activity for the affected students. */
  groupActivity: z.string().min(1).max(600),
  /** New questions on the underlying idea, from the approved bank, for the recheck. */
  recheckQuestionIds: z.array(Id).min(1).max(4),
  recheckAfterDays: z.number().int().min(1).max(14),
});
export type InterventionPlan = z.infer<typeof InterventionPlan>;

export const LessonPrepPlan = z.object({
  summary: z.string().min(1).max(600),
  warmUp: z.object({ prerequisiteConceptId: Id.nullable(), text: z.string().min(1).max(400) }),
  level: z.object({ level: Level, reason: z.string().min(1).max(300) }),
  checkQuestionIds: z.array(Id).min(2).max(3),
  watchFor: z.array(z.string().min(1).max(200)).max(4),
  /** Set when the agent drafted a missing explanation; it stays a private draft until approved on the drafts page. */
  draftId: Id.nullable(),
});
export type LessonPrepPlan = z.infer<typeof LessonPrepPlan>;

export const FollowupPlan = z.object({
  summary: z.string().min(1).max(600),
  decision: z.enum(["reteach", "move_on", "collect_more"]),
  reason: z.string().min(1).max(400),
  groups: z
    .array(
      z.object({
        groupKey: z.enum(["foundation", "guided", "challenge", "follow_up"]),
        /** Pseudonymous student references (S1, S2 …) exactly as the tools gave them. */
        students: z.array(z.string().regex(/^S\d+$/)).max(120),
        activity: z.string().min(1).max(300),
      }),
    )
    .max(4),
  followUpQuestionIds: z.array(Id).max(4),
  teacherNote: z.string().max(400),
});
export type FollowupPlan = z.infer<typeof FollowupPlan>;

export const StartAgentRequest = z.object({
  classId: Id,
  conceptId: Id.optional(),
  patternId: Id.optional(),
});
export type StartAgentRequest = z.infer<typeof StartAgentRequest>;

export const AgentStepDto = z.object({
  index: z.number().int(),
  reason: z.string(),
  tool: z.string(),
  args: z.record(z.string(), z.unknown()),
  /** What the tool returned, shortened for display. Pseudonymous, as the model saw it. */
  observation: z.string(),
  ok: z.boolean(),
  durationMs: z.number().int(),
});
export type AgentStepDto = z.infer<typeof AgentStepDto>;

export const AgentRunDto = z.object({
  id: Id,
  agent: AgentKind,
  status: AgentRunStatus,
  classId: Id,
  conceptId: Id.nullable(),
  patternId: Id.nullable(),
  steps: z.array(AgentStepDto),
  plan: z.unknown().nullable(),
  /** Pseudonym → name, for the teacher's eyes only (never sent to the model). */
  people: z.record(z.string(), z.string()),
  error: z.string().nullable(),
  /** What approving did, with links to the records it created. */
  outcome: z.object({ message: z.string(), links: z.array(z.object({ label: z.string(), href: z.string() })) }).nullable(),
  createdAt: z.string(),
});
export type AgentRunDto = z.infer<typeof AgentRunDto>;

export const AgentDecisionRequest = z.object({ decision: z.enum(["approve", "reject"]) });
export type AgentDecisionRequest = z.infer<typeof AgentDecisionRequest>;
