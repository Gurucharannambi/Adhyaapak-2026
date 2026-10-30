import { z } from "zod";
import { validateGraph } from "../learning/graph/graph";
import { normalizeForMatch, quoteIsInDocument } from "./grounding";

export const MAX_CONCEPTS = 25;
export const MAX_EDGES = 60;

/**
 * What we ask the model for. Loose on purpose (the provider's strict schema mode rejects length and
 * range keywords); every limit is enforced below instead.
 */
export const SyllabusGraphOutput = z.object({
  concepts: z.array(z.object({ key: z.string(), title: z.string(), description: z.string(), learningObjective: z.string(), evidence: z.string().nullable() })),
  prerequisites: z.array(z.object({ prerequisite: z.string(), dependent: z.string(), evidence: z.string().nullable(), confidence: z.string() })),
});
export type SyllabusGraphOutput = z.infer<typeof SyllabusGraphOutput>;

export interface PlannedConcept {
  key: string;
  title: string;
  description: string;
  learningObjective: string;
  evidenceQuote: string | null;
  grounded: boolean;
  position: number;
}

export interface PlannedEdge {
  prerequisiteKey: string;
  dependentKey: string;
  evidenceQuote: string | null;
  grounding: "document" | "inferred";
  confidence: "high" | "medium" | "low";
  /** Inferred or low-confidence edges start pending and need the teacher's decision. */
  decision: "pending" | "accepted";
}

export interface Plan {
  concepts: PlannedConcept[];
  edges: PlannedEdge[];
  /** Everything our checks changed or dropped, in plain words, for the teacher. */
  notes: string[];
}

export const slugify = (s: string): string =>
  s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

