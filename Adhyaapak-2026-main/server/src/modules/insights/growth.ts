import { GROWTH_RULES, canAffectMastery, type AssessmentEvidence, type GrowthGroup, type GrowthKey, type MasteryStatus } from "@adhyaapak/shared";

/**
 * Growth and recognition, as explicit rules over recorded answers. Pure, so every rule is unit-tested.
 * Nothing here looks at clicks, time on screen or attendance, and nothing compares one student with another.
 */
export interface GrowthInput {
  students: Array<{ id: string; name: string }>;
  conceptTitle: Map<string, string>;
  mastery: Array<{ studentId: string; conceptId: string; status: MasteryStatus; evidenceCount: number; lastEvidenceAt: Date | null }>;
  evidence: AssessmentEvidence[];
  /** Practice sets each student submitted in the recent window. */
  practiceSets: Map<string, number>;
  now: Date;
}

const ORDER: GrowthKey[] = ["ready_for_challenge", "recently_secure", "improved", "practice", "needs_explanation"];
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export function growthGroups(input: GrowthInput): GrowthGroup[] {
  const r = GROWTH_RULES;
  const nameOf = new Map(input.students.map((s) => [s.id, s.name]));
  const recentFrom = input.now.getTime() - r.recentDays * 86_400_000;
  const out = new Map<GrowthKey, GrowthGroup["students"]>(ORDER.map((k) => [k, []]));
  const add = (key: GrowthKey, studentId: string, conceptId: string | null, why: string) => {
    const list = out.get(key)!;
    // One entry per student per group, so a list never turns into a tally of one child.
    if (list.some((e) => e.studentId === studentId) || list.length >= r.maxPerGroup) return;
    list.push({ studentId, name: nameOf.get(studentId)!, conceptId, conceptTitle: conceptId ? (input.conceptTitle.get(conceptId) ?? null) : null, why });
  };

  // Most recent evidence first, so the freshest concept is the one named.
  const mastery = input.mastery.filter((m) => nameOf.has(m.studentId)).sort((a, b) => (b.lastEvidenceAt?.getTime() ?? 0) - (a.lastEvidenceAt?.getTime() ?? 0));
  for (const m of mastery) {
    const title = input.conceptTitle.get(m.conceptId) ?? "this concept";
    if (m.status === "ready_for_challenge") add("ready_for_challenge", m.studentId, m.conceptId, `Ready for a challenge on ${title}, from ${plural(m.evidenceCount, "counted answer")} including harder questions.`);
    else if (m.status === "likely_secure" && m.lastEvidenceAt && m.lastEvidenceAt.getTime() >= recentFrom)
      add("recently_secure", m.studentId, m.conceptId, `Likely secure on ${title}, with answers in the last ${r.recentDays} days (${plural(m.evidenceCount, "counted answer")}).`);
    else if (m.status === "needs_foundation" && m.evidenceCount >= r.needsMinAnswers)
      add("needs_explanation", m.studentId, m.conceptId, `${plural(m.evidenceCount, "counted answer")} on ${title} suggest another explanation could help. This is about the idea, not the child.`);
  }

  // Improved against the student's own start: early answers on a concept had mistakes, the latest two were right.
  const byPair = new Map<string, AssessmentEvidence[]>();
  for (const e of input.evidence) {
    if (!nameOf.has(e.studentId) || !canAffectMastery(e) || e.result === "insufficient") continue;
    const k = `${e.studentId}|${e.conceptId}`;
    byPair.set(k, [...(byPair.get(k) ?? []), e]);
  }
  const improved = [...byPair.entries()]
    .map(([k, list]) => ({ k, list: list.sort((a, b) => a.observedAt.localeCompare(b.observedAt)) }))
    .filter(({ list }) => list.length >= r.improvedMinAnswers && list.slice(0, 2).some((e) => e.result === "incorrect") && list.slice(-2).every((e) => e.result === "correct"))
    .sort((a, b) => b.list.at(-1)!.observedAt.localeCompare(a.list.at(-1)!.observedAt));
  for (const { k, list } of improved) {
    const [studentId, conceptId] = k.split("|") as [string, string];
    add("improved", studentId, conceptId, `Early answers on ${input.conceptTitle.get(conceptId) ?? "this concept"} had mistakes; the latest two were right (${plural(list.length, "counted answer")}).`);
  }

  for (const [studentId, n] of input.practiceSets) {
    if (nameOf.has(studentId) && n >= r.practiceMinSets) add("practice", studentId, null, `Finished ${plural(n, "practice set")} in the last ${r.recentDays} days.`);
  }

  return ORDER.map((key) => ({ key, students: out.get(key)! }));
}
