import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LessonResponse, PresentationResponse } from "@adhyaapak/shared";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { LessonPage } from "./LessonPage";
import { PresentationPage } from "./PresentationPage";
import { buildSlides } from "./presentation-slides";

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const presentation: PresentationResponse = {
  title: "Adding fractions",
  learningObjective: "Add fractions with like and unlike denominators.",
  levels: [
    { level: "foundation", title: "Joining pieces of the same size", summary: "You can only join pieces that are the same size.", steps: ["Shade 2 of 7 parts.", "Shade 3 more.", "5 of 7 are shaded."], workedExample: null, commonError: null, prompt: null, manipulative: { type: "fraction-bar", parts: 7, shaded: 5 } },
    { level: "guided", title: "Adding with unlike denominators", summary: "Make the pieces the same size first.", steps: [], workedExample: { problem: "Find 1/2 + 1/3.", steps: ["Common denominator 6.", "3/6 + 2/6 = 5/6."] }, commonError: "Adding tops and bottoms.", prompt: null, manipulative: null },
  ],
  questions: [{ id: "q1", stem: "1/2 + 1/3 = ?", options: [{ id: "a", text: "2/5" }, { id: "b", text: "5/6" }] }],
};

describe("presentation slides", () => {
  it("builds title → level content → questions, with steps revealed one at a time", () => {
    const slides = buildSlides(presentation, "foundation");
    expect(slides[0]).toMatchObject({ kind: "title", title: "Adding fractions" });
    expect(slides[1]).toMatchObject({ kind: "text", heading: "Joining pieces of the same size" });
    const steps = slides.filter((s) => s.kind === "steps");
    expect(steps.map((s) => (s.kind === "steps" ? s.visible : 0))).toEqual([1, 2, 3]);
    expect(slides.at(-1)).toMatchObject({ kind: "question", number: 1, total: 1 });
  });

  it("keeps the picture on screen while the steps are revealed", () => {
    const steps = buildSlides(presentation, "foundation").filter((s) => s.kind === "steps");
    expect(steps.length).toBeGreaterThan(0);
    for (const s of steps) expect(s.kind === "steps" && s.manipulative).toMatchObject({ type: "fraction-bar" });
  });

  it("includes the worked example step by step and the common error for the guided level", () => {
    const text = JSON.stringify(buildSlides(presentation, "guided"));
    expect(text).toContain("Find 1/2 + 1/3.");
    expect(text).toContain("Watch out");
    expect(buildSlides(presentation, "guided").filter((s) => s.kind === "steps")).toHaveLength(2);
  });
});

