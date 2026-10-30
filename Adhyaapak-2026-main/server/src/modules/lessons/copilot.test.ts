import { describe, expect, it } from "vitest";
import { buildCopilot, type CopilotFacts } from "./copilot";

const facts = (over: Partial<CopilotFacts> = {}): CopilotFacts => ({
  answered: 20,
  studentCount: 30,
  patterns: [],
  correctRate: 0.5,
  prerequisites: [],
  levelsAvailable: ["foundation", "guided", "challenge"],
  challengeQuestion: { id: "q9", stem: "3/4 + 5/6 = ?" },
  aiAvailable: true,
  ...over,
});
const kinds = (r: ReturnType<typeof buildCopilot>) => r.suggestions.map((s) => s.kind);

describe("copilot", () => {
  it("says there is not enough information, and suggests nothing, when nobody has answered", () => {
    const r = buildCopilot(facts({ answered: 0, correctRate: null }));
    expect(r.basis).toBe("no_evidence");
    expect(r.message).toMatch(/not enough information/i);
    expect(r.suggestions).toEqual([]);
  });

  it("asks for more answers instead of interpreting a handful", () => {
    const r = buildCopilot(facts({ answered: 2, correctRate: 0, patterns: [{ name: "Adds the denominators", studentCount: 2 }] }));
    expect(r.basis).toBe("thin");
    expect(kinds(r)).toEqual(["collect_more"]);
    expect(r.suggestions[0]).toMatchObject({ certainty: "low", action: null });
    // Even with a pattern in those two answers, no misconception is claimed.
    expect(JSON.stringify(r)).not.toMatch(/visual explanation|parallel/i);
  });

  it("a common error pattern leads to a visual explanation and a parallel example, with its evidence and no overclaiming", () => {
    const r = buildCopilot(facts({ patterns: [{ name: "Adds the denominators", studentCount: 8 }], correctRate: 0.4 }));
    expect(kinds(r)).toEqual(["visual_explanation", "parallel_example"]);
    const visual = r.suggestions[0]!;
    expect(visual.evidence).toContain('8 answers matched the pattern "Adds the denominators"');
    expect(visual.evidence).toContain("40% of recorded answers were right");
    expect(visual.why).toMatch(/possible misunderstanding, not a confirmed one/);
    expect(visual.certainty).toBe("medium"); // a pattern is never "high"
    expect(visual.action).toEqual({ type: "preview_resource", level: "foundation" });
    expect(r.suggestions.every((s) => s.certainty !== "high")).toBe(true);
  });

  it("only offers AI drafting when the AI is available, and falls back to the lesson's own example when it is not", () => {
    const withAi = buildCopilot(facts({ patterns: [{ name: "P", studentCount: 8 }] }));
    expect(withAi.suggestions.find((s) => s.kind === "parallel_example")!.action).toEqual({ type: "prepare_ai_draft", level: "guided" });
    const without = buildCopilot(facts({ patterns: [{ name: "P", studentCount: 8 }], aiAvailable: false }));
    const fallback = without.suggestions.find((s) => s.kind === "parallel_example")!;
    expect(fallback.action).toEqual({ type: "preview_resource", level: "guided" });
    expect(fallback.why).toMatch(/not available right now/);
    expect(without.aiAvailable).toBe(false);
  });

  it("suggests checking an earlier idea only when enough students were assessed on it and some are not secure", () => {
    const weak = buildCopilot(facts({ patterns: [{ name: "P", studentCount: 8 }], prerequisites: [{ conceptId: "c-eq", title: "Equivalent fractions", assessed: 20, notSecure: 9 }] }));
    const s = weak.suggestions.find((x) => x.kind === "prerequisite_check")!;
    expect(s.action).toEqual({ type: "launch_prerequisite_check", conceptId: "c-eq", conceptTitle: "Equivalent fractions" });
    expect(s.evidence).toEqual(["9 of 20 not yet secure on Equivalent fractions"]);
    const thin = buildCopilot(facts({ patterns: [{ name: "P", studentCount: 8 }], prerequisites: [{ conceptId: "c-eq", title: "Equivalent fractions", assessed: 2, notSecure: 2 }] }));
    expect(kinds(thin)).not.toContain("prerequisite_check");
  });

  it("when the class is secure: move on, plus an extension question from the approved bank", () => {
    const r = buildCopilot(facts({ correctRate: 0.9 }));
    expect(kinds(r)).toEqual(["move_on", "extension"]);
    expect(r.suggestions[0]!.certainty).toBe("high");
    expect(r.suggestions[1]!.action).toEqual({ type: "preview_question", questionId: "q9", stem: "3/4 + 5/6 = ?" });
    expect(kinds(buildCopilot(facts({ correctRate: 0.9, challengeQuestion: null })))).toEqual(["move_on"]);
  });

  it("is not 'high' certainty when fewer than half the class answered", () => {
    expect(buildCopilot(facts({ answered: 10, studentCount: 30, correctRate: 0.9 })).suggestions[0]!.certainty).toBe("medium");
  });

  it("when the answers do not point anywhere, says so instead of inventing a suggestion", () => {
    const r = buildCopilot(facts({ correctRate: 0.3, patterns: [] }));
    expect(r.suggestions).toEqual([]);
    expect(r.message).toMatch(/do not point to a clear next step/);
  });

  it("is deterministic: the same answers always give the same suggestions", () => {
    const f = facts({ patterns: [{ name: "P", studentCount: 8 }], correctRate: 0.4 });
    expect(buildCopilot(f)).toEqual(buildCopilot({ ...f }));
  });
});
