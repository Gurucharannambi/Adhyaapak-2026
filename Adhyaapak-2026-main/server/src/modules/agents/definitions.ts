import { and, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AgentKind, FollowupPlan, InterventionPlan, LessonPrepPlan } from "@adhyaapak/shared";
import { assessmentQuestions, assessments } from "../../db/schema";
import { notFound } from "../../http/errors";
import { generateExplanationDraft } from "../ai/drafts.service";
import { getLearningMap } from "../classroom/map.service";
import { getConceptDetail } from "../curriculum/curriculum.service";
import { getBranchBoard } from "../interventions/board.service";
import { getAtlasWorkspace } from "../insights/atlas.service";
import { getRecap, getRunSummary } from "../lessons/run.service";
import { type AgentDefinition, type AgentTool, type Handles, cleanHandle, resolveAll } from "./runtime";

const need = <T>(v: T | null | undefined, what: string): T => {
  if (v === null || v === undefined) throw Object.assign(new Error(`This tool needs ${what}.`), { status: 400 });
  return v;
};

// --- tools: each wraps an existing, permission-checked service and returns handles, never ids or names ---------

const getPatternEvidence: AgentTool = {
  name: "get_pattern_evidence",
  description: "The class's evidence for one error pattern (args: pattern): how many students, how often, real answers, review state, earlier ideas, and what later answers show.",
  async run(ctx, a) {
    const w = await getAtlasWorkspace(ctx.db, ctx.actor, ctx.classId);
    const r = w.records.find((x) => x.patternId === need(a.patternId, "a pattern"));
    if (!r) throw notFound("That pattern has no evidence in this class.");
    return {
      pattern: r.name,
      description: r.description,
      whatTendsToHelp: r.recommendedExplanation,
      concept: { concept: ctx.handle("C", r.concept.id, r.concept.title), title: r.concept.title },
      buildsOn: r.prerequisites.map((p) => ({ concept: ctx.handle("C", p.id, p.title), title: p.title })),
      studentsAffected: r.affected,
      studentsWhoAnsweredOnConcept: r.answeredOnConcept,
      seenMoreThanOnce: r.repeated,
      checks: r.checks,
      strength: r.strength,
      review: r.review,
      afterLatestMatch: r.track,
      sampleAnswers: r.responses.slice(0, 6).map((x) => ({ student: ctx.ref(x.studentId), question: x.question, answer: x.answer, expected: x.expected })),
      students: r.students.filter((s) => s.review !== "dismissed").map((s) => ({ student: ctx.ref(s.id), matchingAnswers: s.observations, review: s.review, since: s.outcome })),
    };
  },
};

const getConceptStatus: AgentTool = {
  name: "get_concept_status",
  description: "How the class stands on one concept (args: concept): number of students per mastery status. 'not_enough_evidence' means too few answers, not weakness.",
  async run(ctx, a) {
    const map = await getLearningMap(ctx.db, ctx.actor, ctx.classId, { conceptIds: [need(a.conceptId, "a concept")] });
    const c = map.concepts[0];
    if (!c) return { note: "No recorded answers on this concept in this class yet.", classSize: map.students.length };
    return { concept: ctx.handle("C", c.id, c.title), title: c.title, classSize: map.students.length, studentsByStatus: c.counts };
  },
};

const getLessonMaterial: AgentTool = {
  name: "get_lesson_material",
  description: "The concept's learning objective, earlier ideas it builds on, known error patterns, and approved teaching material per level (args: concept).",
  async run(ctx, a) {
    const d = await getConceptDetail(ctx.db, need(a.conceptId, "a concept"));
    const approved = d.resources.filter((r) => r.reviewStatus === "approved" && r.type === "explanation");
    return {
      concept: ctx.handle("C", d.id, d.title),
      title: d.title,
      objective: d.learningObjective,
      buildsOn: d.prerequisites.map((p) => ({ concept: ctx.handle("C", p.id, p.title), title: p.title })),
      knownPatterns: d.misconceptions.map((m) => m.name),
      approvedMaterial: approved.map((r) => ({ material: ctx.handle("R", r.id, r.title), level: r.level, title: r.title, summary: String((r.content as { summary?: unknown }).summary ?? "").slice(0, 240) })),
    };
  },
};