describe("PresentationPage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("only ever asks for presentation content: it cannot load class or student data", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        urls.push(url);
        if (url === "/api/v1/concepts/c1/presentation") return json(200, presentation);
        throw new Error(`Presentation mode must not request ${url}`);
      }),
    );
    render(
      <MemoryRouter initialEntries={["/present/c1"]}>
        <Routes>
          <Route path="/present/:conceptId" element={<PresentationPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Adding fractions" })).toBeInTheDocument();
    expect(urls).toEqual(["/api/v1/concepts/c1/presentation"]);
  });

  it("moves with the keyboard and switches level with 1/2/3", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json(200, presentation)));
    render(
      <MemoryRouter initialEntries={["/present/c1"]}>
        <Routes>
          <Route path="/present/:conceptId" element={<PresentationPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Adding fractions" });
    await userEvent.keyboard("{ArrowRight}");
    expect(await screen.findByRole("heading", { name: "Joining pieces of the same size" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /5 of 7 equal parts shaded/ })).toBeInTheDocument();
    await userEvent.keyboard("2");
    expect(await screen.findByRole("heading", { name: "Adding with unlike denominators" })).toBeInTheDocument();
    await userEvent.keyboard("{ArrowLeft}");
    expect(screen.getByRole("heading", { name: "Adding fractions" })).toBeInTheDocument();
  });

  it("never shows an answer key on the question slides", async () => {
    vi.stubGlobal("fetch", vi.fn(() => json(200, presentation)));
    render(
      <MemoryRouter initialEntries={["/present/c1"]}>
        <Routes>
          <Route path="/present/:conceptId" element={<PresentationPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole("heading", { name: "Adding fractions" });
    for (let i = 0; i < 12; i++) await userEvent.keyboard("{ArrowRight}");
    expect(await screen.findByRole("heading", { name: "1/2 + 1/3 = ?" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/correct|✓|answer key/i);
  });
});

describe("LessonPage", () => {
  const lesson: LessonResponse = {
    classId: "cl1",
    chapter: { title: "Fractions", order: 1, summary: "Fractions describe equal parts of a whole.", keyIdeas: ["A fraction needs equal parts."] },
    concept: {
      id: "c1", key: "adding-fractions", title: "Adding fractions", description: "d", learningObjective: "Add fractions.", chapter: { id: "ch", title: "Fractions" }, prerequisites: [], dependents: [],
      resources: [
        { id: "r1", type: "explanation", level: "foundation", title: "Pieces", language: "en", content: { summary: "Foundation text" }, provenance: { source: "original" }, reviewStatus: "approved" },
        { id: "r2", type: "explanation", level: "guided", title: "Unlike", language: "en", content: { summary: "Guided text" }, provenance: { source: "original" }, reviewStatus: "approved" },
        { id: "r3", type: "explanation", level: "challenge", title: "Bigger", language: "en", content: { summary: "Challenge text" }, provenance: { source: "original" }, reviewStatus: "approved" },
      ],
      questions: [], misconceptions: [], provenance: { source: "original" }, reviewStatus: "approved",
    },
    questions: [
      { id: "q1", key: "q-af-1", role: "diagnostic", difficulty: 2, stem: "1/2 + 1/3 = ?", options: [{ id: "a", text: "2/5", misconceptionKey: "adds-denominators" }, { id: "b", text: "5/6" }], correctOptionId: "b", explanation: "Common denominator 6.", reviewStatus: "approved", conceptId: "c1", conceptTitle: "Adding fractions" },
      { id: "q2", key: "q-af-3", role: "guided", difficulty: 3, stem: "1/4 + 2/3 = ?", options: [{ id: "a", text: "3/7" }, { id: "b", text: "11/12" }], correctOptionId: "b", explanation: "3/12 + 8/12.", reviewStatus: "approved", conceptId: "c1", conceptTitle: "Adding fractions" },
      { id: "q3", key: "q-af-4", role: "challenge", difficulty: 4, stem: "3/4 + 5/6 = ?", options: [{ id: "a", text: "8/10" }, { id: "b", text: "19/12" }], correctOptionId: "b", explanation: "9/12 + 10/12.", reviewStatus: "approved", conceptId: "c1", conceptTitle: "Adding fractions" },
    ],
    flow: [
      { key: "hook", minutes: 3, questionIds: ["q1"] }, { key: "teach", minutes: 10, questionIds: [] }, { key: "check", minutes: 5, questionIds: [] },
      { key: "practise", minutes: 10, questionIds: ["q2", "q3"] }, { key: "exit_ticket", minutes: 3, questionIds: [] },
    ],
    taught: null,
    insights: { studentCount: 2, counts: { not_enough_evidence: 0, needs_foundation: 1, developing: 1, likely_secure: 0, ready_for_challenge: 0 }, patterns: [{ name: "Adds the denominators", studentCount: 1 }] },
  };

  afterEach(() => vi.unstubAllGlobals());

  function renderLesson(calls: Array<{ key: string; body?: unknown }> = []) {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string, init?: RequestInit) => {
        const key = `${init?.method ?? "GET"} ${url}`;
        calls.push({ key, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
        if (key === "GET /api/v1/classes/cl1/lessons/c1") return json(200, lesson);
        if (key === "GET /api/v1/classes/cl1/lessons/c1/run") return json(200, { state: "teaching", runDate: "2026-10-29", assessmentId: null, startedAt: "2026-10-29T04:00:00.000Z", wrappedAt: null });
        if (key === "PUT /api/v1/classes/cl1/lessons/c1/taught") return json(200, { taught: true });
        throw new Error(`Unmocked request: ${key}`);
      }),
    );
    return render(
      <MemoryRouter initialEntries={["/classes/cl1/lessons/c1?step=teach"]}>
        <Routes>
          <Route path="/classes/:classId/lessons/:conceptId" element={<LessonPage />} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it("shows the five-part plan with minutes and the private class insight", async () => {
    renderLesson();
    expect(await screen.findByRole("heading", { name: /Lesson plan \(31 minutes\)/ })).toBeInTheDocument();
    for (const name of [/1\. Starter/, /2\. Teach/, /3\. Quick check/, /4\. Practise/, /5\. Exit ticket/]) expect(screen.getByRole("heading", { name })).toBeInTheDocument();
    const insights = screen.getByRole("complementary");
    expect(within(insights).getByText(/1 needs foundation/)).toBeInTheDocument();
    expect(within(insights).getByText(/Adds the denominators/)).toBeInTheDocument();
    expect(within(insights).getByText(/Private/)).toBeInTheDocument();
  });

  it("switches teaching level independently for each segment", async () => {
    renderLesson();
    await screen.findByText("Guided text");
    const teach = screen.getByRole("heading", { name: /2\. Teach/ }).closest("li")!;
    await userEvent.click(within(teach).getByRole("tab", { name: "Challenge" }));
    expect(within(teach).getByText("Challenge text")).toBeInTheDocument();
    // The practise segment keeps its own level: guided questions by default.
    const practise = screen.getByRole("heading", { name: /4\. Practise/ }).closest("li")!;
    expect(within(practise).getByText("1/4 + 2/3 = ?")).toBeInTheDocument();
    expect(within(practise).queryByText("3/4 + 5/6 = ?")).not.toBeInTheDocument();
    await userEvent.click(within(practise).getByRole("tab", { name: "Challenge" }));
    expect(within(practise).getByText("3/4 + 5/6 = ?")).toBeInTheDocument();
  });

  it("keeps answers hidden until the teacher asks, and says so when a part has no question", async () => {
    renderLesson();
    const hook = (await screen.findByRole("heading", { name: /1\. Starter/ })).closest("li")!;
    expect(within(hook).queryByText("✓")).not.toBeInTheDocument();
    await userEvent.click(within(hook).getByRole("button", { name: "Show answer" }));
    expect(within(hook).getByText("Common denominator 6.")).toBeInTheDocument();
    const exit = screen.getByRole("heading", { name: /5\. Exit ticket/ }).closest("li")!;
    expect(within(exit).getByText("No unseen question is available for this part.")).toBeInTheDocument();
  });

  it("marks the concept as taught through the API", async () => {
    const calls: Array<{ key: string; body?: unknown }> = [];
    renderLesson(calls);
    await userEvent.click(await screen.findByRole("button", { name: "Mark as taught" }));
    expect(calls.find((c) => c.key.startsWith("PUT"))?.body).toEqual({ taught: true });
  });
});
