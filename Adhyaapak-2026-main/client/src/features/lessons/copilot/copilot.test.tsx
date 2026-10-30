import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CopilotResponse, LessonResponse } from "@adhyaapak/shared";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../i18n";
import { buildSlides } from "../presentation-slides";
import { CopilotPanel } from "./CopilotPanel";

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
afterEach(() => vi.unstubAllGlobals());

const lesson = {
  classId: "cl1",
  chapter: { title: "Fractions", order: 1, summary: null, keyIdeas: [] },
  concept: {
    id: "c1", key: "adding-fractions", title: "Adding fractions", description: "d", learningObjective: "o", chapter: { id: "ch", title: "Fractions" }, prerequisites: [], dependents: [],
    resources: [{ id: "r1", type: "explanation", level: "foundation", title: "Pieces of the same size", language: "en", content: { summary: "Only join pieces that are the same size." }, provenance: { source: "original" }, reviewStatus: "approved" }],
    questions: [], misconceptions: [], provenance: { source: "original" }, reviewStatus: "approved",
  },
  questions: [], flow: [], taught: null, insights: { studentCount: 8, counts: { not_enough_evidence: 0, needs_foundation: 0, developing: 0, likely_secure: 0, ready_for_challenge: 0 }, patterns: [] },
} as unknown as LessonResponse;

const base: CopilotResponse = { basis: "enough", answered: 8, studentCount: 8, message: "These suggestions come from the recorded answers. They are possibilities for you to judge, not findings.", suggestions: [], aiAvailable: true };
const COP = "/api/v1/classes/cl1/lessons/c1/run/copilot?k=k";