const findQuestions: AgentTool = {
  name: "find_questions",
  description: "Approved bank questions on a concept (args: concept, count): ones this class has not seen in the last 30 days first; if there are too few, recently used ones follow, marked usedRecently. Use these question handles for any check.",
  async run(ctx, a) {
    const d = await getConceptDetail(ctx.db, need(a.conceptId, "a concept"));
    const ids = d.questions.map((q) => q.id);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const recent = ids.length
      ? await ctx.db
          .selectDistinct({ id: assessmentQuestions.questionId })
          .from(assessmentQuestions)
          .innerJoin(assessments, eq(assessments.id, assessmentQuestions.assessmentId))
          .where(and(eq(assessments.classId, ctx.classId), gte(assessments.createdAt, since), inArray(assessmentQuestions.questionId, ids)))
      : [];
    const used = new Set(recent.map((r) => r.id));
    const approved = d.questions.filter((q) => q.reviewStatus === "approved");
    // Fresh questions first; recently used ones only to make up the number, and marked so the plan can say so.
    const picked = [...approved.filter((q) => !used.has(q.id)), ...approved.filter((q) => used.has(q.id))].slice(0, a.count ?? 4);
    const freshCount = picked.filter((q) => !used.has(q.id)).length;
    return {
      concept: ctx.handle("C", d.id),
      questions: picked.map((q) => ({ question: ctx.handle("Q", q.id, q.stem, d.id), role: q.role, difficulty: q.difficulty, stem: q.stem, usedRecently: used.has(q.id) })),
      ...(freshCount < picked.length ? { note: `Only ${freshCount} of these are new to this class in the last 30 days; the rest were used recently. Mention this in the plan if you use them.` } : {}),
    };
  },
};

const draftExplanation: AgentTool = {
  name: "draft_explanation",
  description: "Draft a NEW explanation at one level when no approved material fits (args: concept, level). It is saved as a private draft the teacher must review; it is not used in class until approved.",
  async run(ctx, a) {
    const d = await generateExplanationDraft(ctx.db, ctx.ai, ctx.actor, need(a.conceptId, "a concept"), { level: need(a.level, "a level") }, ctx.requestId);
    return { draft: ctx.handle("D", d.id, d.title), level: d.level, title: d.title, summary: d.content.summary, automaticCheck: d.check.status, issues: d.check.issues };
  },
};

const getClassRecap: AgentTool = {
  name: "get_class_recap",
  description: "What happened last time and how ready the class is on the earlier ideas this lesson builds on (args: concept).",
  async run(ctx, a) {
    const r = await getRecap(ctx.db, ctx.actor, ctx.classId, need(a.conceptId, "a concept"));
    return { classSize: r.studentCount, previous: r.previous, buildsOn: r.prerequisites.map((p) => ({ concept: ctx.handle("C", p.conceptId, p.title), title: p.title, studentsAssessed: p.assessed, notYetSecure: p.notSecure })) };
  },
};

const getCheckResults: AgentTool = {
  name: "get_check_results",
  description: "Today's check on a lesson (args: concept): how many answered, each question's answer counts with the error pattern behind each wrong option, and the rule-based recommendation.",
  async run(ctx, a) {
    const s = await getRunSummary(ctx.db, ctx.actor, ctx.classId, need(a.conceptId, "a concept"));
    return {
      check: s.checkTitle,
      answered: s.answered,
      classSize: s.studentCount,
      questions: s.questions.map((q) => ({ stem: q.stem, answered: q.answered, options: q.options.map((o) => ({ text: o.text, count: o.count, correct: o.correct, pattern: o.pattern })) })),
      patterns: s.patterns,
      ruleBasedRecommendation: s.recommendation && { action: s.recommendation.action, reason: s.recommendation.reason, evidence: s.recommendation.sufficiency },
    };
  },
};

