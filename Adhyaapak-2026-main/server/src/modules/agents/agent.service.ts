import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { AgentKind, AgentRunDto, FollowupPlan, InterventionPlan, LessonPrepPlan, StartAgentRequest } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { agentRuns, agentSteps, concepts, misconceptionPatterns, studentProfiles } from "../../db/schema";
import { AppError, conflict, notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";
import type { LlmProvider } from "../ai/provider";
import { recordAudit } from "../audit/audit.service";
import { loadAccessibleClass } from "../classes/class.access";
import { createClassAssessment } from "../classroom/assessment.service";
import { getAtlasWorkspace } from "../insights/atlas.service";
import { assignInterventions } from "../interventions/intervention.service";
import { AGENTS } from "./definitions";
import { runAgent } from "./runtime";

type RunRow = typeof agentRuns.$inferSelect;
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/** Background runs started by this process, so tests (and shutdown) can wait for them. */
export const pending = new Map<string, Promise<void>>();

export async function startAgent(db: Db, ai: LlmProvider, actor: Actor, kind: AgentKind, input: StartAgentRequest, requestId?: string): Promise<{ id: string }> {
  if (!ai.available) throw new AppError("provider_error", "AI is switched off or not configured, so the agent cannot run. Everything it would do can still be done by hand.");
  const cls = await loadAccessibleClass(db, actor, input.classId);
  let task: string;
  let seed: Array<{ kind: "C" | "P"; id: string; title?: string }>;
  let conceptId: string | null = null;
  let patternId: string | null = null;

  if (kind === "intervention_planner") {
    if (!input.patternId) throw new AppError("validation_error", "Choose the error pattern to plan for.");
    const [p] = await db.select().from(misconceptionPatterns).where(eq(misconceptionPatterns.id, input.patternId));
    if (!p) throw notFound("Pattern not found.");
    patternId = p.id;
    conceptId = p.conceptId;
    const [pc] = await db.select({ title: concepts.title }).from(concepts).where(eq(concepts.id, p.conceptId));
    seed = [{ kind: "P", id: p.id, title: p.name }, { kind: "C", id: p.conceptId, title: pc?.title }];
    task = `Plan an intervention for the error pattern P1 ("${p.name}") on concept C1 in this class.`;
  } else {
    if (!input.conceptId || !isUuid(input.conceptId)) throw new AppError("validation_error", "Choose the lesson.");
    const [c] = await db.select({ id: concepts.id, title: concepts.title }).from(concepts).where(eq(concepts.id, input.conceptId));
    if (!c) throw notFound("Lesson not found.");
    conceptId = c.id;
    seed = [{ kind: "C", id: c.id, title: c.title }];
    task = kind === "lesson_prep" ? `Prepare the next lesson, C1 ("${c.title}"), for this class.` : `Propose what happens after today's check on C1 ("${c.title}") in this class.`;
  }
  // One run at a time per teacher, class and agent: a double click must not start two.
  const [busy] = await db.select({ id: agentRuns.id }).from(agentRuns).where(and(eq(agentRuns.userId, actor.id), eq(agentRuns.classId, cls.id), eq(agentRuns.agent, kind), eq(agentRuns.status, "running")));
  if (busy) return { id: busy.id };

  const [run] = await db.insert(agentRuns).values({ agent: kind, userId: actor.id, classId: cls.id, conceptId, patternId }).returning({ id: agentRuns.id });
  await recordAudit(db, { actorId: actor.id, action: `agent.start`, entityType: "agent_run", entityId: run!.id, metadata: { agent: kind, classId: cls.id }, requestId });
  const job = runAgent(AGENTS[kind], { db, ai, actor, runId: run!.id, classId: cls.id, seed, task, requestId }).finally(() => pending.delete(run!.id));
  pending.set(run!.id, job);
  return { id: run!.id };
}

async function loadRun(db: Db, actor: Actor, runId: string): Promise<RunRow> {
  if (!isUuid(runId)) throw notFound("Agent run not found.");
  const [row] = await db.select().from(agentRuns).where(eq(agentRuns.id, runId));
  // Someone else's run looks like a missing one.
  if (!row || (row.userId !== actor.id && actor.role !== "admin")) throw notFound("Agent run not found.");
  await loadAccessibleClass(db, actor, row.classId);
  return row;
}

async function toDto(db: Db, row: RunRow): Promise<AgentRunDto> {
  const steps = await db.select().from(agentSteps).where(eq(agentSteps.runId, row.id)).orderBy(asc(agentSteps.stepIndex));
  const ids = Object.values(row.pseudonyms);
  const names = ids.length ? new Map((await db.select({ id: studentProfiles.id, name: studentProfiles.name }).from(studentProfiles).where(inArray(studentProfiles.id, ids))).map((s) => [s.id, s.name])) : new Map<string, string>();
  return {
    id: row.id,
    agent: row.agent,
    status: row.status,
    classId: row.classId,
    conceptId: row.conceptId,
    patternId: row.patternId,
    steps: steps.map((s) => ({ index: s.stepIndex, reason: s.reason, tool: s.tool, args: s.args, observation: s.observation, ok: s.ok, durationMs: s.durationMs })),
    plan: row.plan ?? null,
    people: Object.fromEntries(Object.entries(row.pseudonyms).map(([ref, id]) => [ref, names.get(id) ?? ref])),
    error: row.error,
    outcome: row.outcome ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getAgentRun(db: Db, actor: Actor, runId: string): Promise<AgentRunDto> {
  return toDto(db, await loadRun(db, actor, runId));
}

/** The latest run of an agent for a class (and lesson or pattern), so a page can show it again after a reload. */
export async function latestAgentRun(db: Db, actor: Actor, classId: string, kind: AgentKind, key: { conceptId?: string; patternId?: string }): Promise<AgentRunDto | null> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const conds = [eq(agentRuns.classId, cls.id), eq(agentRuns.agent, kind), eq(agentRuns.userId, actor.id)];
  if (key.conceptId && isUuid(key.conceptId)) conds.push(eq(agentRuns.conceptId, key.conceptId));
  if (key.patternId && isUuid(key.patternId)) conds.push(eq(agentRuns.patternId, key.patternId));
  const [row] = await db.select().from(agentRuns).where(and(...conds)).orderBy(desc(agentRuns.createdAt)).limit(1);
  return row ? toDto(db, row) : null;
}

/**
 * The teacher's decision. Rejecting changes nothing. Approving carries out the plan with the normal, permission-checked
 * services, and only the parts a plan may contain: assigning activities to the students it names and creating a check as
 * a draft. Drafted explanations stay drafts until approved on the drafts page.
 */
export async function decideAgentRun(db: Db, actor: Actor, runId: string, decision: "approve" | "reject", requestId?: string): Promise<AgentRunDto> {
  const row = await loadRun(db, actor, runId);
  if (row.status !== "awaiting_approval") {
    if ((row.status === "approved" && decision === "approve") || (row.status === "rejected" && decision === "reject")) return toDto(db, row); // repeat is harmless
    throw conflict(row.status === "running" ? "The agent is still working." : "This plan has already been decided.");
  }
  // Claim the decision first, so two clicks cannot carry out a plan twice.
  const [claimed] = await db.update(agentRuns).set({ status: decision === "approve" ? "approved" : "rejected", decidedAt: new Date() }).where(and(eq(agentRuns.id, row.id), eq(agentRuns.status, "awaiting_approval"))).returning();
  if (!claimed) return toDto(db, (await db.select().from(agentRuns).where(eq(agentRuns.id, row.id)))[0]!);
  await recordAudit(db, { actorId: actor.id, action: `agent.${decision}`, entityType: "agent_run", entityId: row.id, metadata: { agent: row.agent, classId: row.classId }, requestId });
  if (decision === "reject") {
    await db.update(agentRuns).set({ outcome: { message: "Plan set aside. Nothing was changed.", links: [] } }).where(eq(agentRuns.id, row.id));
    return getAgentRun(db, actor, row.id);
  }

  const links: Array<{ label: string; href: string }> = [];
  let message = "";
  const cls = row.classId;
  try {
    if (row.agent === "intervention_planner") {
      const plan = row.plan as unknown as InterventionPlan;
      const record = (await getAtlasWorkspace(db, actor, cls)).records.find((r) => r.patternId === row.patternId);
      const students = (record?.students ?? []).filter((s) => s.review !== "dismissed").map((s) => s.id);
      let assigned = 0;
      if (students.length && row.conceptId) {
        const r = await assignInterventions(db, actor, cls, { conceptId: row.conceptId, assignments: students.map((studentId) => ({ studentId, groupKey: "foundation", movedReason: "Intervention plan approved from the Misconception Atlas", note: plan.groupActivity.slice(0, 300) })) }, requestId);
        assigned = r.assigned.length;
      }
      const recheck = await createClassAssessment(db, actor, cls, { title: `Recheck: ${record?.name ?? "error pattern"}`.slice(0, 120), type: "follow_up", questionIds: plan.recheckQuestionIds }, requestId);
      message = `${assigned} students have the small-group activity. A recheck with ${plan.recheckQuestionIds.length} new questions is ready as a draft for about ${plan.recheckAfterDays} days from now.`;
      links.push({ label: "Open the recheck", href: `/activities/${recheck.id}` }, { label: "Branch Board", href: `/classes/${cls}/branch-board?concept=${row.conceptId}` });
      if (plan.explanation.draftId) links.push({ label: "Review the drafted explanation", href: `/curriculum/concepts/${row.conceptId}/drafts` });
      else links.push({ label: "Show the explanation on the projector", href: `/present/${row.conceptId}?level=${plan.explanation.level}` });
    } else if (row.agent === "lesson_prep") {
      const plan = row.plan as unknown as LessonPrepPlan;
      message = `Plan saved. The check step can start with the ${plan.checkQuestionIds.length} questions it chose.`;
      links.push({ label: "Open the lesson", href: `/classes/${cls}/lessons/${row.conceptId}?step=prepare` });
      if (plan.draftId) links.push({ label: "Review the drafted explanation", href: `/curriculum/concepts/${row.conceptId}/drafts` });
    } else {
      const plan = row.plan as unknown as FollowupPlan;
      const toId = row.pseudonyms;
      let assigned = 0;
      const assignments = plan.groups.flatMap((g) => g.students.filter((s) => toId[s]).map((s) => ({ studentId: toId[s]!, groupKey: g.groupKey, movedReason: "Follow-up plan approved after the check", note: g.activity.slice(0, 300) })));
      if (assignments.length && row.conceptId) assigned = (await assignInterventions(db, actor, cls, { conceptId: row.conceptId, assignments }, requestId)).assigned.length;
      if (plan.followUpQuestionIds.length) {
        const a = await createClassAssessment(db, actor, cls, { title: `Follow-up check (${plan.decision.replace("_", " ")})`, type: "follow_up", questionIds: plan.followUpQuestionIds }, requestId);
        links.push({ label: "Open the follow-up check", href: `/activities/${a.id}` });
      }
      message = `${assigned} students have their next activity.${plan.followUpQuestionIds.length ? " The follow-up check is ready as a draft." : ""}`;
      links.push({ label: "Branch Board", href: `/classes/${cls}/branch-board?concept=${row.conceptId}` });
    }
  } catch (err) {
    message = `Approved, but part of the plan could not be carried out: ${err instanceof AppError ? err.message : "an unexpected error"}. What was done is listed below.`;
  }
  await db.update(agentRuns).set({ outcome: { message, links } }).where(eq(agentRuns.id, row.id));
  return getAgentRun(db, actor, row.id);
}
