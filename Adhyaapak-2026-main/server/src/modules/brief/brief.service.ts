import { desc, eq, inArray, count } from "drizzle-orm";
import type { BriefItem, BriefListResponse, EvidenceRef, MasteryStatus, TeachingBriefDto, UpdateBriefItemRequest } from "@adhyaapak/shared";
import type { Db } from "../../db/client";
import { assessmentEvidence, teachingBriefs } from "../../db/schema";
import { conflict, notFound } from "../../http/errors";
import type { Actor } from "../auth/permissions";
import { recordAudit } from "../audit/audit.service";
import { loadAccessibleClass } from "../classes/class.access";
import { getClassMisconceptions, getLearningMap } from "../classroom/map.service";
import { DEFAULT_LEARNING_CONFIG } from "../learning/config";
import { classStudentIds, revisitDue } from "./revisit.service";

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);

/**
 * How much evidence a class-level sentence needs. With fewer students than this, the brief says "not enough
 * evidence yet" instead of describing the class. These are judgement calls, not measured truths.
 */
export const BRIEF_RULES = { minStudentsForClassClaim: 3, secureShare: 0.6, revisionShare: 0.4 } as const;

const rolls = (map: Awaited<ReturnType<typeof getLearningMap>>, conceptId: string, statuses: readonly MasteryStatus[]) =>
  map.students.filter((s) => s.cells[conceptId] && statuses.includes(s.cells[conceptId]!.status)).map((s) => s.rosterNumber);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const rollText = (r: number[]) => (r.length === 0 ? "" : ` (roll ${r.slice(0, 12).join(", ")}${r.length > 12 ? ", …" : ""})`);

type Draft = Omit<BriefItem, "id" | "status" | "editedText">;

/**
 * Builds the brief from stored records only. Measured lines are counts from the learning map, misconception
 * records and the revisit query. Inferred lines are suggestions that name the measured lines they rest on.
 * No model writes any of these sentences, so nothing here can claim more than the records show.
 */