const getGroups: AgentTool = {
  name: "get_groups",
  description: "The rule-based suggested groups for the next activity on a concept (args: concept): each student (S#), their mastery status and the reason.",
  async run(ctx, a) {
    const b = await getBranchBoard(ctx.db, ctx.actor, ctx.classId, need(a.conceptId, "a concept"));
    return Object.fromEntries(Object.entries(b.lanes).map(([lane, cards]) => [lane, cards.map((c) => ({ student: ctx.ref(c.studentId), status: c.status, answers: c.evidenceCount, reason: c.reason, alreadyAssigned: !!c.assigned }))]));
  },
};

// --- the plans as the model writes them: handles instead of ids --------------------------------------------------

const Level = z.enum(["foundation", "guided", "challenge"]);

const InterventionModelPlan = (h: Handles) => z.object({
  summary: z.string().min(1).max(600),
  diagnosis: z.string().min(1).max(600),
  evidenceNote: z.string().min(1).max(600),
  prerequisiteFirst: z.object({ concept: h.one("C"), reason: z.string().max(300) }).nullable(),
  explanation: z.object({ level: Level, material: h.one("R").nullable(), draft: h.one("D").nullable(), why: z.string().max(300) }),
  groupActivity: z.string().min(1).max(600),
  recheckQuestions: z.array(h.one("Q")).min(1).max(4),
  recheckAfterDays: z.number().int().min(1).max(14),
});

const PrepModelPlan = (h: Handles) => z.object({
  summary: z.string().min(1).max(600),
  warmUp: z.object({ concept: h.one("C").nullable(), text: z.string().min(1).max(400) }),
  level: z.object({ level: Level, reason: z.string().min(1).max(300) }),
  checkQuestions: z.array(h.one("Q")).min(2).max(3),
  watchFor: z.array(z.string().min(1).max(200)).max(4),
  draft: h.one("D").nullable(),
});

const FollowupModelPlan = (h: Handles) => z.object({
  summary: z.string().min(1).max(600),
  decision: z.enum(["reteach", "move_on", "collect_more"]),
  reason: z.string().min(1).max(400),
  groups: z.array(z.object({ groupKey: z.enum(["foundation", "guided", "challenge", "follow_up"]), students: z.array(h.student()).max(120), activity: z.string().min(1).max(300) })).max(4),
  followUpQuestions: z.array(h.one("Q")).max(4),
  teacherNote: z.string().max(400),
});

const one = (ctx: Parameters<AgentDefinition<unknown, unknown>["resolve"]>[1], kind: "C" | "R" | "D", h: string | null | undefined, label: string, problems: string[]) => {
  if (!h) return null;
  const id = ctx.resolve(h, kind);
  if (!id) problems.push(`Unknown ${label}: ${h}.`);
  return id ?? null;
};

// --- agents ----------------------------------------------------------------------------------------------------

export const interventionPlanner: AgentDefinition<z.infer<ReturnType<typeof InterventionModelPlan>>, InterventionPlan> = {
  kind: "intervention_planner",
  promptVersion: "intervention-planner-3",
  goal: `Goal: plan a targeted intervention for one recurring error pattern in this class. Investigate the evidence for the pattern, check whether an earlier idea needs revisiting first, find suitable approved material (draft an explanation only if none fits), and choose NEW questions that test the underlying idea for a recheck. The plan is a proposal the teacher will approve or reject.`,
  tools: [getPatternEvidence, getConceptStatus, getLessonMaterial, findQuestions, draftExplanation],
  modelPlan: InterventionModelPlan,
  resolve(m, ctx) {
    const problems: string[] = [];
    const recheckQuestionIds = resolveAll(ctx, "Q", m.recheckQuestions, "questions", problems);
    const resourceId = one(ctx, "R", m.explanation.material, "material", problems);
    const draftId = one(ctx, "D", m.explanation.draft, "draft", problems);
    const pre = m.prerequisiteFirst ? one(ctx, "C", m.prerequisiteFirst.concept, "concept", problems) : null;
    if (recheckQuestionIds.length === 0) problems.push("The recheck needs at least one question from find_questions.");
    if (problems.length) return { plan: null, problems };
    return {
      plan: { summary: m.summary, diagnosis: m.diagnosis, evidenceNote: m.evidenceNote, prerequisiteFirst: pre && m.prerequisiteFirst ? { conceptId: pre, reason: m.prerequisiteFirst.reason } : null, explanation: { level: m.explanation.level, resourceId, draftId, why: m.explanation.why }, groupActivity: m.groupActivity, recheckQuestionIds, recheckAfterDays: m.recheckAfterDays },
      problems,
    };
  },
};

