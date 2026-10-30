import type { MasteryStatus } from "@adhyaapak/shared";

export const STATUS_ORDER: MasteryStatus[] = ["not_enough_evidence", "needs_foundation", "developing", "likely_secure", "ready_for_challenge"];

/**
 * What the map says about a concept for this class, using only the recorded counts. It is a description, not a grade:
 * it never ranks students and never turns counts into a probability.
 */
export interface NodeFacts {
  /** How many students have any evidence on this concept. */
  withEvidence: number;
  classSize: number;
  /** Statuses present, most in need of attention first. Empty when nobody has evidence. */
  present: Array<{ status: MasteryStatus; count: number }>;
  /** True when the class has no evidence on this concept at all. */
  quiet: boolean;
}

export function nodeFacts(counts: Partial<Record<MasteryStatus, number>> | undefined, classSize: number): NodeFacts {
  const c = counts ?? {};
  const withEvidence = STATUS_ORDER.filter((s) => s !== "not_enough_evidence").reduce((n, s) => n + (c[s] ?? 0), 0);
  const present = (["needs_foundation", "developing", "likely_secure", "ready_for_challenge"] as MasteryStatus[]).filter((s) => (c[s] ?? 0) > 0).map((status) => ({ status, count: c[status]! }));
  return { withEvidence, classSize, present, quiet: withEvidence === 0 };
}

export interface Step {
  conceptId: string;
  label: string;
  why: string;
}

/**
 * Follow-up ideas for a concept, from the same evidence. Each carries its reason so the teacher can check it, and every
 * one is a suggestion to consider, not an instruction.
 */
export function followUps(args: { facts: NodeFacts; prerequisites: Array<{ id: string; title: string }>; patterns: Array<{ name: string; studentCount: number }> }): Step[] {
  const out: Step[] = [];
  const needing = args.facts.present.find((p) => p.status === "needs_foundation")?.count ?? 0;
  const developing = args.facts.present.find((p) => p.status === "developing")?.count ?? 0;
  if (needing > 0 && args.prerequisites.length > 0) {
    for (const p of args.prerequisites) out.push({ conceptId: p.id, label: `Look at the earlier idea: ${p.title}`, why: `${needing} of ${args.facts.withEvidence} students with evidence need foundation on this concept, and it builds on ${p.title}.` });
  }
  if (developing > 0 && needing === 0) out.push({ conceptId: "", label: "Give guided practice on this concept", why: `${developing} of ${args.facts.withEvidence} students with evidence are developing.` });
  for (const pat of args.patterns) out.push({ conceptId: "", label: `Check the possible pattern: ${pat.name}`, why: `${pat.studentCount} students gave answers matching it. This is provisional until you confirm it on the class map.` });
  return out;
}

/** Column and row positions for the graph, left to right in teaching order, from explicit prerequisite links. */
export function placeNodes(concepts: Array<{ id: string; prerequisiteIds: string[] }>): Map<string, { col: number; row: number }> {
  const known = new Set(concepts.map((c) => c.id));
  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const depthOf = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0; // a loop never exists in an approved graph; cut it rather than recurse forever
    visiting.add(id);
    const d = Math.max(-1, ...byId.get(id)!.prerequisiteIds.filter((p) => known.has(p)).map(depthOf)) + 1;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };
  const rows = new Map<number, number>();
  const out = new Map<string, { col: number; row: number }>();
  for (const c of concepts) {
    const col = depthOf(c.id);
    const row = rows.get(col) ?? 0;
    rows.set(col, row + 1);
    out.set(c.id, { col, row });
  }
  return out;
}
