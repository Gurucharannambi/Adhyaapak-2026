import { describe, expect, it } from "vitest";
import type { PaperItemDto } from "@adhyaapak/shared";
import { choose, initialDraft, toRequest, unsettled } from "./review-state";

const item = (id: string, over: Partial<PaperItemDto> = {}): PaperItemDto => ({
  questionId: id, position: 1, stem: "1/2 + 1/3", options: [{ id: "a", text: "2/5" }, { id: "b", text: "5/6" }],
  extracted: { reading: { kind: "option", optionId: "b" }, legibility: "clear", note: null }, reviewed: null, needsDecision: false, ...over,
});
const unsure = (id: string) => item(id, { extracted: { reading: { kind: "option", optionId: "a" }, legibility: "unsure", note: "faint" }, needsDecision: true });
const unread = (id: string) => item(id, { extracted: null, needsDecision: true });

describe("review draft", () => {
  it("starts from what was read, with nothing confirmed", () => {
    const d = initialDraft([item("q1"), unread("q2")]);
    expect(d).toEqual([{ questionId: "q1", choice: { kind: "option", optionId: "b" }, confirmed: false }, { questionId: "q2", choice: null, confirmed: false }]);
  });

  it("prefers the teacher's saved review", () => {
    const d = initialDraft([item("q1", { reviewed: { reading: { kind: "blank" }, confirmed: true } })]);
    expect(d[0]).toEqual({ questionId: "q1", choice: { kind: "blank" }, confirmed: true });
  });

  it("a clearly read answer needs no extra click, but an unsure or unread one does", () => {
    const items = [item("q1"), unsure("q2"), unread("q3")];
    let d = initialDraft(items);
    expect(unsettled(items, d)).toEqual(["q2", "q3"]);
    d = choose(d, "q2", { kind: "option", optionId: "a" }); // agreeing with the reader still counts as the teacher's decision
    expect(unsettled(items, d)).toEqual(["q3"]);
    d = choose(d, "q3", { kind: "unreadable" });
    expect(unsettled(items, d)).toEqual([]);
  });

  it("builds a request only when every question has an answer", () => {
    const items = [item("q1"), unread("q2")];
    expect(toRequest(initialDraft(items))).toBeNull();
    const d = choose(initialDraft(items), "q2", { kind: "blank" });
    expect(toRequest(d)).toEqual({ items: [{ questionId: "q1", reading: { kind: "option", optionId: "b" }, confirmed: false }, { questionId: "q2", reading: { kind: "blank" }, confirmed: true }] });
  });
});
