import { describe, expect, it } from "vitest";
import { buildLessonFlow, type FlowQuestion } from "./lesson-flow";

const q = (key: string, role: FlowQuestion["role"], difficulty: number, revealsMisconception = false): FlowQuestion => ({ id: `id-${key}`, key, role, difficulty, revealsMisconception });
const seg = (flow: ReturnType<typeof buildLessonFlow>, key: string) => flow.find((s) => s.key === key)!.questionIds;

describe("buildLessonFlow", () => {
  it("always returns the five segments in teaching order with suggested minutes", () => {
    const flow = buildLessonFlow([]);
    expect(flow.map((s) => s.key)).toEqual(["hook", "teach", "check", "practise", "exit_ticket"]);
    expect(flow.map((s) => s.minutes)).toEqual([3, 10, 5, 10, 3]);
    expect(flow.every((s) => s.questionIds.length === 0)).toBe(true);
  });

  it("starts with the gentlest diagnostic question and puts revealing questions in the check", () => {
    const flow = buildLessonFlow([q("d1", "diagnostic", 1), q("d2", "diagnostic", 2, true), q("d3", "diagnostic", 3, true), q("d4", "diagnostic", 4), q("g1", "guided", 2), q("c1", "challenge", 4)]);
    expect(seg(flow, "hook")).toEqual(["id-d1"]);
    expect(seg(flow, "check")).toEqual(["id-d2", "id-d3", "id-d4"]);
    expect(seg(flow, "practise")).toEqual(["id-g1", "id-c1"]);
  });

  it("never uses a question twice", () => {
    const flow = buildLessonFlow([q("d1", "diagnostic", 1), q("d2", "diagnostic", 2), q("d3", "diagnostic", 2), q("g1", "guided", 2), q("g2", "guided", 3), q("g3", "guided", 3), q("g4", "guided", 4), q("c1", "challenge", 4)]);
    const all = flow.flatMap((s) => s.questionIds);
    expect(new Set(all).size).toBe(all.length);
  });

  it("with a small bank, leaves the exit ticket empty rather than repeating a question", () => {
    const flow = buildLessonFlow([q("d1", "diagnostic", 1), q("d2", "diagnostic", 2, true)]);
    expect(seg(flow, "hook")).toEqual(["id-d1"]);
    expect(seg(flow, "check")).toEqual(["id-d2"]);
    expect(seg(flow, "exit_ticket")).toEqual([]);
  });

  it("falls back to an unused guided question for the exit ticket", () => {
    const flow = buildLessonFlow([q("d1", "diagnostic", 1), q("d2", "diagnostic", 2), q("g1", "guided", 2), q("g2", "guided", 3), q("g3", "guided", 3), q("g4", "guided", 4)]);
    expect(seg(flow, "exit_ticket")).toHaveLength(1);
    expect(seg(flow, "practise")).toHaveLength(3);
  });

  it("is deterministic regardless of input order", () => {
    const list = [q("d2", "diagnostic", 2, true), q("g1", "guided", 2), q("d1", "diagnostic", 1), q("c1", "challenge", 4)];
    expect(buildLessonFlow(list)).toEqual(buildLessonFlow([...list].reverse()));
  });
});