/** Removes markup-like characters and squeezes whitespace. Output is plain text, never HTML. */
const plain = (s: string, max: number): string => s.replace(/<[^>]*>/g, " ").replace(/[<>`]/g, "").replace(/\s+/g, " ").trim().slice(0, max);

const STOP_WORDS = new Set(["with", "and", "the", "for", "from", "into", "using", "their", "that", "this", "about"]);
/** First four letters of each meaningful word, so "dividing" and "division" both become "divi". */
const stems = (title: string): string[] =>
  normalizeForMatch(title)
    .split(" ")
    .filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
    .map((w) => w.slice(0, 4));

/**
 * Words that identify each concept, leaving out words most concepts share (such as "integers" in a
 * unit on integers), which would make any sentence look relevant.
 */
function distinctiveStems(conceptList: ReadonlyArray<{ key: string; title: string }>): Map<string, Set<string>> {
  const count = new Map<string, number>();
  for (const c of conceptList) for (const s of new Set(stems(c.title))) count.set(s, (count.get(s) ?? 0) + 1);
  const common = Math.max(3, Math.ceil(conceptList.length * 0.4));
  return new Map(conceptList.map((c) => [c.key, new Set(stems(c.title).filter((s) => (count.get(s) ?? 0) < common))]));
}

/** A quote supports a prerequisite only if it talks about both concepts. A sentence that is merely in the document does not. */
function quoteMentions(quote: string, wanted: ReadonlySet<string>): boolean {
  if (wanted.size === 0) return true; // nothing distinctive to look for: do not penalise
  const words = new Set(stems(quote));
  for (const s of wanted) if (words.has(s)) return true;
  return false;
}

const normalizeConfidence = (c: string): PlannedEdge["confidence"] => (/^(high|medium|low)$/i.test(c.trim()) ? (c.trim().toLowerCase() as PlannedEdge["confidence"]) : "low");

const score = (e: PlannedEdge) => (e.grounding === "document" ? 2 : 0) + { high: 2, medium: 1, low: 0 }[e.confidence];

/**
 * Turns raw model output into a proposal we are willing to show a teacher. Deterministic. It:
 *  - cleans every text field and enforces length and count limits;
 *  - keeps a quote only if it really occurs in the document, and marks anything else "inferred";
 *  - drops references to concepts that do not exist, self-references and duplicates;
 *  - breaks prerequisite loops by removing the weakest edge in each, so the result is always acyclic;
 *  - never accepts an inferred or low-confidence edge on the teacher's behalf.
 */
export function buildProposal(output: SyllabusGraphOutput, documentText: string): Plan {
  const notes: string[] = [];
  const doc = normalizeForMatch(documentText);

  // ---- concepts
  const concepts: PlannedConcept[] = [];
  const keys = new Set<string>();
  let dropped = 0;
  let duplicates = 0;
  for (const c of output.concepts) {
    const title = plain(c.title, 80);
    const key = slugify(c.key) || slugify(title);
    if (!title || !key) {
      dropped++;
      continue;
    }
    if (keys.has(key)) {
      duplicates++;
      continue;
    }
    if (concepts.length >= MAX_CONCEPTS) {
      dropped++;
      continue;
    }
    keys.add(key);
    const grounded = quoteIsInDocument(c.evidence, doc);
    concepts.push({
      key,
      title,
      description: plain(c.description, 300) || title,
      learningObjective: plain(c.learningObjective, 200) || `Understand ${title.toLowerCase()}.`,
      evidenceQuote: grounded ? plain(c.evidence!, 300) : null,
      grounded,
      position: concepts.length + 1,
    });
  }
  if (duplicates) notes.push(`${duplicates} duplicate concept${duplicates === 1 ? " was" : "s were"} merged.`);
  if (dropped) notes.push(`${dropped} concept${dropped === 1 ? " was" : "s were"} left out (empty, or more than ${MAX_CONCEPTS} concepts).`);

  // ---- edges
  const edges: PlannedEdge[] = [];
  const seen = new Set<string>();
  const distinctive = distinctiveStems(concepts);
  let offTopic = 0;
  let unknown = 0;
  let selfRefs = 0;
  let dupEdges = 0;
  let capped = 0;
  for (const p of output.prerequisites) {
    const a = slugify(p.prerequisite);
    const b = slugify(p.dependent);
    if (!keys.has(a) || !keys.has(b)) {
      unknown++;
      continue;
    }
    if (a === b) {
      selfRefs++;
      continue;
    }
    const id = `${a}\u0000${b}`;
    if (seen.has(id)) {
      dupEdges++;
      continue;
    }
    if (edges.length >= MAX_EDGES) {
      capped++;
      continue;
    }
    seen.add(id);
    const inDocument = quoteIsInDocument(p.evidence, doc);
    // A real quote that does not mention both concepts proves nothing about this pair.
    const grounded = inDocument && quoteMentions(p.evidence!, distinctive.get(a)!) && quoteMentions(p.evidence!, distinctive.get(b)!);
    if (inDocument && !grounded) offTopic++;
    const confidence = normalizeConfidence(p.confidence);
    const grounding = grounded ? "document" : "inferred";
    edges.push({
      prerequisiteKey: a,
      dependentKey: b,
      evidenceQuote: grounded ? plain(p.evidence!, 300) : null,
      grounding,
      confidence,
      decision: grounding === "inferred" || confidence === "low" ? "pending" : "accepted",
    });
  }
  if (offTopic) notes.push(`${offTopic} prerequisite${offTopic === 1 ? " quoted" : "s quoted"} a real passage that does not mention both concepts, so ${offTopic === 1 ? "it is" : "they are"} shown as not backed by the document.`);
  if (unknown) notes.push(`${unknown} prerequisite${unknown === 1 ? " referred" : "s referred"} to a concept that does not exist and ${unknown === 1 ? "was" : "were"} dropped.`);
  if (selfRefs) notes.push(`${selfRefs} concept${selfRefs === 1 ? " was" : "s were"} listed as their own prerequisite and ignored.`);
  if (dupEdges) notes.push(`${dupEdges} repeated prerequisite${dupEdges === 1 ? " was" : "s were"} merged.`);
  if (capped) notes.push(`${capped} prerequisite${capped === 1 ? " was" : "s were"} left out (limit of ${MAX_EDGES}).`);

  // ---- loops
  const title = new Map(concepts.map((c) => [c.key, c.title]));
  for (let guard = 0; guard < 200; guard++) {
    const cycle = validateGraph(concepts.map((c) => c.key), edges.map((e) => ({ prerequisiteId: e.prerequisiteKey, dependentId: e.dependentKey }))).find((i) => i.type === "cycle");
    if (!cycle) break;
    let weakest = -1;
    for (let i = 0; i < cycle.nodes.length - 1; i++) {
      const idx = edges.findIndex((e) => e.prerequisiteKey === cycle.nodes[i] && e.dependentKey === cycle.nodes[i + 1]);
      if (idx !== -1 && (weakest === -1 || score(edges[idx]!) <= score(edges[weakest]!))) weakest = idx;
    }
    const [removed] = edges.splice(weakest, 1);
    notes.push(`Removed "${title.get(removed!.prerequisiteKey)} → ${title.get(removed!.dependentKey)}" because it formed a loop (${cycle.nodes.map((k) => title.get(k)).join(" → ")}).`);
  }

  return { concepts, edges, notes };
}
