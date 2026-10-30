import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DashboardResponse, TimetableResponse } from "@adhyaapak/shared";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { AuthProvider } from "../auth/AuthContext";
import { DashboardPage } from "../teacher-dashboard/DashboardPage";
import { TimetablePage } from "./TimetablePage";

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
afterEach(() => vi.unstubAllGlobals());

function mockApi(routes: Record<string, () => Promise<Response>>) {
  const calls: Array<{ key: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${String(input)}`;
      calls.push({ key, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      const handler = routes[key];
      if (!handler) throw new Error(`Unmocked call: ${key}`);
      return handler();
    }),
  );
  return calls;
}

const lesson = (title: string, taught = false) => ({ conceptId: `c-${title}`, title, learningObjective: `Objective for ${title}.`, chapterTitle: "Fractions", chapterOrder: 1, taught });

const dashboardBase = { tomorrow: [], week: [], weekStart: "2026-10-26", attention: [], setup: { hasClass: true, hasStudents: true, hasTaught: true } };
const dashboard: DashboardResponse = {
  ...dashboardBase,
  classes: [{ id: "cl1", name: "6A", grade: 6, academicYear: "2026-27", joinCode: "ABC234", portalEnabled: false, studentCount: 8 }],
  today: [{ id: "start-cl1", kind: "start_teaching", classId: "cl1", text: "Open 6A (8 students)." }],
  schedule: [
    { classId: "cl1", className: "6A", weekday: 4, period: 1, startsAt: "09:00", endsAt: "09:40", subject: "Mathematics", date: "2026-10-29", lesson: lesson("Equivalent fractions"), noLesson: null, run: "not_started" },
    { classId: "cl1", className: "6A", weekday: 4, period: 2, startsAt: "09:40", endsAt: "10:20", subject: "English", date: "2026-10-29", lesson: null, noLesson: "no_textbook", run: null },
  ],
};

describe("Today (dashboard)", () => {
  it("shows today's periods, with the planned lesson in each Mathematics period and no invented lesson elsewhere", async () => {
    mockApi({
      "GET /api/v1/auth/me": () => json(200, { user: { id: "u1", name: "Asha", email: "a@example.com", role: "teacher" } }),
      "GET /api/v1/dashboard": () => json(200, dashboard),
    });
    render(
      <MemoryRouter>
        <AuthProvider>
          <DashboardPage />
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole("heading", { name: "Today's periods" })).toBeInTheDocument();
    // The next lesson leads "Now and next", with the one action its state calls for.
    const now = screen.getByRole("heading", { name: "Lessons" }).closest("section")!;
    expect(within(now).getByText("Equivalent fractions")).toBeInTheDocument();
    expect(within(now).getByRole("link", { name: /Prepare the lesson/ })).toHaveAttribute("href", "/classes/cl1/lessons/c-Equivalent fractions?step=prepare");
    const english = screen.getByText(/No textbook for this subject yet/).closest("li")!;
    expect(english).toHaveTextContent("English");
    expect(within(english).queryByRole("link")).not.toBeInTheDocument();
  });
});

describe("TimetablePage", () => {
  const tt: TimetableResponse = {
    classId: "cl1",
    className: "6A",
    grade: 6,
    today: "2026-10-29",
    bookTitle: "Class 6 Mathematics",
    lessonsTotal: 24,
    lessonsTaught: 3,
    slots: [
      { weekday: 4, period: 1, startsAt: "09:00", endsAt: "09:40", subject: "Mathematics" },
      { weekday: 4, period: 2, startsAt: "09:40", endsAt: "10:20", subject: "English" },
    ],
    upcoming: [
      { weekday: 4, period: 1, startsAt: "09:00", endsAt: "09:40", subject: "Mathematics", date: "2026-10-29", lesson: lesson("Equivalent fractions"), noLesson: null },
      { weekday: 4, period: 2, startsAt: "09:40", endsAt: "10:20", subject: "English", date: "2026-10-29", lesson: null, noLesson: "no_textbook" },
    ],
  };

  const renderPage = () =>
    render(
      <MemoryRouter initialEntries={["/classes/cl1/timetable"]}>
        <Routes>
          <Route path="/classes/:classId/timetable" element={<TimetablePage />} />
        </Routes>
      </MemoryRouter>,
    );

  it("shows book progress and plans lessons only into Mathematics periods", async () => {
    mockApi({ "GET /api/v1/classes/cl1/timetable": () => json(200, tt) });
    renderPage();
    expect(await screen.findByText("3 of 24 lessons taught from Class 6 Mathematics")).toBeInTheDocument();
    const plan = screen.getByRole("heading", { name: "Lesson plan for the next two weeks" }).closest("section")!;
    expect(within(plan).getByText("Equivalent fractions")).toBeInTheDocument();
    expect(within(plan).queryByText("English")).not.toBeInTheDocument();
  });

  it("saves an edited week through the API and reloads the plan", async () => {
    const calls = mockApi({
      "GET /api/v1/classes/cl1/timetable": () => json(200, tt),
      "PUT /api/v1/classes/cl1/timetable": () => json(200, tt),
    });
    renderPage();
    await userEvent.click(await screen.findByRole("button", { name: "Change the timetable" }));
    await userEvent.selectOptions(screen.getByLabelText("Thursday, period 2"), "Mathematics");
    await userEvent.click(screen.getByRole("button", { name: "Save timetable" }));
    const put = calls.find((c) => c.key.startsWith("PUT"));
    expect((put!.body as { slots: Array<{ period: number; subject: string }> }).slots.find((s) => s.period === 2)!.subject).toBe("Mathematics");
    expect(await screen.findByText("Timetable saved. The lesson plan has been updated.")).toBeInTheDocument();
  });

  it("says plainly when there is no textbook for the class's grade", async () => {
    mockApi({ "GET /api/v1/classes/cl1/timetable": () => json(200, { ...tt, grade: 8, bookTitle: null, lessonsTotal: 0, lessonsTaught: 0 }) });
    renderPage();
    expect(await screen.findByText("There is no textbook for Class 8 yet. Only the timetable is shown.")).toBeInTheDocument();
  });
});
