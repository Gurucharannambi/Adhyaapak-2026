/** An edge from A to B means A is a prerequisite for B (CLAUDE.md §3). */
export interface Edge {
  prerequisiteId: string;
  dependentId: string;
}

export type GraphIssueType = "duplicate_node" | "self_edge" | "missing_node" | "duplicate_edge" | "cycle";

export interface GraphIssue {
  type: GraphIssueType;
  detail: string;
  /** Nodes involved. For a cycle, the nodes in order, with the first node repeated at the end. */
  nodes: string[];
}

export class GraphValidationError extends Error {
  constructor(readonly issues: GraphIssue[]) {
    super(`Invalid concept graph: ${issues.map((i) => i.detail).join("; ")}`);
    this.name = "GraphValidationError";
  }
}

/**
 * Deterministic graph checks. The LLM is never asked whether a graph is valid (CLAUDE.md §3).
 * Also used in Phase 5 to vet AI-proposed graphs before a teacher sees them.
 */
export function validateGraph(nodeIds: readonly string[], edges: readonly Edge[]): GraphIssue[] {
  const issues: GraphIssue[] = [];

  const seen = new Set<string>();
  for (const id of nodeIds) {
    if (seen.has(id)) issues.push({ type: "duplicate_node", detail: `Concept "${id}" appears more than once`, nodes: [id] });
    seen.add(id);
  }

  const edgeKeys = new Set<string>();
  const usable: Edge[] = [];
  for (const e of edges) {
    if (e.prerequisiteId === e.dependentId) {
      issues.push({ type: "self_edge", detail: `Concept "${e.prerequisiteId}" cannot be its own prerequisite`, nodes: [e.prerequisiteId] });
      continue;
    }
    const missing = [e.prerequisiteId, e.dependentId].filter((n) => !seen.has(n));
    if (missing.length) {
      issues.push({ type: "missing_node", detail: `Edge ${e.prerequisiteId} -> ${e.dependentId} refers to unknown concept(s): ${missing.join(", ")}`, nodes: missing });
      continue;
    }
    const key = `${e.prerequisiteId}\u0000${e.dependentId}`;
    if (edgeKeys.has(key)) {
      issues.push({ type: "duplicate_edge", detail: `Edge ${e.prerequisiteId} -> ${e.dependentId} is listed twice`, nodes: [e.prerequisiteId, e.dependentId] });
      continue;
    }
    edgeKeys.add(key);
    usable.push(e);
  }

  const cycle = findCycle([...seen], usable);
  if (cycle) {
    issues.push({ type: "cycle", detail: `Prerequisite cycle: ${cycle.join(" -> ")}`, nodes: cycle });
  }
  return issues;
}

/** Returns one cycle as a node path (first node repeated at the end), or undefined if the graph is acyclic. */
function findCycle(nodes: string[], edges: Edge[]): string[] | undefined {
  const next = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const e of edges) next.get(e.prerequisiteId)!.push(e.dependentId);

  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (n: string): string[] | undefined => {
    state.set(n, "visiting");
    stack.push(n);
    for (const m of next.get(n)!) {
      if (state.get(m) === "visiting") return [...stack.slice(stack.indexOf(m)), m];
      if (!state.has(m)) {
        const found = visit(m);
        if (found) return found;
      }
    }
    stack.pop();
    state.set(n, "done");
    return undefined;
  };

  for (const n of nodes) {
    if (!state.has(n)) {
      const found = visit(n);
      if (found) return found;
    }
  }
  return undefined;
}

export interface Ancestor {
  id: string;
  /** 1 = direct prerequisite, 2 = prerequisite of a prerequisite, and so on (shortest path). */
  distance: number;
}

/** An immutable, validated prerequisite graph with the traversals the learning engines need. */
export class ConceptGraph {
  private readonly order: Map<string, number>;
  private readonly prereqs = new Map<string, string[]>();
  private readonly dependents = new Map<string, string[]>();

