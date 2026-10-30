import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { ConceptMapPage } from "./ConceptMapPage";

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
afterEach(() => vi.unstubAllGlobals());

const concepts = [
  { id: "a", key: "equivalent-fractions", title: "Equivalent fractions", learningObjective: "o", prerequisiteIds: [] },
  { id: "b", key: "adding-fractions", title: "Adding fractions", learningObjective: "o", prerequisiteIds: ["a"] },
];
const detail = (id: string) =>
  id === "a"
    ? { id: "a", title: "Equivalent fractions", description: "Different fractions can name the same amount.", learningObjective: "Write equivalent fractions.", prerequisites: [], dependents: [{ id: "b", title: "Adding fractions" }] }
    : { id: "b", title: "Adding fractions", description: "Join fractions with the same denominator.", learningObjective: "Add fractions.", prerequisites: [{ id: "a", title: "Equivalent fractions" }], dependents: [] };

function setup(map: unknown, patterns: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/v1/curriculum") return json(200, { curricula: [{ id: "cv" }] });
      if (url === "/api/v1/curriculum/cv/chapters") return json(200, { chapters: [{ id: "ch1", title: "Fractions", order: 1, conceptCount: 2, summary: null, keyIdeas: [] }] });
      if (url === "/api/v1/chapters/ch1/concepts") return json(200, { concepts });
      if (url === "/api/v1/classes/cl1/learning-map") return json(200, map);
      if (url === "/api/v1/classes/cl1/misconceptions") return json(200, patterns);
      const m = /\/api\/v1\/concepts\/(\w)$/.exec(url);
      if (m) return json(200, detail(m[1]!));
      throw new Error(`Unmocked ${url}`);
    }),
  );
  return render(
    <MemoryRouter initialEntries={["/classes/cl1/concept-map?lesson=b&step=wrap"]}>
      <Routes>
        <Route path="/classes/:classId/concept-map" element={<ConceptMapPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const map = {
  classId: "cl1",
  concepts: [{ id: "b", title: "Adding fractions", counts: { not_enough_evidence: 2, needs_foundation: 4, developing: 1, likely_secure: 1, ready_for_challenge: 0 } }],
  students: Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, name: `S${i}`, rosterNumber: i + 1, cells: {} })),
};
const patterns = { classSize: 8, patterns: [{ patternId: "p1", key: "adds", name: "Adds the denominators", conceptId: "b", conceptTitle: "Adding fractions", studentCount: 3, students: [], summary: "3 of 8", mirror: { prompt: "p", whatToShow: "w" } }] };

describe("concept map", () => {
  it("shows every idea with what this class's records say, using words and shapes, and calls an unassessed idea 'not enough evidence'", async () => {
    setup(map, patterns);
    const adding = await screen.findByRole("button", { name: /Adding fractions/ });
    expect(within(adding).getByText(/4 needs foundation · 1 developing · 1 likely secure/)).toBeInTheDocument();
    const equivalent = screen.getByRole("button", { name: /Equivalent fractions/ });
    expect(within(equivalent).getByText("Not enough evidence")).toBeInTheDocument();
  });

  it("selecting an idea opens its detail: definition, links, evidence, patterns (provisional) and follow-ups with reasons", async () => {
    setup(map, patterns);
    await userEvent.click(await screen.findByRole("button", { name: /Adding fractions/ }));
    const panel = await screen.findByRole("complementary", { name: "Concept detail" });
    expect(await within(panel).findByText("Join fractions with the same denominator.")).toBeInTheDocument();
    expect(within(panel).getByText("6 of 8 students have enough recorded answers on this idea to describe it.")).toBeInTheDocument();
    expect(within(panel).getByText(/Adds the denominators: 3 students/)).toBeInTheDocument();
    expect(within(panel).getByText(/Provisional/)).toBeInTheDocument();
    expect(within(panel).getByText(/4 of 6 students with evidence need foundation on this concept, and it builds on Equivalent fractions/)).toBeInTheDocument();
    expect(within(panel).getByRole("link", { name: "Open the lesson" })).toHaveAttribute("href", "/classes/cl1/lessons/b");
    expect(within(panel).getByRole("link", { name: /See the answers behind this/ })).toHaveAttribute("href", "/classes/cl1/map");
  });

  it("moves between connected ideas, and 'back to the lesson' returns to the same step", async () => {
    setup(map, patterns);
    await userEvent.click(await screen.findByRole("button", { name: /Adding fractions/ }));
    const panel = await screen.findByRole("complementary", { name: "Concept detail" });
    await userEvent.click(await within(panel).findByRole("button", { name: "Equivalent fractions" }));
    expect(await within(panel).findByText("Different fractions can name the same amount.")).toBeInTheDocument();
    expect(within(panel).getByText("Not enough evidence")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the lesson" })).toHaveAttribute("href", "/classes/cl1/lessons/b?step=wrap");
  });

  it("has working zoom, fit and reset controls", async () => {
    setup(map, patterns);
    await screen.findByRole("button", { name: /Adding fractions/ });
    expect(screen.getByText("100%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByText("120%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    await userEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    expect(screen.getByText("80%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
