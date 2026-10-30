import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { BranchBoardPage } from "./interventions/BranchBoardPage";

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const card = (over: Record<string, unknown>) => ({
  studentId: "s1", name: "Ravi", rosterNumber: 1, status: "needs_foundation", evidenceCount: 2, activity: "prerequisite_diagnostic",
  targetConceptId: "c-prereq", targetConceptTitle: "Finding a common denominator", prerequisiteTitles: ["Finding a common denominator"],
  reason: "Several answers show difficulty. Pattern seen: Adds the denominators.", uncertainty: "medium", teacherReviewRequired: false, suggestedMinutes: 15, assigned: null, ...over,
});

const board = {
  conceptId: "c-add", conceptTitle: "Adding fractions", concepts: [{ id: "c-add", title: "Adding fractions" }],
  lanes: {
    foundation: [card({})],
    guided: [card({ studentId: "s2", name: "Meera", rosterNumber: 2, status: "developing", activity: "guided_practice", targetConceptId: "c-add", targetConceptTitle: "Adding fractions", prerequisiteTitles: [], reason: "Some answers are right and some are not.", suggestedMinutes: 10 })],
    challenge: [],
    follow_up: [card({ studentId: "s3", name: "Anu", rosterNumber: 3, status: "not_enough_evidence", evidenceCount: 0, activity: "follow_up_assessment", targetConceptId: "c-add", targetConceptTitle: "Adding fractions", prerequisiteTitles: [], reason: "There is no reviewed evidence on this concept yet.", uncertainty: "high", suggestedMinutes: 5 })],
  },
};

function mockApi(calls: Array<{ key: string; body?: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      calls.push({ key, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      if (key.startsWith("GET /api/v1/classes/c1/branch-board")) return json(200, board);
      if (key.startsWith("GET /api/v1/classes/c1/interventions")) return json(200, { interventions: [] });
      if (key === "POST /api/v1/classes/c1/interventions") return json(201, { assigned: [{ studentId: "s1", interventionId: "i1" }], skipped: [] });
      throw new Error(`Unmocked request: ${key}`);
    }),
  );
}
afterEach(() => vi.unstubAllGlobals());

const renderBoard = () =>
  render(
    <MemoryRouter initialEntries={["/classes/c1/branch-board"]}>
      <Routes>
        <Route path="/classes/:classId/branch-board" element={<BranchBoardPage />} />
      </Routes>
    </MemoryRouter>,
  );

describe("Branch Board", () => {
  it("shows temporary lanes with reasons, and never calls the follow-up lane a struggling group", async () => {
    mockApi([]);
    renderBoard();
    expect(await screen.findByRole("heading", { name: /Foundation \(1\)/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /Needs more evidence \(1\)/ })).toBeInTheDocument();
    expect(screen.getByText(/Not a struggling group/)).toBeInTheDocument();
    expect(screen.getByText("Check an earlier concept")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\bweak\b|\blow ability\b|\bslow\b/i);
  });

  it("requires a reason before a student can be moved, then sends the reason with the assignment", async () => {
    const calls: Array<{ key: string; body?: unknown }> = [];
    mockApi(calls);
    renderBoard();
    await screen.findByRole("heading", { name: /Foundation \(1\)/ });

    const assign = screen.getByRole("button", { name: "Assign activities to 3 students" });
    expect(assign).toBeEnabled();

    const [raviGroup] = screen.getAllByLabelText("Group");
    await userEvent.selectOptions(raviGroup!, "guided");
    expect(screen.getByRole("button", { name: "Assign activities to 3 students" })).toBeDisabled();
    expect(screen.getByText(/Say why you moved: Ravi/)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText("Why are you moving them?"), "He explained it well in class");
    expect(screen.getByRole("button", { name: "Assign activities to 3 students" })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "Assign activities to 3 students" }));

    expect(await screen.findByText("Assigned 1 activity.")).toBeInTheDocument();
    const post = calls.find((c) => c.key === "POST /api/v1/classes/c1/interventions")!.body as { conceptId: string; assignments: Array<Record<string, unknown>> };
    expect(post.conceptId).toBe("c-add");
    expect(post.assignments.find((a) => a.studentId === "s1")).toEqual({ studentId: "s1", groupKey: "guided", movedReason: "He explained it well in class" });
    // Students left where the suggestion put them carry no moved reason.
    expect(post.assignments.find((a) => a.studentId === "s2")).toEqual({ studentId: "s2", groupKey: "guided" });
  });

  it("lets the teacher leave a student out", async () => {
    const calls: Array<{ key: string; body?: unknown }> = [];
    mockApi(calls);
    renderBoard();
    await screen.findByRole("heading", { name: /Foundation \(1\)/ });
    await userEvent.click(screen.getAllByLabelText("Include")[2]!);
    await userEvent.click(screen.getByRole("button", { name: "Assign activities to 2 students" }));
    await screen.findByText("Assigned 1 activity.");
    const post = calls.find((c) => c.key === "POST /api/v1/classes/c1/interventions")!.body as { assignments: Array<{ studentId: string }> };
    expect(post.assignments.map((a) => a.studentId)).toEqual(["s1", "s2"]);
  });
});
