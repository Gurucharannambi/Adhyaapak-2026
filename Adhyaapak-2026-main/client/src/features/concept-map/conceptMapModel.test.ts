import { describe, expect, it } from "vitest";
import { followUps, nodeFacts, placeNodes } from "./conceptMapModel";

describe("concept map model", () => {
  it("describes a concept from recorded counts only, and calls an unassessed one quiet", () => {
    const f = nodeFacts({ not_enough_evidence: 3, needs_foundation: 2, developing: 1, likely_secure: 0, ready_for_challenge: 0 }, 6);
    expect(f).toEqual({ withEvidence: 3, classSize: 6, quiet: false, present: [{ status: "needs_foundation", count: 2 }, { status: "developing", count: 1 }] });
    expect(nodeFacts({ not_enough_evidence: 6 }, 6).quiet).toBe(true);
    expect(nodeFacts(undefined, 6)).toMatchObject({ quiet: true, withEvidence: 0, present: [] });
  });

  it("places concepts left to right by how many earlier ideas they build on", () => {
    const pos = placeNodes([
      { id: "a", prerequisiteIds: [] },
      { id: "b", prerequisiteIds: ["a"] },
      { id: "c", prerequisiteIds: ["a"] },
      { id: "d", prerequisiteIds: ["b", "c"] },
    ]);
    expect(pos.get("a")).toEqual({ col: 0, row: 0 });
    expect(pos.get("b")).toEqual({ col: 1, row: 0 });
    expect(pos.get("c")).toEqual({ col: 1, row: 1 });
    expect(pos.get("d")).toEqual({ col: 2, row: 0 });
  });

  it("survives a link to a concept outside the chapter and a bad loop", () => {
    expect(placeNodes([{ id: "a", prerequisiteIds: ["elsewhere"] }]).get("a")).toEqual({ col: 0, row: 0 });
    expect(() => placeNodes([{ id: "a", prerequisiteIds: ["b"] }, { id: "b", prerequisiteIds: ["a"] }])).not.toThrow();
  });

  it("suggests a follow-up only when the evidence supports it, with the reason attached", () => {
    const facts = nodeFacts({ needs_foundation: 4, developing: 1 }, 8);
    const steps = followUps({ facts, prerequisites: [{ id: "p1", title: "Equivalent fractions" }], patterns: [{ name: "Adds the denominators", studentCount: 3 }] });
    expect(steps.map((s) => s.label)).toEqual(["Look at the earlier idea: Equivalent fractions", "Check the possible pattern: Adds the denominators"]);
    expect(steps[0]!.why).toContain("4 of 5 students with evidence need foundation");
    expect(steps[1]!.why).toMatch(/provisional/);
    expect(followUps({ facts: nodeFacts({ not_enough_evidence: 8 }, 8), prerequisites: [{ id: "p1", title: "x" }], patterns: [] })).toEqual([]);
  });
});
