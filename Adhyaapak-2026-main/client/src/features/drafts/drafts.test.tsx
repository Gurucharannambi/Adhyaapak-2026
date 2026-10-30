import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DraftQuestionDto, DraftResourceDto, DraftsResponse } from "@adhyaapak/shared";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { DraftsPage } from "./DraftsPage";

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const concept = { id: "c1", key: "adding-fractions", title: "Adding fractions", misconceptions: [{ id: "m1", key: "adds-denominators", name: "Adds the denominators" }] };

const question = (over: Partial<DraftQuestionDto> = {}): DraftQuestionDto => ({
  id: "d1", key: "ai-1", role: "diagnostic", difficulty: 2, stem: "1/5 + 2/5 = ?",
  options: [{ id: "a", text: "3/10", misconceptionKey: "adds-denominators" }, { id: "b", text: "3/5", misconceptionKey: null }, { id: "c", text: "2/5", misconceptionKey: null }, { id: "d", text: "1/5", misconceptionKey: null }],
  correctOptionId: "b", explanation: "Add the tops.", provenanceNote: "Drafted by fake/model.", createdAt: "2026-10-01T00:00:00Z",
  check: { status: "verified", issues: [] }, approvable: true, ...over,
});
const resource = (over: Partial<DraftResourceDto> = {}): DraftResourceDto => ({
  id: "r1", key: "ai-res-1", level: "guided", title: "Careful adding", content: { summary: "Make pieces the same size.", steps: ["Find a common denominator."], workedExample: { problem: "Find 1/4 + 1/2.", steps: ["1/2 = 2/4."] }, commonError: null, prompt: null },
  provenanceNote: "Drafted by fake/model.", createdAt: "2026-10-01T00:00:00Z", check: { status: "not_applicable", issues: [] }, approvable: true, ...over,
});

function setup(drafts: Partial<DraftsResponse>, extra: Record<string, () => Promise<Response>> = {}) {
  const calls: Array<{ key: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      calls.push({ key, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (key === "GET /api/v1/concepts/c1") return json(200, concept);
      if (key === "GET /api/v1/concepts/c1/drafts") return json(200, { aiAvailable: true, questionSlotsLeft: 6, questions: [], resources: [], ...drafts });
      if (extra[key]) return extra[key]!();
      throw new Error(`Unmocked request: ${key}`);
    }),
  );
  render(
    <MemoryRouter initialEntries={["/curriculum/concepts/c1/drafts"]}>
      <Routes>
        <Route path="/curriculum/concepts/:conceptId/drafts" element={<DraftsPage />} />
      </Routes>
    </MemoryRouter>,
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("DraftsPage", () => {
  it("with AI off, says so plainly, disables drafting, and still shows drafts that exist", async () => {
    setup({ aiAvailable: false, questions: [question()] });
    expect(await screen.findByText(/AI drafting is turned off or not set up/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draft 2 questions" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Guided" })).toBeDisabled();
    expect(screen.getByDisplayValue("1/5 + 2/5 = ?")).toBeInTheDocument();
  });

  it("asks for drafts, then lists what our checks threw away and why", async () => {
    const calls = setup({}, { "POST /api/v1/concepts/c1/drafts/questions": () => json(201, { drafts: [], discarded: [{ reason: '"1/3 + 1/4 = ?": The marked answer is wrong.' }, { reason: "Two options both say \"1/2\"." }] }) });
    await userEvent.click(await screen.findByRole("button", { name: "Draft 2 questions" }));
    expect(await screen.findByText("Our checks threw away 2 drafts")).toBeInTheDocument();
    expect(screen.getByText(/The marked answer is wrong/)).toBeInTheDocument();
    expect(calls.find((c) => c.key.startsWith("POST"))?.body).toEqual({ count: 2 });
  });

  it("shows a verified draft as such, and approves it without extra confirmation", async () => {
    const calls = setup({ questions: [question()] }, { "POST /api/v1/question-drafts/d1/review": () => json(200, { id: "d1", status: "approved" }) });
    expect(await screen.findByText(/Our code checked the arithmetic/)).toBeInTheDocument();
    expect(screen.getByText(/not visible to students until you approve it/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(calls.find((c) => c.key.endsWith("/review"))?.body).toEqual({ decision: "approve" });
  });

  it("will not approve an unverified question until the teacher confirms they checked it", async () => {
    const calls = setup({ questions: [question({ check: { status: "not_applicable", issues: [] } })] }, { "POST /api/v1/question-drafts/d1/review": () => json(200, { id: "d1", status: "approved" }) });
    expect(await screen.findByText(/Not checked automatically/)).toBeInTheDocument();
    const approve = screen.getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    await userEvent.click(screen.getByLabelText("I read the answer and every option and they are correct."));
    expect(approve).toBeEnabled();
    await userEvent.click(approve);
    expect(calls.find((c) => c.key.endsWith("/review"))?.body).toEqual({ decision: "approve", checkedByHand: true });
  });

  it("blocks approval of a draft whose checks failed, and lists the problems", async () => {
    setup({ questions: [question({ check: { status: "failed", issues: ["The marked answer is wrong: 1/5 + 2/5 is not 2/5."] }, approvable: false })] });
    expect(await screen.findByText(/The marked answer is wrong/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reject" })).toBeEnabled();
  });

  it("saves edits and shows the re-run check", async () => {
    const calls = setup(
      { questions: [question()] },
      { "PATCH /api/v1/question-drafts/d1": () => json(200, question({ check: { status: "failed", issues: ["The marked answer is wrong."] }, approvable: false })) },
    );
    await userEvent.click(await screen.findByLabelText("Option C is the correct answer"));
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByText(/The marked answer is wrong/)).toBeInTheDocument();
    const patch = calls.find((c) => c.key.startsWith("PATCH"))!.body as { correctOptionId: string; options: Array<{ id: string; misconceptionKey: string | null }> };
    expect(patch.correctOptionId).toBe("c");
    expect(patch.options[0]).toMatchObject({ id: "a", misconceptionKey: "adds-denominators" });
  });

  it("explanations always need the teacher's confirmation, and send it with the approval", async () => {
    const calls = setup({ resources: [resource()] }, { "POST /api/v1/resource-drafts/r1/review": () => json(200, { id: "r1", status: "approved" }) });
    const card = (await screen.findByDisplayValue("Careful adding")).closest("article")!;
    const approve = within(card).getByRole("button", { name: "Approve" });
    expect(approve).toBeDisabled();
    await userEvent.click(within(card).getByLabelText("I read this explanation and it is correct."));
    await userEvent.click(approve);
    expect(calls.find((c) => c.key.endsWith("/review"))?.body).toEqual({ decision: "approve", checkedByHand: true });
  });

  it("shows a safe error when the AI call fails", async () => {
    setup({}, { "POST /api/v1/concepts/c1/drafts/questions": () => json(502, { error: { code: "provider_error", message: "The AI service had a problem. Please try again in a moment." }, requestId: "r" }) });
    await userEvent.click(await screen.findByRole("button", { name: "Draft 2 questions" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The AI service had a problem");
  });
});
