import type { PaperItemDto, PaperReading, ReviewPaperRequest } from "@adhyaapak/shared";

/** The teacher's working answer for one question while reviewing a sheet. `choice` is null until something is chosen. */
export interface DraftItem {
  questionId: string;
  choice: PaperReading | null;
  /** True once the teacher has chosen an answer for this question themselves. */
  confirmed: boolean;
}

/** Starts from the teacher's saved review if there is one, otherwise from what the reader saw. Nothing is confirmed yet. */
export function initialDraft(items: readonly PaperItemDto[]): DraftItem[] {
  return items.map((i) => ({
    questionId: i.questionId,
    choice: i.reviewed?.reading ?? i.extracted?.reading ?? null,
    confirmed: i.reviewed?.confirmed ?? false,
  }));
}

/** Choosing an answer is the teacher's own decision, so it counts as confirmed. */
export function choose(draft: readonly DraftItem[], questionId: string, choice: PaperReading): DraftItem[] {
  return draft.map((d) => (d.questionId === questionId ? { ...d, choice, confirmed: true } : d));
}

/** Questions the teacher still has to settle: nothing chosen, or not read clearly and not yet confirmed. */
export function unsettled(items: readonly PaperItemDto[], draft: readonly DraftItem[]): string[] {
  return items.filter((i) => {
    const d = draft.find((x) => x.questionId === i.questionId);
    return !d || d.choice === null || (i.needsDecision && !d.confirmed);
  }).map((i) => i.questionId);
}

/** The request body for saving the review, or null while any question has no answer chosen. */
export function toRequest(draft: readonly DraftItem[]): ReviewPaperRequest | null {
  if (draft.length === 0 || draft.some((d) => d.choice === null)) return null;
  return { items: draft.map((d) => ({ questionId: d.questionId, reading: d.choice!, confirmed: d.confirmed })) };
}

export const readingKey = (r: PaperReading | null): string => (r === null ? "none" : r.kind === "option" ? `option:${r.optionId}` : r.kind);
