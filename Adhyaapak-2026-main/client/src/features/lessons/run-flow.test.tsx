import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AssessmentDetailDto, DashboardResponse, LessonResponse, LessonRunDto, RunRecap, RunSummary } from "@adhyaapak/shared";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { AuthProvider } from "../auth/AuthContext";
import { DashboardPage } from "../teacher-dashboard/DashboardPage";
import { LessonPage } from "./LessonPage";

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
afterEach(() => vi.unstubAllGlobals());

const runDto = (state: LessonRunDto["state"], assessmentId: string | null = null): LessonRunDto => ({ state, runDate: "2026-10-29", assessmentId, startedAt: state === "not_started" ? null : "2026-10-29T04:00:00.000Z", wrappedAt: state === "done" ? "2026-10-29T05:00:00.000Z" : null });

const question = (id: string, stem: string) => ({
  id, key: id, role: "diagnostic" as const, difficulty: 2, stem, options: [{ id: "a", text: "2/5", misconceptionKey: "adds" }, { id: "b", text: "5/6" }], correctOptionId: "b", explanation: "e", reviewStatus: "approved" as const, conceptId: "c1", conceptTitle: "Adding fractions",
});

const lesson: LessonResponse = {
  classId: "cl1",
  chapter: { title: "Fractions", order: 1, summary: "Fractions describe equal parts.", keyIdeas: ["A fraction needs equal parts."] },
  concept: { id: "c1", key: "adding", title: "Adding fractions", description: "d", learningObjective: "Add fractions.", chapter: { id: "ch", title: "Fractions" }, prerequisites: [], dependents: [], resources: [], questions: [], misconceptions: [], provenance: { source: "original" }, reviewStatus: "approved" },
  questions: [question("q1", "1/2 + 1/3 = ?"), question("q2", "1/4 + 1/4 = ?")],
  flow: [{ key: "hook", minutes: 3, questionIds: ["q1"] }, { key: "teach", minutes: 10, questionIds: [] }, { key: "check", minutes: 5, questionIds: [] }, { key: "practise", minutes: 10, questionIds: ["q2"] }, { key: "exit_ticket", minutes: 3, questionIds: [] }],
  taught: null,
  insights: { studentCount: 2, counts: { not_enough_evidence: 2, needs_foundation: 0, developing: 0, likely_secure: 0, ready_for_challenge: 0 }, patterns: [] },
};

const recap: RunRecap = { studentCount: 8, previous: { lessonTitle: "Equivalent fractions", date: "2026-10-28", patterns: [{ name: "Adds the denominators", studentCount: 5 }] }, prerequisites: [{ conceptId: "p1", title: "Finding a common denominator", assessed: 8, notSecure: 3 }] };

const detail: AssessmentDetailDto = {
  id: "a1", classId: "cl1", classJoinCode: "ABC234", title: "Check: Adding fractions", type: "diagnostic", status: "open",
  questions: [question("q1", "1/2 + 1/3 = ?")],
  students: [
    { id: "s1", name: "Ravi", rosterNumber: 1, submitted: true, joined: true, score: { correct: 1, answered: 1, total: 1 } },
    { id: "s2", name: "Meera", rosterNumber: 2, submitted: false, joined: true, score: null },
  ],
  resultsReleased: false,
  tallies: [{ questionId: "q1", answered: 1, options: [{ optionId: "a", count: 0, misconception: "Adds the denominators" }, { optionId: "b", count: 1, misconception: null }], insufficient: 0 }],
};

const summary: RunSummary = {
  run: runDto("needs_wrap", "a1"), conceptId: "c1", conceptTitle: "Adding fractions", checkTitle: "Check: Adding fractions", answered: 8, studentCount: 8,
  questions: [{ questionId: "q1", stem: "1/2 + 1/3 = ?", answered: 8, noEvidence: 0, options: [{ optionId: "a", text: "2/5", count: 5, correct: false, pattern: "Adds the denominators" }, { optionId: "b", text: "5/6", count: 3, correct: true, pattern: null }] }],
  patterns: [{ name: "Adds the denominators", studentCount: 5 }],
  recommendation: { action: "reteach", headline: "Re-explain: 5 answers followed the pattern “Adds the denominators”", reason: "5 of 8 answers matched this error pattern.", sufficiency: "enough", teacherReviewRequired: true },
  groups: [{ key: "foundation", students: [{ studentId: "s1", rosterNumber: 1, name: "Ravi", assigned: false, reason: "Chose the answer that adds the denominators twice.", prerequisiteTitles: ["Equivalent fractions"] }] }, { key: "guided", students: [] }, { key: "challenge", students: [] }, { key: "follow_up", students: [] }],
  taught: false,
  resultsReleased: false,
};

