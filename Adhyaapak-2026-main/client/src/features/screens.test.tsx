import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { ClassPage } from "./classes/ClassPage";
import { ConceptPage } from "./curriculum/ConceptPage";

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

function mockApi(routes: Record<string, () => Promise<Response>>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      const h = routes[key];
      if (!h) throw new Error(`Unmocked request: ${key}`);
      return h();
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe("ClassPage", () => {
  const cls = { id: "c1", name: "6A", grade: 6, academicYear: "2026-27", joinCode: "K7M2QX", studentCount: 1 };
  const base = {
    "GET /api/v1/classes/c1": () => json(200, cls),
    "GET /api/v1/classes/c1/students": () => json(200, { students: [{ id: "s1", name: "Ravi", referenceId: null, rosterNumber: 1 }] }),
  };
  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={["/classes/c1"]}>
        <Routes>
          <Route path="/classes/:classId" element={<ClassPage />} />
        </Routes>
      </MemoryRouter>,
    );

  it("shows the join code and the roster from the API", async () => {
    mockApi(base);
    renderPage();
    expect(await screen.findByText("K7M2QX")).toBeInTheDocument();
    expect(await screen.findByRole("cell", { name: "Ravi" })).toBeInTheDocument();
  });

  it("blocks the import when the preview finds a bad row, and explains the row in text", async () => {
    mockApi({
      ...base,
      "POST /api/v1/classes/c1/enrolments/import": () =>
        json(200, {
          dryRun: true,
          committed: false,
          okCount: 1,
          errorCount: 1,
          rows: [
            { line: 2, name: "Meera", rosterNumber: 2, status: "ok" },
            { line: 3, name: "", rosterNumber: null, status: "error", message: "Name is missing." },
          ],
        }),
    });
    renderPage();
    await screen.findByText("K7M2QX");
    await userEvent.type(screen.getByLabelText("Or paste CSV text"), "name{enter}Meera");
    await userEvent.click(screen.getByRole("button", { name: "Preview" }));

    expect(await screen.findByText("1 row needs fixing before you can import.")).toBeInTheDocument();
    expect(screen.getByText("✗ Name is missing.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import students" })).toBeDisabled();
  });
});

describe("ConceptPage", () => {
  const concept = {
    id: "k1", key: "adding-fractions", title: "Adding fractions", description: "desc", learningObjective: "Add fractions.",
    chapter: { id: "ch", title: "Fractions" },
    prerequisites: [{ id: "k0", title: "Finding a common denominator" }], dependents: [],
    resources: [
      { id: "r1", type: "explanation", level: "foundation", title: "Joining pieces", language: "en", content: { summary: "Foundation text" }, provenance: { source: "original" }, reviewStatus: "approved" },
      { id: "r2", type: "explanation", level: "guided", title: "Unlike denominators", language: "en", content: { summary: "Guided text", commonError: "Adding tops and bottoms" }, provenance: { source: "original" }, reviewStatus: "approved" },
    ],
    questions: [
      {
        id: "q1", key: "q-af-1", role: "diagnostic", difficulty: 2, stem: "1/2 + 1/3 = ?", correctOptionId: "b", explanation: "Common denominator 6.", reviewStatus: "approved",
        options: [{ id: "a", text: "2/5", misconceptionKey: "adds-denominators" }, { id: "b", text: "5/6" }],
      },
    ],
    misconceptions: [{ id: "m1", key: "adds-denominators", name: "Adds the denominators", description: "d", exampleWrongAnswers: ["1/2 + 1/3 = 2/5"], recommendedExplanation: "Use a bar.", reviewStatus: "approved" }],
    provenance: { source: "original", note: "Authored by the team" },
    reviewStatus: "approved",
  };

  it("switches teaching level, marks the correct answer and names the misconception behind a wrong option", async () => {
    mockApi({ "GET /api/v1/concepts/k1": () => json(200, concept) });
    render(
      <MemoryRouter initialEntries={["/curriculum/concepts/k1"]}>
        <Routes>
          <Route path="/curriculum/concepts/:conceptId" element={<ConceptPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Foundation text")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Guided" }));
    expect(screen.getByText("Guided text")).toBeInTheDocument();
    expect(screen.queryByText("Foundation text")).not.toBeInTheDocument();
    expect(screen.getByText(/Adding tops and bottoms/)).toBeInTheDocument();

    expect(screen.getByText(/✓ correct answer/)).toBeInTheDocument();
    const wrong = screen.getByText(/2\/5/, { selector: "li" });
    expect(within(wrong).getByText(/a student choosing this may be showing: Adds the denominators/)).toBeInTheDocument();
  });
});