export async function generateBrief(db: Db, actor: Actor, classId: string, requestId?: string): Promise<TeachingBriefDto> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const map = await getLearningMap(db, actor, cls.id);
  const mis = await getClassMisconceptions(db, actor, cls.id);
  const studentIds = await classStudentIds(db, cls.id);
  const revisit = await revisitDue(db, studentIds);
  const [prev] = await db.select().from(teachingBriefs).where(eq(teachingBriefs.classId, cls.id)).orderBy(desc(teachingBriefs.createdAt)).limit(1);
  const [{ n: answers } = { n: 0 }] = studentIds.length ? await db.select({ n: count() }).from(assessmentEvidence).where(inArray(assessmentEvidence.studentId, studentIds)) : [{ n: 0 }];

  const drafts: Array<Draft & { key: string }> = [];
  const add = (key: string, d: Draft) => drafts.push({ key, ...d });
  const concept = (id: string, title: string): EvidenceRef => ({ type: "concept_status", conceptId: id, label: `Learning map: ${title}` });

  const conceptsWithEvidence = map.concepts.filter((c) => map.students.length - (c.counts.not_enough_evidence ?? 0) > 0);

  if (answers === 0 || conceptsWithEvidence.length === 0) {
    add("assess:none", {
      section: "assess",
      kind: "measured",
      text: "No answers have been recorded for this class yet, so there is nothing to summarise. Run a short check first.",
      evidence: [],
      basedOn: [],
      rollNumbers: [],
    });
  }

  for (const c of conceptsWithEvidence) {
    const total = map.students.length;
    const noEv = c.counts.not_enough_evidence ?? 0;
    const withEv = total - noEv;
    const secureN = (c.counts.likely_secure ?? 0) + (c.counts.ready_for_challenge ?? 0);
    const needN = (c.counts.needs_foundation ?? 0) + (c.counts.developing ?? 0);
    const base = `${c.title}: `;

    if (withEv < BRIEF_RULES.minStudentsForClassClaim) {
      add(`assess:thin:${c.id}`, {
        section: "assess",
        kind: "measured",
        text: `${base}only ${plural(withEv, "student has", "students have")} enough answers so far, which is too few to say anything about the class.`,
        evidence: [concept(c.id, c.title)],
        basedOn: [],
        rollNumbers: rolls(map, c.id, ["needs_foundation", "developing", "likely_secure", "ready_for_challenge"]),
      });
    } else {
      if (secureN / withEv >= BRIEF_RULES.secureShare) {
        add(`secure:${c.id}`, {
          section: "secure",
          kind: "measured",
          text: `${base}${secureN} of ${withEv} students with enough answers look secure. ${noEv > 0 ? `${plural(noEv, "student has", "students have")} not answered enough yet.` : ""}`.trim(),
          evidence: [concept(c.id, c.title)],
          basedOn: [],
          rollNumbers: rolls(map, c.id, ["likely_secure", "ready_for_challenge"]),
        });
      }
      if (needN / withEv >= BRIEF_RULES.revisionShare) {
        const f = c.counts.needs_foundation ?? 0;
        const d = c.counts.developing ?? 0;
        add(`revision:${c.id}`, {
          section: "revision",
          kind: "measured",
          text: `${base}${needN} of ${withEv} students need more practice (${f} should revisit an earlier idea first, ${d} are partly there).`,
          evidence: [concept(c.id, c.title)],
          basedOn: [],
          rollNumbers: rolls(map, c.id, ["needs_foundation", "developing"]),
        });
      }
    }

    const missing = map.students.filter((s) => (s.cells[c.id]?.status ?? "not_enough_evidence") === "not_enough_evidence").map((s) => s.rosterNumber);
    if (missing.length > 0 && withEv >= 1) {
      add(`assess:${c.id}`, {
        section: "assess",
        kind: "measured",
        text: `${base}${plural(missing.length, "student has", "students have")} not answered enough yet to say where they are${rollText(missing)}.`,
        evidence: [concept(c.id, c.title)],
        basedOn: [],
        rollNumbers: missing,
      });
    }
    const ready = rolls(map, c.id, ["ready_for_challenge"]);
    if (ready.length > 0) {
      add(`challenge:${c.id}`, {
        section: "challenge",
        kind: "measured",
        text: `${base}${plural(ready.length, "student looks", "students look")} ready for a harder task${rollText(ready)}.`,
        evidence: [concept(c.id, c.title)],
        basedOn: [],
        rollNumbers: ready,
      });
    }
  }

  for (const p of mis.patterns) {
    const firm = p.students.filter((s) => s.status === "likely" || s.status === "confirmed");
    if (firm.length === 0) continue;
    add(`patterns:${p.patternId}`, {
      section: "patterns",
      kind: "measured",
      text: `${p.conceptTitle}: ${plural(firm.length, "student", "students")} gave answers that fit “${p.name}”. This is a provisional reading of their answers; confirm or reject it on the misconception screen.`,
      evidence: [{ type: "misconception", conceptId: p.conceptId, label: `Misconception record: ${p.name}` }],
      basedOn: [],
      rollNumbers: [],
    });
  }

  for (const r of revisit) {
    const days = Math.floor((Date.now() - r.oldestEvidenceAt.getTime()) / 86_400_000);
    add(`revisit:${r.conceptId}`, {
      section: "revisit",
      kind: "measured",
      text: `${r.title}: ${plural(r.studentIds.length, "student last answered", "students last answered")} this at least ${DEFAULT_LEARNING_CONFIG.revisit.afterDays} days ago and looked secure then. A quick starter question would show whether it has stuck.`,
      evidence: [{ type: "revisit", conceptId: r.conceptId, label: `Last evidence ${days} days ago` }],
      basedOn: [],
      rollNumbers: [],
    });
  }

  // ---- inferred suggestions, each resting on measured lines
  const topRevision = drafts
    .filter((d) => d.section === "revision")
    .sort((a, b) => b.rollNumbers.length - a.rollNumbers.length)[0];
  if (topRevision) {
    const cid = topRevision.evidence[0]?.conceptId;
    const title = topRevision.text.split(":")[0]!;
    const pattern = cid ? mis.patterns.find((p) => p.conceptId === cid && p.students.some((s) => s.status !== "candidate")) : undefined;
    add("activity:main", {
      section: "activity",
      kind: "inferred",
      text: `Start with a 5–10 minute revision of ${title}: the Foundation explanation, then one guided example.${pattern ? ` Misconception Mirror prompt: “${pattern.mirror.prompt}”` : ""}`,
      evidence: topRevision.evidence,
      basedOn: [`revision:${cid}`],
      rollNumbers: topRevision.rollNumbers,
    });
    add("follow_up:main", {
      section: "follow_up",
      kind: "inferred",
      text: `In two or three days, run a short follow-up check on ${title} with the same students. A change only counts as improvement once there are at least two new answers.`,
      evidence: topRevision.evidence,
      basedOn: [`revision:${cid}`],
      rollNumbers: topRevision.rollNumbers,
    });
  }
  const firstAssess = drafts.find((d) => d.section === "assess" && !d.key.startsWith("assess:none") && d.rollNumbers.length > 0 && !d.key.startsWith("assess:thin"));
  if (firstAssess) {
    add("assess:action", {
      section: "assess",
      kind: "inferred",
      text: `Give the students who have not answered enough a short check (2 to 4 questions) before deciding anything about them.`,
      evidence: firstAssess.evidence,
      basedOn: [firstAssess.key],
      rollNumbers: firstAssess.rollNumbers,
    });
  }

  // ---- planned earlier but not done
  const carried = prev ? ((prev.items as unknown as BriefItem[]).filter((i) => i.kind === "inferred" && i.status === "accepted")) : [];
  for (const c of carried) {
    add(`carry_over:${c.id}`, {
      section: "carry_over",
      kind: "measured",
      text: `Planned in the last brief and not marked done: ${c.editedText ?? c.text}`,
      evidence: [{ type: "earlier_brief", label: `Brief of ${prev!.createdAt.toLocaleDateString("en-IN")}` }],
      basedOn: [],
      rollNumbers: c.rollNumbers,
    });
  }

  const items: BriefItem[] = drafts.map((d) => ({ id: d.key, section: d.section, kind: d.kind, text: d.text, evidence: d.evidence, basedOn: d.basedOn, rollNumbers: d.rollNumbers, status: "proposed", editedText: null }));
  const basis = { students: map.students.length, conceptsWithEvidence: conceptsWithEvidence.length, answersRecorded: answers };
  const [row] = await db.insert(teachingBriefs).values({ classId: cls.id, createdBy: actor.id, basis, items: items as unknown as Array<Record<string, unknown>> }).returning();
  await recordAudit(db, { actorId: actor.id, action: "brief.generate", entityType: "teaching_brief", entityId: row!.id, metadata: { classId: cls.id }, requestId });
  return toDto(row!, cls.name);
}

