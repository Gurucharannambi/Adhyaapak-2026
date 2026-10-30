export interface LayoutNode {
  id: string;
  /** Column: how many steps of prerequisites come before this concept. */
  depth: number;
  /** Row within its column. */
  row: number;
}

/**
 * Places concepts in columns by how many prerequisites sit before them (the longest chain), so the
 * graph reads left to right in teaching order. Rejected prerequisites are not drawn. Deterministic.
 * Safe on bad input: a loop (which the server never allows) is cut instead of recursing forever.
 */
export function layoutGraph(concepts: ReadonlyArray<{ id: string; position: number }>, edges: ReadonlyArray<{ prerequisiteConceptId: string; dependentConceptId: string; decision: string }>): LayoutNode[] {
  const drawn = edges.filter((e) => e.decision !== "rejected");
  const prereqs = new Map<string, string[]>(concepts.map((c) => [c.id, []]));
  for (const e of drawn) prereqs.get(e.dependentConceptId)?.push(e.prerequisiteConceptId);

  const depth = new Map<string, number>();
  const visiting = new Set<string>();
  const depthOf = (id: string): number => {
    if (depth.has(id)) return depth.get(id)!;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const d = Math.max(-1, ...(prereqs.get(id) ?? []).map(depthOf)) + 1;
    visiting.delete(id);
    depth.set(id, d);
    return d;
  };

  const ordered = [...concepts].sort((a, b) => a.position - b.position);
  const rows = new Map<number, number>();
  return ordered.map((c) => {
    const d = depthOf(c.id);
    const row = rows.get(d) ?? 0;
    rows.set(d, row + 1);
    return { id: c.id, depth: d, row };
  });
}
