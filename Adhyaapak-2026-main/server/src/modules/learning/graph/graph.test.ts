import { describe, expect, it } from "vitest";
import { ConceptGraph, GraphValidationError, validateGraph } from "./graph";

const e = (p: string, d: string) => ({ prerequisiteId: p, dependentId: d });

// mult -> equiv -> common -> add -> word ; fact -> equiv
const nodes = ["mult", "part", "equiv", "common", "add", "word"];
const edges = [e("mult", "equiv"), e("part", "equiv"), e("equiv", "common"), e("common", "add"), e("add", "word")];

describe("validateGraph", () => {
  it("accepts a valid graph", () => {
    expect(validateGraph(nodes, edges)).toEqual([]);
  });

  it("reports duplicate nodes, self edges, missing nodes and duplicate edges", () => {
    const issues = validateGraph(["a", "b", "a"], [e("a", "a"), e("a", "zzz"), e("a", "b"), e("a", "b")]);
    expect(issues.map((i) => i.type).sort()).toEqual(["duplicate_edge", "duplicate_node", "missing_node", "self_edge"]);
  });

  it("detects a two-node cycle and returns its path", () => {
    const issues = validateGraph(["a", "b"], [e("a", "b"), e("b", "a")]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.type).toBe("cycle");
    expect(issues[0]!.nodes[0]).toBe(issues[0]!.nodes.at(-1));
  });

  it("detects a long cycle hidden behind acyclic branches", () => {
    const n = ["a", "b", "c", "d", "e"];
    const issues = validateGraph(n, [e("a", "b"), e("b", "c"), e("c", "d"), e("d", "b"), e("a", "e")]);
    const cycle = issues.find((i) => i.type === "cycle")!;
    expect(new Set(cycle.nodes)).toEqual(new Set(["b", "c", "d"]));
  });

  it("is not fooled by a diamond (two paths to the same node)", () => {
    expect(validateGraph(["a", "b", "c", "d"], [e("a", "b"), e("a", "c"), e("b", "d"), e("c", "d")])).toEqual([]);
  });
});

describe("ConceptGraph", () => {
  const g = new ConceptGraph(nodes, edges);

  it("refuses to build an invalid graph", () => {
    expect(() => new ConceptGraph(["a", "b"], [e("a", "b"), e("b", "a")])).toThrow(GraphValidationError);
  });

  it("returns direct prerequisites and dependents in curriculum order", () => {
    expect(g.directPrerequisites("equiv")).toEqual(["mult", "part"]);
    expect(g.directDependents("equiv")).toEqual(["common"]);
    expect(g.directPrerequisites("mult")).toEqual([]);
  });

  it("returns all ancestors nearest first, with distances", () => {
    expect(g.ancestors("add")).toEqual([
      { id: "common", distance: 1 },
      { id: "equiv", distance: 2 },
      { id: "mult", distance: 3 },
      { id: "part", distance: 3 },
    ]);
  });

  it("limits how far up it looks", () => {
    expect(g.ancestors("add", { maxDepth: 2 }).map((a) => a.id)).toEqual(["common", "equiv"]);
    expect(g.ancestors("add", { maxDepth: 0 })).toEqual([]);
  });

  it("uses the shortest distance when a concept is reachable two ways", () => {
    const d = new ConceptGraph(["a", "b", "c"], [e("a", "b"), e("b", "c"), e("a", "c")]);
    expect(d.ancestors("c")).toEqual([
      { id: "a", distance: 1 },
      { id: "b", distance: 1 },
    ]);
  });

  it("returns descendants and answers isPrerequisiteOf", () => {
    expect(g.descendants("equiv").map((x) => x.id)).toEqual(["common", "add", "word"]);
    expect(g.isPrerequisiteOf("mult", "word")).toBe(true);
    expect(g.isPrerequisiteOf("word", "mult")).toBe(false);
    expect(g.isPrerequisiteOf("mult", "mult")).toBe(false);
  });

  it("produces a learning sequence where every concept follows its prerequisites, deterministically", () => {
    const seq = g.learningSequence();
    expect(seq).toEqual(["mult", "part", "equiv", "common", "add", "word"]);
    for (const ed of edges) expect(seq.indexOf(ed.prerequisiteId)).toBeLessThan(seq.indexOf(ed.dependentId));
    expect(new ConceptGraph([...nodes], [...edges]).learningSequence()).toEqual(seq);
  });

  it("sequences correctly even when the node list is not already in teaching order", () => {
    const shuffled = new ConceptGraph(["word", "add", "common", "equiv", "part", "mult"], edges);
    const seq = shuffled.learningSequence();
    for (const ed of edges) expect(seq.indexOf(ed.prerequisiteId)).toBeLessThan(seq.indexOf(ed.dependentId));
  });

  it("builds the relevant path to a concept", () => {
    expect(g.learningPathTo("common")).toEqual(["mult", "part", "equiv", "common"]);
    expect(g.learningPathTo("common", { maxDepth: 1 })).toEqual(["equiv", "common"]);
    expect(g.learningPathTo("mult")).toEqual(["mult"]);
  });

  it("throws on unknown concepts instead of returning silently wrong answers", () => {
    expect(() => g.ancestors("nope")).toThrow(/Unknown concept/);
  });
});