function toDto(row: typeof teachingBriefs.$inferSelect, className: string): TeachingBriefDto {
  return { id: row.id, classId: row.classId, className, createdAt: row.createdAt.toISOString(), basis: row.basis, items: row.items as unknown as BriefItem[] };
}

async function loadBrief(db: Db, actor: Actor, id: string) {
  if (!isUuid(id)) throw notFound("Brief not found.");
  const [row] = await db.select().from(teachingBriefs).where(eq(teachingBriefs.id, id));
  if (!row) throw notFound("Brief not found.");
  const cls = await loadAccessibleClass(db, actor, row.classId); // 404 for anyone but the class's teacher
  return { row, className: cls.name };
}

export async function getBrief(db: Db, actor: Actor, id: string): Promise<TeachingBriefDto> {
  const { row, className } = await loadBrief(db, actor, id);
  return toDto(row, className);
}

export async function listBriefs(db: Db, actor: Actor, classId: string): Promise<BriefListResponse> {
  const cls = await loadAccessibleClass(db, actor, classId);
  const rows = await db.select().from(teachingBriefs).where(eq(teachingBriefs.classId, cls.id)).orderBy(desc(teachingBriefs.createdAt));
  return { briefs: rows.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), items: r.items.length, accepted: (r.items as unknown as BriefItem[]).filter((i) => i.status === "accepted" || i.status === "done").length })) };
}

/** Accept, dismiss, mark done, or reword one line. Rewording is the teacher's own text; the evidence stays attached. */
export async function updateBriefItem(db: Db, actor: Actor, id: string, itemId: string, req: UpdateBriefItemRequest, requestId?: string): Promise<TeachingBriefDto> {
  const { row, className } = await loadBrief(db, actor, id);
  const items = row.items as unknown as BriefItem[];
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx === -1) throw notFound("That line is not in this brief.");
  const item = items[idx]!;
  if (req.status === "done" && item.kind === "measured") throw conflict("Only a planned action can be marked done.");
  items[idx] = { ...item, ...(req.status ? { status: req.status } : {}), ...(req.editedText !== undefined ? { editedText: req.editedText } : {}) };
  const [updated] = await db.update(teachingBriefs).set({ items: items as unknown as Array<Record<string, unknown>>, updatedAt: new Date() }).where(eq(teachingBriefs.id, row.id)).returning();
  await recordAudit(db, { actorId: actor.id, action: "brief.item_update", entityType: "teaching_brief", entityId: row.id, metadata: { itemId, status: req.status ?? null }, requestId });
  return toDto(updated!, className);
}