function setup(copilot: CopilotResponse, extra: Record<string, () => Promise<Response>> = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${String(input)}`;
      calls.push(key);
      if (key === `GET ${COP}`) return json(200, copilot);
      const h = extra[key];
      if (!h) throw new Error(`Unmocked ${key}`);
      return h();
    }),
  );
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={<CopilotPanel classId="cl1" lesson={lesson} reloadKey="k" />} />
        <Route path="/classes/:classId/lessons/:conceptId" element={<p>Prerequisite lesson opened</p>} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return calls;
}

describe("copilot panel", () => {
  it("says there is not enough information and offers no actions when there is no evidence", async () => {
    setup({ ...base, basis: "no_evidence", answered: 0, message: "There is not enough information yet: no student has answered. Run the check and key in or collect answers first." });
    expect(await screen.findByText(/not enough information/)).toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("shows what the evidence suggests, the records behind it and how strong it is, and previews approved material before use", async () => {
    setup({ ...base, suggestions: [{ id: "visual-explanation", kind: "visual_explanation", title: "Show a simpler visual explanation", why: "Several answers followed it. This is a possible misunderstanding, not a confirmed one.", evidence: ['5 answers matched the pattern "Adds the denominators"'], certainty: "medium", action: { type: "preview_resource", level: "foundation" } }] });
    const card = (await screen.findByRole("heading", { name: "Show a simpler visual explanation" })).closest("li")!;
    expect(within(card).getByText(/not a confirmed one/)).toBeInTheDocument();
    expect(within(card).getByText(/5 answers matched the pattern/)).toBeInTheDocument();
    expect(within(card).getByText("Evidence: a clear signal")).toBeInTheDocument();
    expect(within(card).queryByText("Only join pieces that are the same size.")).not.toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Preview it" }));
    expect(within(card).getByText("Only join pieces that are the same size.")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Show it on the projector" })).toHaveAttribute("href", "/present/c1?level=foundation");
  });

  it("previews the questions of an earlier idea, then launches a real check on it", async () => {
    const calls = setup(
      { ...base, suggestions: [{ id: "prerequisite-p1", kind: "prerequisite_check", title: "Check the earlier idea: Equivalent fractions", why: "w", evidence: ["e"], certainty: "medium", action: { type: "launch_prerequisite_check", conceptId: "p1", conceptTitle: "Equivalent fractions" } }] },
      {
        "POST /api/v1/classes/cl1/assessments/suggest": () => json(200, { questions: [{ id: "q1", stem: "1/2 = ?/4" }, { id: "q2", stem: "2/3 = ?/6" }] }),
        "POST /api/v1/classes/cl1/lessons/p1/run/check/start": () => json(200, { assessmentId: "a9" }),
      },
    );
    await userEvent.click(await screen.findByRole("button", { name: /Preview a check on “Equivalent fractions”/ }));
    expect(await screen.findByText("1/2 = ?/4")).toBeInTheDocument();
    expect(calls).not.toContain("POST /api/v1/classes/cl1/lessons/p1/run/check/start"); // nothing runs until the teacher says so
    await userEvent.click(screen.getByRole("button", { name: "Launch this check" }));
    expect(await screen.findByText("Prerequisite lesson opened")).toBeInTheDocument();
  });

  const draftDto = { id: "d1", key: "k", level: "guided", title: "Another look", content: { summary: "Cut both wholes into the same size pieces.", steps: ["Find a common denominator."], workedExample: null, commonError: null, prompt: null }, provenanceNote: "", createdAt: "2026-10-29T08:00:00Z", check: { status: "not_applicable", issues: [] }, approvable: true };
  const draftSuggestion = { ...base, suggestions: [{ id: "parallel-example", kind: "parallel_example" as const, title: "Prepare a parallel example", why: "w", evidence: ["e"], certainty: "medium" as const, action: { type: "prepare_ai_draft" as const, level: "guided" as const } }] };

  it("drafts with the AI only on request, shows all of it labelled as an unapproved draft, and offers the drafts page", async () => {
    const calls = setup(draftSuggestion, { "POST /api/v1/concepts/c1/drafts/explanations": () => json(201, draftDto) });
    expect(calls.some((c) => c.startsWith("POST"))).toBe(false);
    await userEvent.click(await screen.findByRole("button", { name: "Draft a parallel example" }));
    expect(await screen.findByText("AI draft")).toBeInTheDocument();
    expect(screen.getByText("Not in your lesson yet")).toBeInTheDocument();
    expect(screen.getByText("Find a common denominator.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Edit it on the drafts page instead" })).toHaveAttribute("href", "/curriculum/concepts/c1/drafts");
  });

  it("adds a draft to the lesson only after the teacher confirms they checked it, then offers the projector", async () => {
    const calls = setup(draftSuggestion, {
      "POST /api/v1/concepts/c1/drafts/explanations": () => json(201, draftDto),
      "POST /api/v1/resource-drafts/d1/review": () => json(200, { id: "d1", status: "approved" }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Draft a parallel example" }));
    const add = await screen.findByRole("button", { name: "Add to the lesson" });
    expect(add).toBeDisabled(); // nothing reaches the class until the teacher says they checked it
    await userEvent.click(screen.getByRole("checkbox", { name: "I have read all of it and checked it is correct." }));
    await userEvent.click(add);
    expect(await screen.findByText("✓ Added to your lesson")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Show it on the projector" })).toHaveAttribute("href", "/present/c1?level=guided");
    expect(calls).toContain("POST /api/v1/resource-drafts/d1/review");
  });

  it("lets the teacher set a draft aside without it reaching the lesson", async () => {
    setup(draftSuggestion, {
      "POST /api/v1/concepts/c1/drafts/explanations": () => json(201, draftDto),
      "POST /api/v1/resource-drafts/d1/review": () => json(200, { id: "d1", status: "rejected" }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Draft a parallel example" }));
    await userEvent.click(await screen.findByRole("button", { name: "Not this one" }));
    expect(await screen.findByText(/Nothing was added to your lesson/)).toBeInTheDocument();
  });

  it("when the model fails, says so plainly, keeps the lesson unchanged and lets the teacher retry", async () => {
    setup(
      { ...base, suggestions: [{ id: "parallel-example", kind: "parallel_example", title: "Prepare a parallel example", why: "w", evidence: ["e"], certainty: "medium", action: { type: "prepare_ai_draft", level: "guided" } }] },
      { "POST /api/v1/concepts/c1/drafts/explanations": () => json(502, { error: { code: "internal_error", message: "The AI service is not responding. Nothing was changed." }, requestId: "r" }) },
    );
    await userEvent.click(await screen.findByRole("button", { name: "Draft a parallel example" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Nothing was changed");
    expect(screen.queryByText("AI draft")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled());
  });

  it("shows AI drafting as unavailable, not as a broken button, when the AI is off", async () => {
    setup({ ...base, aiAvailable: false, suggestions: [{ id: "parallel-example", kind: "parallel_example", title: "Prepare a parallel example", why: "w", evidence: ["e"], certainty: "medium", action: { type: "prepare_ai_draft", level: "guided" } }] });
    expect(await screen.findByText(/AI drafting is switched off or not configured/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Draft a parallel example" })).not.toBeInTheDocument();
  });
});

describe("projector slides", () => {
  const p = { title: "Equivalent fractions", conceptKey: "equivalent-fractions", learningObjective: "o", levels: [], questions: [] };
  it("adds the interactive canvas as a slide for equivalent fractions only", () => {
    expect(buildSlides(p, "foundation").map((s) => s.kind)).toEqual(["title", "canvas"]);
    expect(buildSlides({ ...p, conceptKey: "adding-fractions" }, "foundation").map((s) => s.kind)).toEqual(["title"]);
  });
});