function mockApi(routes: Record<string, () => Promise<Response>>) {
  const calls: Array<{ key: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${String(input)}`;
      calls.push({ key, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      const h = routes[key];
      if (!h) throw new Error(`Unmocked request: ${key}`);
      return h();
    }),
  );
  return calls;
}
const L = "/api/v1/classes/cl1/lessons/c1";
const renderLesson = (search = "") =>
  render(
    <MemoryRouter initialEntries={[`/classes/cl1/lessons/c1${search}`]}>
      <Routes>
        <Route path="/classes/:classId/lessons/:conceptId" element={<LessonPage />} />
        <Route path="/" element={<p>Today page</p>} />
      </Routes>
    </MemoryRouter>,
  );

describe("lesson flow: which step opens", () => {
  it("opens on Prepare for a lesson that has not started, and on Wrap up for one waiting to be wrapped", async () => {
    mockApi({ [`GET ${L}`]: () => json(200, lesson), [`GET ${L}/run`]: () => json(200, runDto("not_started")), [`GET ${L}/run/recap`]: () => json(200, recap) });
    const first = renderLesson();
    expect(await screen.findByRole("heading", { name: "Before you start" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("1. Prepare");
    first.unmount();

    mockApi({ [`GET ${L}`]: () => json(200, lesson), [`GET ${L}/run`]: () => json(200, runDto("needs_wrap", "a1")), [`GET ${L}/run/summary`]: () => json(200, summary), "GET /api/v1/classes/cl1/timetable": () => json(200, { upcoming: [] }) });
    renderLesson();
    expect(await screen.findByRole("heading", { name: "What the check showed" })).toBeInTheDocument();
    expect(screen.getByRole("listitem", { current: "step" })).toHaveTextContent("4. Wrap up");
  });
});

describe("Prepare", () => {
  it("shows last time's patterns, how many are not secure on earlier ideas, and starts the lesson", async () => {
    const calls = mockApi({
      [`GET ${L}`]: () => json(200, lesson),
      [`GET ${L}/run`]: () => json(200, runDto("not_started")),
      [`GET ${L}/run/recap`]: () => json(200, recap),
      [`POST ${L}/run`]: () => json(200, runDto("teaching")),
    });
    renderLesson();
    expect(await screen.findByText(/Adds the denominators · 5 students/)).toBeInTheDocument();
    expect(screen.getByText("3 of 8 not yet secure")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Present on a projector" })).toHaveAttribute("href", "/present/c1");
    await userEvent.click(screen.getByRole("button", { name: /Start the lesson/ }));
    await waitFor(() => expect(calls.some((c) => c.key === `POST ${L}/run`)).toBe(true));
    expect(await screen.findByRole("button", { name: /Start the 2-minute check/ })).toBeInTheDocument();
  });
});

describe("Check", () => {
  it("starts the check with the chosen questions in one call", async () => {
    const calls = mockApi({
      [`GET ${L}`]: () => json(200, lesson),
      [`GET ${L}/run`]: () => json(200, runDto("teaching")),
      "POST /api/v1/classes/cl1/assessments/suggest": () => json(200, { questions: [question("q1", "1/2 + 1/3 = ?")] }),
      [`POST ${L}/run/check/start`]: () => json(200, { run: runDto("checking", "a1"), assessmentId: "a1", questions: [question("q1", "x")] }),
    });
    renderLesson("?step=check");
    await screen.findByText("1/4 + 1/4 = ?");
    // The server's pick (q1) is ticked; the teacher also ticks q2.
    await waitFor(() => expect(screen.getByRole("checkbox", { name: /1\/2 \+ 1\/3/ })).toBeChecked());
    await userEvent.click(screen.getByRole("checkbox", { name: /1\/4 \+ 1\/4/ }));
    await userEvent.click(screen.getByRole("button", { name: "Start the check" }));
    const start = calls.find((c) => c.key === `POST ${L}/run/check/start`)!;
    expect(start.body).toEqual({ questionIds: ["q1", "q2"] });
  });

  it("shows paper entry by default, the join code on the devices tab, and a hands-up count that says it is not saved", async () => {
    mockApi({
      [`GET ${L}`]: () => json(200, lesson),
      [`GET ${L}/run`]: () => json(200, runDto("checking", "a1")),
      "GET /api/v1/assessments/a1": () => json(200, detail),
    });
    renderLesson("?step=check");
    expect(await screen.findByRole("heading", { name: "Key in the answers from paper" })).toBeInTheDocument();
    expect(screen.getByText("1 of 2 students have submitted")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Print answer slips" })).toHaveAttribute("href", "/activities/a1/print-sheets");

    await userEvent.click(screen.getByRole("tab", { name: "Student devices" }));
    expect(screen.getByText("ABC234")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Hands-up count" }));
    expect(screen.getByText(/not saved and is not added to any student's record/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Add one for B, question 1" }));
    await userEvent.click(screen.getByRole("button", { name: "Add one for B, question 1" }));
    expect(within(screen.getByRole("article")).getByText("2")).toBeInTheDocument();
  });

  it("shows live scores for the teacher only: who joined, who answered, and how many were right", async () => {
    mockApi({
      [`GET ${L}`]: () => json(200, lesson),
      [`GET ${L}/run`]: () => json(200, runDto("checking", "a1")),
      "GET /api/v1/assessments/a1": () => json(200, detail),
    });
    renderLesson("?step=check");
    const board = (await screen.findByRole("heading", { name: "Live scores" })).closest("section")!;
    expect(within(board).getByText("Only you see this")).toBeInTheDocument();
    expect(within(board).getByText("1 of 1 answers right so far")).toBeInTheDocument();
    const ravi = within(board).getByText("Ravi").closest("tr")!;
    expect(within(ravi).getByText(/Answered/)).toBeInTheDocument();
    expect(within(ravi).getByText("1 / 1")).toBeInTheDocument();
    const meera = within(board).getByText("Meera").closest("tr")!;
    expect(within(meera).getByText("Joined")).toBeInTheDocument();
    expect(within(meera).getByText("–")).toBeInTheDocument();
  });

  it("pauses and resumes the check, saying what pausing means for students", async () => {
    let state: "checking" | "paused" = "checking";
    const calls = mockApi({
      [`GET ${L}`]: () => json(200, lesson),
      [`GET ${L}/run`]: () => json(200, runDto(state, "a1")),
      "GET /api/v1/assessments/a1": () => json(200, detail),
      [`POST ${L}/run/pause`]: () => {
        state = "paused";
        return json(200, runDto("paused", "a1"));
      },
      [`POST ${L}/run/resume`]: () => {
        state = "checking";
        return json(200, runDto("checking", "a1"));
      },
    });
    renderLesson("?step=check");
    await userEvent.click(await screen.findByRole("button", { name: "Pause the check" }));
    expect(await screen.findByText(/Students' devices are not taking new answers/)).toBeInTheDocument();
    // Paper entry stays available while paused.
    expect(screen.getByRole("tab", { name: "Paper answers" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resume the check" }));
    await waitFor(() => expect(screen.queryByText(/Students' devices are not taking new answers/)).not.toBeInTheDocument());
    expect(calls.filter((c) => c.key.endsWith("/run/pause") || c.key.endsWith("/run/resume")).map((c) => c.key.split("/").pop())).toEqual(["pause", "resume"]);
  });

  it("says plainly when the connection is lost: offline, and that keyed answers cannot be saved", async () => {
    const online = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
    mockApi({
      [`GET ${L}`]: () => json(200, lesson),
      [`GET ${L}/run`]: () => json(200, runDto("checking", "a1")),
      "GET /api/v1/assessments/a1": () => json(200, detail),
    });
    renderLesson("?step=check");
    expect(await screen.findByText(/You are offline\. Answers keyed in now cannot be saved/)).toBeInTheDocument();
    expect(screen.getByText(/Offline/, { selector: ".chip" })).toBeInTheDocument();
    online.mockRestore();
  });

  it("shows a reconnecting state (not 'Live') while the live connection is down", async () => {
    mockApi({
      [`GET ${L}`]: () => json(200, lesson),
      [`GET ${L}/run`]: () => json(200, runDto("checking", "a1")),
      "GET /api/v1/assessments/a1": () => json(200, detail),
    });
    renderLesson("?step=check");
    // No EventSource in the test environment, so the connection is never up.
    expect(await screen.findByText(/Reconnecting…/)).toBeInTheDocument();
    expect(screen.queryByText(/● Live/)).not.toBeInTheDocument();
  });

  it("keeps the lesson's own timeline, with a jump link for every part of the plan", async () => {
    mockApi({ [`GET ${L}`]: () => json(200, lesson), [`GET ${L}/run`]: () => json(200, runDto("teaching")) });
    renderLesson("?step=teach");
    const nav = await screen.findByRole("navigation", { name: "Jump to a part of the lesson" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["#seg-hook", "#seg-teach", "#seg-check", "#seg-practise", "#seg-exit_ticket"]);
  });

  it("closes the check when the teacher asks to see results, then shows the wrap-up", async () => {
    let finished = false;
    const calls = mockApi({
      [`GET ${L}`]: () => json(200, lesson),
      [`GET ${L}/run`]: () => json(200, runDto(finished ? "needs_wrap" : "checking", "a1")),
      "GET /api/v1/assessments/a1": () => json(200, detail),
      [`POST ${L}/run/check/finish`]: () => {
        finished = true;
        return json(200, runDto("needs_wrap", "a1"));
      },
      [`GET ${L}/run/summary`]: () => json(200, summary),
      "GET /api/v1/classes/cl1/timetable": () => json(200, { upcoming: [] }),
    });
    renderLesson("?step=check");
    await userEvent.click(await screen.findByRole("button", { name: /See results/ }));
    await waitFor(() => expect(calls.some((c) => c.key === `POST ${L}/run/check/finish`)).toBe(true));
    expect(await screen.findByRole("heading", { name: "What the check showed" })).toBeInTheDocument();
  });
});

describe("Wrap up", () => {
  const wrapRoutes = () => ({
    [`GET ${L}`]: () => json(200, lesson),
    [`GET ${L}/run`]: () => json(200, runDto("needs_wrap", "a1")),
    [`GET ${L}/run/summary`]: () => json(200, summary),
    "GET /api/v1/classes/cl1/timetable": () => json(200, { upcoming: [{ date: "2026-10-30", period: 3, startsAt: "10:30", endsAt: "11:10", subject: "Mathematics", weekday: 5, lesson: { conceptId: "c2", title: "Subtracting fractions", learningObjective: "o", chapterTitle: "Fractions", chapterOrder: 1, taught: false }, noLesson: null }] }),
  });

  it("explains the advice with its reason and evidence, names the pattern, and lets the teacher dismiss it", async () => {
    mockApi(wrapRoutes());
    renderLesson("?step=wrap");
    const rec = await screen.findByRole("heading", { name: /Re-explain: 5 answers followed the pattern/ });
    const box = rec.closest("section")!;
    expect(within(box).getByText("5 of 8 answers matched this error pattern.")).toBeInTheDocument();
    expect(within(box).getByText("Enough answers to say")).toBeInTheDocument();
    expect(screen.getByText("Subtracting fractions")).toBeInTheDocument();
    await userEvent.click(within(box).getByRole("button", { name: "Dismiss this advice" }));
    expect(screen.queryByRole("heading", { name: /Re-explain/ })).not.toBeInTheDocument();
  });

  it("lets the teacher release results to students, once", async () => {
    let released = false;
    const calls = mockApi({
      ...wrapRoutes(),
      [`GET ${L}/run/summary`]: () => json(200, { ...summary, resultsReleased: released }),
      "POST /api/v1/assessments/a1/release-results": () => {
        released = true;
        return json(200, { released: true });
      },
    });
    renderLesson("?step=wrap");
    await userEvent.click(await screen.findByRole("button", { name: "Show students their results" }));
    expect(await screen.findByText(/Each student sees only their own answers/)).toBeInTheDocument();
    expect(calls.filter((c) => c.key === "POST /api/v1/assessments/a1/release-results")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Show students their results" })).not.toBeInTheDocument();
  });

  it("finishes with what the teacher chose, never assigning behind their back, and returns to Today", async () => {
    const calls = mockApi({ ...wrapRoutes(), [`POST ${L}/run/wrap`]: () => json(200, { run: runDto("done", "a1"), assigned: 0 }) });
    renderLesson("?step=wrap");
    await userEvent.click(await screen.findByRole("button", { name: "Finish" }));
    // Ending the session asks first, and says what will be recorded.
    expect(await screen.findByRole("alertdialog")).toHaveTextContent("End this lesson session?");
    expect(screen.getByRole("alertdialog")).toHaveTextContent("recorded as taught");
    // Next steps are assigned from their own panel, so Finish never assigns (it could ignore the teacher's moves).
    expect(screen.getByRole("alertdialog")).not.toHaveTextContent("groups are assigned");
    expect(screen.queryByRole("checkbox", { name: /Assign the suggested groups/ })).not.toBeInTheDocument();
    expect(calls.some((c) => c.key === `POST ${L}/run/wrap`)).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Yes, end the session" }));
    const wrap = await waitFor(() => calls.find((c) => c.key === `POST ${L}/run/wrap`)!);
    expect(wrap.body).toEqual({ markTaught: true, assignGroups: false });
    expect(await screen.findByText("Today page")).toBeInTheDocument();
  });

  it("shows each path with its students and reasons, and assigns them as suggested", async () => {
    const calls = mockApi({ ...wrapRoutes(), "POST /api/v1/classes/cl1/interventions": () => json(201, { assigned: [{ studentId: "s1", interventionId: "i1" }], skipped: [] }) });
    renderLesson("?step=wrap");
    const foundation = await screen.findByRole("article", { name: /Foundation/ });
    expect(within(foundation).getByText(/1. Ravi/)).toBeInTheDocument();
    expect(within(foundation).getByText("Chose the answer that adds the denominators twice.")).toBeInTheDocument();
    expect(within(foundation).getByText("Revise first: Equivalent fractions")).toBeInTheDocument();
    expect(within(screen.getByRole("article", { name: /Needs more evidence/ })).getByText(/Not a struggling group/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Assign these next steps (1 student)" }));
    expect(calls.find((c) => c.key === "POST /api/v1/classes/cl1/interventions")!.body).toEqual({ conceptId: "c1", assignments: [{ studentId: "s1", groupKey: "foundation" }] });
    expect(await screen.findByText("Next activity assigned to 1 student.", { exact: false })).toBeInTheDocument();
  });

  it("needs a reason before a moved student can be assigned, and sends it with the move", async () => {
    const calls = mockApi({ ...wrapRoutes(), "POST /api/v1/classes/cl1/interventions": () => json(201, { assigned: [{ studentId: "s1", interventionId: "i1" }], skipped: [] }) });
    renderLesson("?step=wrap");
    await userEvent.selectOptions(await screen.findByRole("combobox", { name: "Path for Ravi" }), "guided");
    const guided = screen.getByRole("article", { name: /Guided practice/ });
    expect(within(guided).getByText(/Moved from Foundation/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Assign these next steps/ }));
    expect(await screen.findByText("Please say why you moved: Ravi.")).toBeInTheDocument();
    expect(calls.some((c) => c.key === "POST /api/v1/classes/cl1/interventions")).toBe(false);
    await userEvent.type(screen.getByRole("textbox", { name: "Why move Ravi?" }), "Got it right on the board today");
    await userEvent.click(screen.getByRole("button", { name: /Assign these next steps/ }));
    expect(calls.find((c) => c.key === "POST /api/v1/classes/cl1/interventions")!.body).toEqual({ conceptId: "c1", assignments: [{ studentId: "s1", groupKey: "guided", movedReason: "Got it right on the board today" }] });
  });

  it("lets the teacher back out of ending the session without anything being saved", async () => {
    const calls = mockApi({ ...wrapRoutes(), [`POST ${L}/run/wrap`]: () => json(200, { run: runDto("done", "a1"), assigned: 0 }) });
    renderLesson("?step=wrap");
    await userEvent.click(await screen.findByRole("button", { name: "Finish" }));
    await userEvent.click(await screen.findByRole("button", { name: "Not yet" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(calls.some((c) => c.key === `POST ${L}/run/wrap`)).toBe(false);
  });
});

describe("Today: one next action per state", () => {
  const period = (run: DashboardResponse["schedule"][number]["run"]) => ({
    classId: "cl1", className: "6A", weekday: 4, period: 1, startsAt: "09:00", endsAt: "09:40", subject: "Mathematics", date: "2026-10-29", run,
    lesson: { conceptId: "c1", title: "Adding fractions", learningObjective: "Add fractions.", chapterTitle: "Fractions", chapterOrder: 1, taught: false }, noLesson: null,
  });
  const dash = (over: Partial<DashboardResponse>): DashboardResponse => ({
    classes: [{ id: "cl1", name: "6A", grade: 6, academicYear: "2026-27", joinCode: "ABC234", portalEnabled: false, studentCount: 8 }],
    today: [], schedule: [period("not_started")], tomorrow: [], week: [], weekStart: "2026-10-26", attention: [], setup: { hasClass: true, hasStudents: true, hasTaught: true }, ...over,
  });
  const renderToday = (d: DashboardResponse) => {
    mockApi({ "GET /api/v1/auth/me": () => json(200, { user: { id: "u1", name: "Asha", email: "a@example.com", role: "teacher" } }), "GET /api/v1/dashboard": () => json(200, d) });
    return render(
      <MemoryRouter>
        <AuthProvider>
          <DashboardPage />
        </AuthProvider>
      </MemoryRouter>,
    );
  };

  it.each([
    ["not_started", "Prepare the lesson", "prepare"],
    ["teaching", "Continue the lesson", "teach"],
    ["checking", "Continue the check", "check"],
    ["needs_wrap", "Wrap up", "wrap"],
  ] as const)("a lesson that is %s offers “%s”", async (run, label, step) => {
    renderToday(dash({ schedule: [period(run)] }));
    const link = await screen.findByRole("link", { name: new RegExp(label) });
    expect(link).toHaveAttribute("href", `/classes/cl1/lessons/c1?step=${step}`);
  });

  it("says when everything planned for today is wrapped up", async () => {
    renderToday(dash({ schedule: [period("done")] }));
    expect(await screen.findByText("Every lesson planned for today is wrapped up.")).toBeInTheDocument();
  });

  it("counts what needs the teacher from real records, links each count to the work, and links nothing at zero", async () => {
    const first = renderToday(dash({ attention: [{ kind: "needs_wrap", text: "Wrap up “Adding fractions” in 6A: the check is finished.", href: "/classes/cl1/lessons/c1?step=wrap", count: 1 }] }));
    const box = (await screen.findByRole("heading", { name: "Needs you" })).closest("section")!;
    const link = within(box).getByRole("link", { name: "To wrap up :" });
    expect(link).toHaveAttribute("href", "/classes/cl1/lessons/c1?step=wrap");
    expect(link).toHaveAttribute("title", "Wrap up “Adding fractions” in 6A: the check is finished.");
    expect(link.closest("li")).toHaveTextContent("1");
    first.unmount();
    renderToday(dash({}));
    const empty = (await screen.findByRole("heading", { name: "Needs you" })).closest("section")!;
    expect(within(empty).queryAllByRole("link")).toHaveLength(0);
    expect(empty).toHaveTextContent("Checks open :0");
  });

  it("shows a getting-started list ticked from real setup, and no list once everything is done", async () => {
    const first = renderToday(dash({ setup: { hasClass: true, hasStudents: false, hasTaught: false } }));
    const box = (await screen.findByRole("heading", { name: "Getting started" })).closest("section")!;
    expect(within(box).getByRole("link", { name: "Add your students" })).toBeInTheDocument();
    expect(within(box).getByText("(done)")).toBeInTheDocument(); // only "Create your class" is done
    first.unmount();
    renderToday(dash({}));
    await screen.findByRole("heading", { name: "Today's periods" });
    expect(screen.queryByRole("heading", { name: "Getting started" })).not.toBeInTheDocument();
  });

  it("offers tomorrow's lesson so the teacher can get ready the evening before", async () => {
    renderToday(dash({ tomorrow: [{ ...period(null), date: "2026-10-30", weekday: 5, lesson: { conceptId: "c2", title: "Subtracting fractions", learningObjective: "o", chapterTitle: "Fractions", chapterOrder: 1, taught: false } }] }));
    const link = await screen.findByRole("link", { name: "Get ready" });
    expect(link).toHaveAttribute("href", "/classes/cl1/lessons/c2?step=prepare");
  });
});
