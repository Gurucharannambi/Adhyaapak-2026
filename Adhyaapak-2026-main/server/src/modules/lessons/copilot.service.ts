import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import type { CopilotResponse, RunHistoryResponse } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { auditLog, concepts } from "../../db/schema";
import { notFound } from "../../http/errors";
import type { LlmProvider } from "../ai/provider";
import type { Actor } from "../auth/permissions";
import { loadAccessibleClass } from "../classes/class.access";
import { getConceptDetail } from "../curriculum/curriculum.service";
import { isoDate } from "../timetable/pacing";
import { buildCopilot } from "./copilot";
import { getRecap, getRun, getRunSummary } from "./run.service";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/**
 * Gathers the real facts for this lesson and class (the check's recorded answers, earlier ideas, the lesson's approved
 * material) and hands them to the rules in copilot.ts. Nothing here calls the AI: that happens only if the teacher asks
 * for a draft, through the existing reviewed-draft flow.
 */
export async function getCopilot(db: Db, ai: LlmProvider, actor: Actor, classId: string, conceptId: string, today = isoDate(new Date())): Promise<CopilotResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  if (!isUuid(conceptId)) throw notFound("Lesson not found.");
  const detail = await getConceptDetail(db, conceptId);
  const summary = await getRunSummary(db, actor, cls.id, conceptId, today);
  const recap = await getRecap(db, actor, cls.id, conceptId, today);

  const recorded = summary.questions.reduce((s, q) => s + q.answered, 0);
  const right = summary.questions.reduce((s, q) => s + (q.options.find((o) => o.correct)?.count ?? 0), 0);
  const challenge = detail.questions.filter((q) => q.role === "challenge").sort((a, b) => a.difficulty - b.difficulty)[0];
  const levels = [...new Set(detail.resources.filter((r) => r.type === "explanation" && r.level).map((r) => r.level!))];

  return buildCopilot({
    answered: summary.answered,
    studentCount: summary.studentCount,
    patterns: summary.patterns,
    correctRate: recorded > 0 ? right / recorded : null,
    prerequisites: recap.prerequisites,
    levelsAvailable: levels,
    challengeQuestion: challenge ? { id: challenge.id, stem: challenge.stem } : null,
    aiAvailable: ai.available,
  });
}

const LABELS: Record<string, string> = {
  "lesson.start": "Lesson started",
  "assessment.create": "Check created",
  "assessment.approved": "Check approved",
  "assessment.open": "Check opened to students",
  "assessment.closed": "Check closed",
  "assessment.release_results": "Results shown to students",
  "lesson.taught": "Recorded as taught",
  "lesson.wrap": "Lesson wrapped up",
};

/** What actually happened in today's lesson, in order, from the audit log. Real records only. */
export async function getRunHistory(db: Db, actor: Actor, classId: string, conceptId: string, today = isoDate(new Date())): Promise<RunHistoryResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const run = await getRun(db, actor, cls.id, conceptId, today);
  if (run.state === "not_started") return { events: [] };
  const [c] = await db.select({ id: concepts.id }).from(concepts).where(eq(concepts.id, conceptId));
  if (!c) throw notFound("Lesson not found.");

  const since = new Date(run.startedAt!);
  const entities = [conceptId, ...(run.assessmentId ? [run.assessmentId] : [])];
  const rows = await db
    .select()
    .from(auditLog)
    .where(and(inArray(auditLog.entityId, entities), gte(auditLog.createdAt, new Date(since.getTime() - 2000)), inArray(auditLog.action, Object.keys(LABELS)), sql`coalesce(${auditLog.metadata}->>'classId', ${cls.id}) = ${cls.id}`))
    .orderBy(asc(auditLog.createdAt));
  return { events: rows.map((r) => ({ at: r.createdAt.toISOString(), label: LABELS[r.action]! })) };
}