  /** `nodeIds` order is the tie-break for sequences, so pass concepts in curriculum order. */
  constructor(readonly nodeIds: readonly string[], edges: readonly Edge[]) {
    const issues = validateGraph(nodeIds, edges);
    if (issues.length) throw new GraphValidationError(issues);

    this.order = new Map(nodeIds.map((id, i) => [id, i]));
    for (const id of nodeIds) {
      this.prereqs.set(id, []);
      this.dependents.set(id, []);
    }
    for (const e of edges) {
      this.prereqs.get(e.dependentId)!.push(e.prerequisiteId);
      this.dependents.get(e.prerequisiteId)!.push(e.dependentId);
    }
    for (const list of [...this.prereqs.values(), ...this.dependents.values()]) list.sort((a, b) => this.order.get(a)! - this.order.get(b)!);
  }

  has(id: string): boolean {
    return this.order.has(id);
  }

  private require(id: string): void {
    if (!this.order.has(id)) throw new Error(`Unknown concept "${id}"`);
  }

  directPrerequisites(id: string): string[] {
    this.require(id);
    return [...this.prereqs.get(id)!];
  }

  directDependents(id: string): string[] {
    this.require(id);
    return [...this.dependents.get(id)!];
  }

  /** All prerequisites, nearest first (ties in curriculum order). `maxDepth` limits how far up to look. */
  ancestors(id: string, opts: { maxDepth?: number } = {}): Ancestor[] {
    this.require(id);
    const limit = opts.maxDepth ?? Infinity;
    const dist = new Map<string, number>();
    let frontier = [id];
    for (let d = 1; d <= limit && frontier.length; d++) {
      const nextFrontier: string[] = [];
      for (const n of frontier) {
        for (const p of this.prereqs.get(n)!) {
          if (!dist.has(p)) {
            dist.set(p, d);
            nextFrontier.push(p);
          }
        }
      }
      frontier = nextFrontier;
    }
    return [...dist.entries()]
      .map(([nodeId, distance]) => ({ id: nodeId, distance }))
      .sort((a, b) => a.distance - b.distance || this.order.get(a.id)! - this.order.get(b.id)!);
  }

  /** Everything that builds on this concept, nearest first. */
  descendants(id: string): Ancestor[] {
    this.require(id);
    const dist = new Map<string, number>();
    let frontier = [id];
    for (let d = 1; frontier.length; d++) {
      const nextFrontier: string[] = [];
      for (const n of frontier) {
        for (const m of this.dependents.get(n)!) {
          if (!dist.has(m)) {
            dist.set(m, d);
            nextFrontier.push(m);
          }
        }
      }
      frontier = nextFrontier;
    }
    return [...dist.entries()]
      .map(([nodeId, distance]) => ({ id: nodeId, distance }))
      .sort((a, b) => a.distance - b.distance || this.order.get(a.id)! - this.order.get(b.id)!);
  }

  isPrerequisiteOf(a: string, b: string): boolean {
    return this.ancestors(b).some((x) => x.id === a);
  }

  /** The whole graph in teaching order: every concept after all of its prerequisites. Deterministic. */
  learningSequence(): string[] {
    const remaining = new Map(this.nodeIds.map((id) => [id, this.prereqs.get(id)!.length]));
    const out: string[] = [];
    const ready = this.nodeIds.filter((id) => remaining.get(id) === 0);
    while (ready.length) {
      ready.sort((a, b) => this.order.get(a)! - this.order.get(b)!);
      const n = ready.shift()!;
      out.push(n);
      for (const m of this.dependents.get(n)!) {
        const left = remaining.get(m)! - 1;
        remaining.set(m, left);
        if (left === 0) ready.push(m);
      }
    }
    return out;
  }

  /** What to teach, in order, to reach `id`: its prerequisites (to `maxDepth`) followed by the concept itself. */
  learningPathTo(id: string, opts: { maxDepth?: number } = {}): string[] {
    this.require(id);
    const wanted = new Set([id, ...this.ancestors(id, opts).map((a) => a.id)]);
    return this.learningSequence().filter((n) => wanted.has(n));
  }
}
