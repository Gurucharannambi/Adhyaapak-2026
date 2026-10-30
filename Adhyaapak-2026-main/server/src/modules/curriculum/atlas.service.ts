import { asc, eq, inArray, sql } from "drizzle-orm";
import type { AtlasResponse, AtlasRule, RuleQuality, TranslationsResponse } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { classEnrolments, classes, concepts, learningResources, misconceptionObservations, misconceptionPatterns, questions } from "../../db/schema";
import { notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";

/** A rule needs this many confirm-or-reject decisions before we say anything about how it is holding up. */
export const MIN_DECISIONS = 5;

export function ruleQuality(confirmed: number, rejected: number, observed: number): RuleQuality {
  const decisions = confirmed + rejected;
  if (observed === 0) return "no_data";
  if (decisions < MIN_DECISIONS) return "too_few_decisions";
  const rate = confirmed / decisions;
  return rate >= 0.6 ? "holding_up" : rate <= 0.4 ? "often_rejected" : "mixed";
}

/**
 * The atlas for one teacher. Counts come only from that teacher's own classes, so one teacher never learns
 * anything about another's students, not even in aggregate.
 */
export async function getAtlas(db: Db, actor: Actor): Promise<AtlasResponse> {
  const mine = db.select({ id: classEnrolments.studentId }).from(classEnrolments).innerJoin(classes, eq(classes.id, classEnrolments.classId)).where(eq(classes.teacherId, actor.id));
  const counts = await db
    .select({
      patternId: misconceptionObservations.patternId,
      observed: sql<number>`count(distinct ${misconceptionObservations.studentId})`.mapWith(Number),
      likely: sql<number>`count(distinct ${misconceptionObservations.studentId}) filter (where ${misconceptionObservations.status} = 'likely')`.mapWith(Number),
      confirmed: sql<number>`count(distinct ${misconceptionObservations.studentId}) filter (where ${misconceptionObservations.status} = 'confirmed')`.mapWith(Number),
      rejected: sql<number>`count(distinct ${misconceptionObservations.studentId}) filter (where ${misconceptionObservations.status} = 'rejected')`.mapWith(Number),
    })
    .from(misconceptionObservations)
    .where(inArray(misconceptionObservations.studentId, mine))
    .groupBy(misconceptionObservations.patternId);
  const stat = new Map(counts.map((c) => [c.patternId, c]));

  const rules = await db
    .select({ p: misconceptionPatterns, conceptTitle: concepts.title, conceptOrder: concepts.conceptOrder })
    .from(misconceptionPatterns)
    .innerJoin(concepts, eq(concepts.id, misconceptionPatterns.conceptId))
    .where(eq(misconceptionPatterns.reviewStatus, "approved"))
    .orderBy(asc(concepts.conceptOrder), asc(misconceptionPatterns.key));

  const followKeys = rules.map((r) => (r.p.followUpDefinition as { questionKey?: string } | null)?.questionKey).filter((k): k is string => !!k);
  const stems = followKeys.length ? await db.select({ key: questions.key, stem: questions.stem }).from(questions).where(inArray(questions.key, followKeys)) : [];
  const stemOf = new Map(stems.map((s) => [s.key, s.stem]));

  const byConcept = new Map<string, { conceptId: string; title: string; rules: AtlasRule[] }>();
  for (const r of rules) {
    const s = stat.get(r.p.id) ?? { observed: 0, likely: 0, confirmed: 0, rejected: 0 };
    const decisions = s.confirmed + s.rejected;
    const rule: AtlasRule = {
      patternId: r.p.id,
      key: r.p.key,
      name: r.p.name,
      category: (r.p.triggerDefinition as { category?: string } | null)?.category ?? null,
      description: r.p.description,
      exampleWrongAnswers: r.p.exampleWrongAnswers,
      recommendedExplanation: r.p.recommendedExplanation,
      followUpQuestion: stemOf.get((r.p.followUpDefinition as { questionKey?: string } | null)?.questionKey ?? "") ?? null,
      stats: { studentsObserved: s.observed, likely: s.likely, confirmed: s.confirmed, rejected: s.rejected, confirmRate: decisions === 0 ? null : s.confirmed / decisions },
      quality: ruleQuality(s.confirmed, s.rejected, s.observed),
    };
    const entry = byConcept.get(r.p.conceptId) ?? { conceptId: r.p.conceptId, title: r.conceptTitle, rules: [] };
    entry.rules.push(rule);
    byConcept.set(r.p.conceptId, entry);
  }
  return { minDecisions: MIN_DECISIONS, concepts: [...byConcept.values()] };
}

/**
 * Teacher-only side-by-side view: the concept's own-language explanations next to any translations, including
 * drafts that nobody has reviewed yet (clearly marked). Students never see a translation until it is approved.
 */
export async function getTranslations(db: Db, conceptId: string, language?: string): Promise<TranslationsResponse> {
  if (!/^[0-9a-f-]{36}$/i.test(conceptId)) throw notFound("Concept not found.");
  const [concept] = await db.select().from(concepts).where(eq(concepts.id, conceptId));
  if (!concept) throw notFound("Concept not found.");
  const rows = await db.select().from(learningResources).where(eq(learningResources.conceptId, conceptId));
  const explanations = rows.filter((r) => r.type === "explanation" && r.level);
  const available = [...new Set(explanations.filter((r) => r.language !== concept.language).map((r) => r.language))].sort();
  const wanted = language ?? available[0];

  const levels = (["foundation", "guided", "challenge"] as const).map((level) => {
    const original = explanations.filter((r) => r.level === level && r.language === concept.language && r.reviewStatus === "approved").sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return {
      level,
      original: original ? { title: original.title, content: original.content } : null,
      translations: explanations
        .filter((r) => r.level === level && r.language !== concept.language && (!wanted || r.language === wanted))
        .map((r) => ({ language: r.language, title: r.title, content: r.content, reviewStatus: r.reviewStatus, note: (r.provenance as { note?: string }).note ?? null })),
    };
  });
  return { language: concept.language, available, levels };
}