export const lessonPrep: AgentDefinition<z.infer<ReturnType<typeof PrepModelPlan>>, LessonPrepPlan> = {
  kind: "lesson_prep",
  promptVersion: "lesson-prep-5",
  goal: `Goal: help the teacher prepare the next lesson for this class. Look at what happened last time, how ready the class is on the earlier ideas, and the approved material. Suggest a short warm-up (on an earlier idea if the data supports it), a teaching level with a reason, two or three check questions, and what to watch for. The check questions must be on the lesson's own concept C1: get them with find_questions on C1, and use their Q handles. Draft an explanation only if no approved material exists at the level you suggest.`,
  tools: [getLessonMaterial, getClassRecap, getConceptStatus, findQuestions, draftExplanation],
  modelPlan: PrepModelPlan,
  resolve(m, ctx) {
    const problems: string[] = [];
    const lesson = ctx.resolve("C1", "C");
    const offTopic = m.checkQuestions.filter((q) => ctx.ownerOf(cleanHandle(q, "Q") ?? "") !== lesson);
    if (offTopic.length) problems.push(`The check questions must be on the lesson's concept C1; ${[...new Set(offTopic)].join(", ")} are not. Use find_questions on C1.`);
    const checkQuestionIds = resolveAll(ctx, "Q", m.checkQuestions, "questions", problems);
    const warm = one(ctx, "C", m.warmUp.concept, "concept", problems);
    const draftId = one(ctx, "D", m.draft, "draft", problems);
    if (checkQuestionIds.length < 2) problems.push("The check needs two or three DIFFERENT questions from find_questions on C1.");
    if (problems.length) return { plan: null, problems };
    return { plan: { summary: m.summary, warmUp: { prerequisiteConceptId: warm, text: m.warmUp.text }, level: m.level, checkQuestionIds, watchFor: m.watchFor, draftId }, problems };
  },
};

export const checkFollowup: AgentDefinition<z.infer<ReturnType<typeof FollowupModelPlan>>, FollowupPlan> = {
  kind: "check_followup",
  promptVersion: "check-followup-3",
  goal: `Goal: after today's check, propose what happens next. Read the results and the suggested groups, decide whether to reteach, move on, or collect more evidence first (say which and why, honestly, including when too few answered), give each group a short activity, and choose follow-up questions from find_questions that test the idea again in a new way.`,
  tools: [getCheckResults, getGroups, getLessonMaterial, findQuestions],
  modelPlan: FollowupModelPlan,
  resolve(m, ctx) {
    const problems: string[] = [];
    const followUpQuestionIds = resolveAll(ctx, "Q", m.followUpQuestions, "questions", problems);
    const known = ctx.refs();
    const groups = m.groups.map((g) => ({ ...g, students: g.students.map((s) => s.toUpperCase().match(/S\d+/)?.[0] ?? s) }));
    const bad = groups.flatMap((g) => g.students).filter((s) => !known.has(s));
    if (bad.length) problems.push(`Unknown students: ${bad.join(", ")}.`);
    if (problems.length) return { plan: null, problems };
    return { plan: { summary: m.summary, decision: m.decision, reason: m.reason, groups, followUpQuestionIds, teacherNote: m.teacherNote }, problems };
  },
};

export const AGENTS: Record<AgentKind, AgentDefinition<unknown, unknown>> = {
  intervention_planner: interventionPlanner as unknown as AgentDefinition<unknown, unknown>,
  lesson_prep: lessonPrep as unknown as AgentDefinition<unknown, unknown>,
  check_followup: checkFollowup as unknown as AgentDefinition<unknown, unknown>,
};

export { cleanHandle };
