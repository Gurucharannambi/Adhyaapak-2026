import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AtlasRecord, AtlasWorkspaceResponse, DashboardResponse, InsightsResponse } from "@adhyaapak/shared";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { AtlasPage } from "../curriculum/AtlasPage";
import { InsightsPage } from "./InsightsPage";
import { AssessmentsPage } from "../assessments/AssessmentsPage";
import { ClassesPage } from "../classes/ClassesPage";
import { Layout } from "../../app/Layout";
import { AuthProvider } from "../auth/AuthContext";
import { ConfigProvider } from "../../app/ConfigContext";

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
afterEach(() => vi.unstubAllGlobals());

function mock(routes: Record<string, (body?: unknown) => Promise<Response>>) {
  const calls: Array<{ key: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${String(input)}`;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ key, body });
      const h = routes[key];
      if (!h) return json(404, { error: { code: "not_found", message: `Unmocked ${key}` }, requestId: "r" });
      return h(body);
    }),
  );
  return calls;
}

const CLASS = { id: "cl1", name: "6A", grade: 6, academicYear: "2026-27", joinCode: "ABC234", studentCount: 8, portalEnabled: false };
const zero = { not_enough_evidence: 0, needs_foundation: 0, developing: 0, likely_secure: 0, ready_for_challenge: 0 };

const record = (over: Partial<AtlasRecord> = {}): AtlasRecord => ({
  patternId: "p1",
  name: "Adds the denominators",
  description: "Adds tops and bottoms directly instead of finding a common denominator.",
  recommendedExplanation: "Show both fractions as bars cut into the same size pieces.",
  concept: { id: "c1", title: "Adding fractions", chapterTitle: "Fractions" },
  prerequisites: [{ id: "c0", title: "Equivalent fractions" }],
  affected: 2,
  answeredOnConcept: 6,
  repeated: 1,
  checks: 2,
  firstSeen: "2026-10-27T09:00:00.000Z",
  lastSeen: "2026-10-29T09:00:00.000Z",
  strength: "repeated",
  review: { open: 2, confirmed: 0, dismissed: 0, inconclusive: 0 },
  responses: [{ studentId: "s1", studentName: "Ravi", question: "1/2 + 1/3 = ?", answer: "2/5", expected: "5/6", check: "Check: Adding fractions", at: "2026-10-29T09:00:00.000Z" }],
  students: [
    { id: "s1", name: "Ravi", observations: 2, review: "open", lastSeen: "2026-10-29T09:00:00.000Z", outcome: "no_new_evidence" },
    { id: "s2", name: "Meera", observations: 1, review: "open", lastSeen: "2026-10-27T09:00:00.000Z", outcome: "partial" },
  ],
  track: { demonstrated: 0, partial: 1, same_error: 0, other_error: 0, no_new_evidence: 1 },
  interventions: { assigned: 0, completed: 0 },
  ...over,
});
const workspace = (records: AtlasRecord[]): AtlasWorkspaceResponse => ({ classId: "cl1", className: "6A", studentCount: 8, summary: { needsInvestigation: 1, conceptsToRevisit: 1, awaitingReview: 1 }, records });

const mount = (url: string, el: React.ReactNode, path: string) =>
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path={path} element={el} />
        <Route path="*" element={<p>elsewhere</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe("Misconception Atlas workspace", () => {
  it("leads with defined counts, lists patterns with honest denominators, and shows a real example response", async () => {
    mock({ "GET /api/v1/classes": () => json(200, { classes: [CLASS] }), "GET /api/v1/classes/cl1/atlas": () => json(200, workspace([record()])) });
    mount("/atlas", <AtlasPage />, "/atlas");
    const needs = (await screen.findByText("Needs investigation")).closest(".stat-card")!;
    expect(needs).toHaveTextContent("1");
    expect(needs).toHaveTextContent(/Students with repeated evidence/);
    expect(screen.getByText(/Adding fractions · 2 of 6 students who answered/)).toBeInTheDocument();
    expect(screen.getByText(/This is a possible misconception, not a permanent label/)).toBeInTheDocument();
    expect(screen.getByText("2/5")).toBeInTheDocument(); // the real wrong answer, struck through
    expect(screen.getByText(/expected 5\/6/)).toBeInTheDocument();
  });

  it("never offers 'confirm' for a single observation, and records 'inconclusive' through the review API", async () => {
    const calls = mock({
      "GET /api/v1/classes": () => json(200, { classes: [CLASS] }),
      "GET /api/v1/classes/cl1/atlas": () => json(200, workspace([record()])),
      "POST /api/v1/classes/cl1/misconceptions/review": () => json(200, { updated: 1 }),
    });
    mount("/atlas", <AtlasPage />, "/atlas");
    await userEvent.click(await screen.findByRole("tab", { name: /Verify/ }));
    const meera = screen.getByText("Meera").closest("li")!;
    expect(within(meera).getByRole("button", { name: "Confirm" })).toBeDisabled();
    await userEvent.click(within(meera).getByRole("button", { name: "Inconclusive" }));
    await waitFor(() => expect(calls.find((c) => c.key.startsWith("POST"))!.body).toEqual({ studentId: "s2", patternId: "p1", decision: "inconclusive" }));
    expect(await screen.findByText(/Meera: marked inconclusive\. The answers are kept\./)).toBeInTheDocument();
  });

  it("links every intervention and the recheck to real lesson tools, and tracks outcomes without calling anything resolved", async () => {
    mock({ "GET /api/v1/classes": () => json(200, { classes: [CLASS] }), "GET /api/v1/classes/cl1/atlas": () => json(200, workspace([record()])) });
    mount("/atlas", <AtlasPage />, "/atlas");
    await userEvent.click(await screen.findByRole("tab", { name: /Intervene/ }));
    expect(screen.getByRole("link", { name: "Open on projector" })).toHaveAttribute("href", "/present/c1?level=foundation");
    expect(screen.getByRole("link", { name: "Branch Board" })).toHaveAttribute("href", "/classes/cl1/branch-board?concept=c1");
    await userEvent.click(screen.getByRole("tab", { name: /Recheck/ }));
    expect(screen.getByRole("link", { name: "Prepare a recheck" })).toHaveAttribute("href", "/classes/cl1/lessons/c1?step=check");
    await userEvent.click(screen.getByRole("tab", { name: /Track/ }));
    expect(screen.getByText("No new evidence").closest("li")).toHaveTextContent("1 / 2");
    expect(screen.queryByText(/resolved/i)).not.toBeInTheDocument();
  });

  it("says so plainly when a class has no patterns yet", async () => {
    mock({ "GET /api/v1/classes": () => json(200, { classes: [CLASS] }), "GET /api/v1/classes/cl1/atlas": () => json(200, workspace([])) });
    mount("/atlas", <AtlasPage />, "/atlas");
    expect(await screen.findByText(/No answer patterns in 6A yet/)).toBeInTheDocument();
  });
});

describe("Insights", () => {
  const insights = (over: Partial<InsightsResponse> = {}): InsightsResponse => ({
    classId: "cl1",
    className: "6A",
    studentCount: 8,
    coverage: { bookTitle: "Maths 6", taught: 3, total: 20 },
    distribution: { cells: 16, concepts: 2, byStatus: { ...zero, not_enough_evidence: 10, developing: 4, likely_secure: 2 } },
    concepts: [{ id: "c1", title: "Adding fractions", assessed: 4, counts: { ...zero, not_enough_evidence: 4, developing: 3, likely_secure: 1 }, patternStudents: 2, trend: { latest: { date: "2026-10-29", title: "Check", right: 5, of: 8 }, previous: { date: "2026-10-27", title: "Check", right: 3, of: 8 } } }],
    growth: [
      { key: "improved", students: [{ studentId: "s1", name: "Ravi", conceptId: "c1", conceptTitle: "Adding fractions", why: "Early answers on Adding fractions had mistakes; the latest two were right (4 counted answers)." }] },
      { key: "practice", students: [] },
    ],
    practiceRecorded: false,
    ...over,
  });

  it("states each metric's denominator, compares checks with care, and explains every growth entry", async () => {
    mock({ "GET /api/v1/classes": () => json(200, { classes: [CLASS] }), "GET /api/v1/classes/cl1/insights": () => json(200, insights()) });
    mount("/insights", <InsightsPage />, "/insights");
    expect((await screen.findByText("Likely secure", { selector: ".label" })).closest(".stat-card")).toHaveTextContent("2/6");
    expect(screen.getByRole("img", { name: /Not enough evidence yet: 10/ })).toBeInTheDocument();
    const row = screen.getByRole("link", { name: "Adding fractions" }).closest("tr")!;
    expect(row).toHaveTextContent("4/8");
    expect(row).toHaveTextContent("3/8 → 5/8");
    expect(screen.getByText(/the latest two were right \(4 counted answers\)/)).toBeInTheDocument();
    expect(screen.getByText(/“Consistent practice” is hidden: no practice sets are recorded/)).toBeInTheDocument();
    expect(screen.getByText("Only you see this")).toBeInTheDocument();
  });

  it("shows an honest empty state with no recorded answers", async () => {
    mock({ "GET /api/v1/classes": () => json(200, { classes: [CLASS] }), "GET /api/v1/classes/cl1/insights": () => json(200, insights({ distribution: { cells: 0, concepts: 0, byStatus: zero }, concepts: [], growth: [] })) });
    mount("/insights", <InsightsPage />, "/insights");
    expect(await screen.findByText(/No recorded answers yet, so there is nothing to show/)).toBeInTheDocument();
  });
});

describe("Classes and Assessments", () => {
  it("lists classes with their real roster size and routes into each", async () => {
    mock({ "GET /api/v1/dashboard": () => json(200, { classes: [CLASS], today: [], schedule: [], tomorrow: [], week: [], weekStart: "2026-10-26", attention: [], setup: { hasClass: true, hasStudents: true, hasTaught: true } }) });
    mount("/classes", <ClassesPage />, "/classes");
    const card = (await screen.findByRole("heading", { name: "6A" })).closest("li")!;
    expect(within(card).getByText("8")).toBeInTheDocument();
    expect(within(card).getByRole("link", { name: "Atlas" })).toHaveAttribute("href", "/atlas?class=cl1");
    expect(screen.getByRole("heading", { name: "Create a class" })).toBeInTheDocument();
  });

  it("lists checks across classes and filters them by status", async () => {
    const a = (id: string, status: string, n: number) => ({ id, title: `Check ${id}`, type: "diagnostic", status, questionCount: 3, submittedCount: n, createdAt: "2026-10-29T08:00:00.000Z", classId: "cl1", className: "6A" });
    mock({ "GET /api/v1/assessments": () => json(200, { assessments: [a("a1", "open", 4), a("a2", "closed", 7)] }) });
    mount("/assessments", <AssessmentsPage />, "/assessments");
    expect((await screen.findByText("Students' submissions")).closest(".stat-card")).toHaveTextContent("11");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Status" }), "closed");
    expect(screen.queryByRole("link", { name: "Check a1" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Check a2" })).toHaveAttribute("href", "/activities/a2");
  });
});

describe("app shell", () => {
  const day = (over: Partial<DashboardResponse> = {}): DashboardResponse => ({ classes: [CLASS], today: [], schedule: [], tomorrow: [], week: [], weekStart: "2026-10-26", attention: [], setup: { hasClass: true, hasStudents: true, hasTaught: true }, ...over });
  const shell = (d: DashboardResponse) => {
    mock({
      "GET /api/v1/config": () => json(200, { appName: "Adhyaapak", demoLogin: null }),
      "GET /api/v1/auth/me": () => json(200, { user: { id: "u1", name: "Asha Rao", email: "a@example.com", role: "teacher" } }),
      "GET /api/v1/dashboard": () => json(200, d),
    });
    return render(
      <MemoryRouter initialEntries={["/insights"]}>
        <ConfigProvider>
          <AuthProvider>
            <Routes>
              <Route element={<Layout />}>
                <Route path="*" element={<p>page</p>} />
              </Route>
            </Routes>
          </AuthProvider>
        </ConfigProvider>
      </MemoryRouter>,
    );
  };

  it("offers the seven destinations, marks the current one, and gives the body the one shared look", async () => {
    shell(day());
    const nav = await screen.findByRole("navigation", { name: "Main" });
    expect(within(nav).getAllByRole("link").map((l) => [l.textContent, l.getAttribute("href")])).toEqual([
      ["Today", "/"],
      ["Classes", "/classes"],
      ["Lessons", "/curriculum"],
      ["Assessments", "/assessments"],
      ["Insights", "/insights"],
      ["Misconception Atlas", "/atlas"],
      ["Offline", "/offline"],
    ]);
    expect(within(nav).getByRole("link", { name: "Insights" })).toHaveAttribute("aria-current", "page");
    expect(document.body).toHaveClass("studio");
  });

  it("counts what needs the teacher from real records and shows a running lesson for one-tap return", async () => {
    const running = { classId: "cl1", className: "6A", weekday: 4, period: 1, startsAt: "09:00", endsAt: "09:40", subject: "Mathematics", date: "2026-10-29", run: "checking" as const, noLesson: null, lesson: { conceptId: "c1", title: "Adding fractions", learningObjective: "o", chapterTitle: "Fractions", chapterOrder: 1, taught: false } };
    shell(day({ schedule: [running], attention: [{ kind: "check_open", text: "A check is open", href: "/activities/a1", count: 2 }] }));
    expect(await screen.findByRole("link", { name: "Needs you: 2" })).toHaveAttribute("href", "/#needs");
    expect(screen.getByRole("link", { name: /6A: Adding fractions/ })).toHaveAttribute("href", "/classes/cl1/lessons/c1");
  });
});
