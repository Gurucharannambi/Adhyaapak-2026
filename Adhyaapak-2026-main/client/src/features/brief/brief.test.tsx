import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PracticeResultResponse, PracticeSetResponse, StudentHomeResponse, TeachingBriefDto } from "@adhyaapak/shared";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { LearnPage } from "../student-portal/LearnPage";
import { PracticePage } from "../student-portal/PracticePage";
import { BriefPage } from "./BriefPage";

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
type Handler = () => Promise<Response>;

function mount(route: string, element: React.ReactNode, path: string, handlers: Record<string, Handler>) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      calls.push(key + (typeof init?.body === "string" ? ` ${init.body}` : ""));
      const h = handlers[key];
      if (!h) throw new Error(`Unmocked request: ${key}`);
      return h();
    }),
  );
  render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="/join" element={<p>join page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const C1 = "11111111-1111-4111-8111-111111111111";
const brief = (): TeachingBriefDto => ({
  id: "b1", classId: "c1", className: "6A", createdAt: "2026-10-28T10:00:00Z", basis: { students: 6, conceptsWithEvidence: 1, answersRecorded: 10 },
  items: [
    { id: "revision:x", section: "revision", kind: "measured", text: "Adding fractions: 2 of 5 students need more practice.", evidence: [{ type: "concept_status", conceptId: C1, label: "Learning map: Adding fractions" }], basedOn: [], status: "proposed", editedText: null, rollNumbers: [1, 2] },
    { id: "activity:main", section: "activity", kind: "inferred", text: "Start with a 5–10 minute revision.", evidence: [{ type: "concept_status", conceptId: C1, label: "Learning map: Adding fractions" }], basedOn: ["revision:x"], status: "proposed", editedText: null, rollNumbers: [1, 2] },
  ],
});

describe("BriefPage", () => {
  const open = (b = brief()) =>
    mount("/classes/c1/brief", <BriefPage />, "/classes/:classId/brief", {
      "GET /api/v1/classes/c1/teaching-briefs": () => json(200, { briefs: [] }),
      "POST /api/v1/classes/c1/teaching-briefs": () => json(201, b),
    });

  it("separates what the records show from what is suggested, and shows what each rests on", async () => {
    open();
    await userEvent.click(await screen.findByRole("button", { name: "Make a new brief" }));
    expect(await screen.findByText(/2 of 5 students need more practice/)).toBeInTheDocument();
    expect(screen.getByText("From records")).toBeInTheDocument();
    expect(screen.getByText("Suggestion")).toBeInTheDocument();
    expect(screen.getByText(/rests on 1 line above/)).toBeInTheDocument();
    expect(screen.getAllByRole("link", { name: "Learning map: Adding fractions" })).toHaveLength(2);
    expect(screen.getByText(/Based on 10 recorded answers from 6 students/)).toBeInTheDocument();
    expect(screen.getAllByText(/Roll no\.: 1, 2/)).toHaveLength(2);
  });

  it("sends the teacher's decision for a line and hides a dismissed one", async () => {
    const b = brief();
    const calls = mount("/classes/c1/brief", <BriefPage />, "/classes/:classId/brief", {
      "GET /api/v1/classes/c1/teaching-briefs": () => json(200, { briefs: [] }),
      "POST /api/v1/classes/c1/teaching-briefs": () => json(201, b),
      "PATCH /api/v1/teaching-briefs/b1/items/activity%3Amain": () => json(200, { ...b, items: b.items.map((i) => (i.id === "activity:main" ? { ...i, status: "dismissed" } : i)) }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Make a new brief" }));
    const item = (await screen.findByText(/Start with a 5–10 minute revision/)).closest("li")!;
    await userEvent.click(within(item).getByRole("button", { name: "Dismiss" }));
    expect(calls.find((c) => c.startsWith("PATCH"))).toContain('{"status":"dismissed"}');
    await vi.waitFor(() => expect(screen.queryByText(/Start with a 5–10 minute revision/)).not.toBeInTheDocument());
    expect(screen.getByText(/2 of 5 students need more practice/)).toBeInTheDocument();
  });

  it("measured lines cannot be marked done; accepted suggestions can", async () => {
    const b = brief();
    b.items[1]!.status = "accepted";
    open(b);
    await userEvent.click(await screen.findByRole("button", { name: "Make a new brief" }));
    const suggestion = (await screen.findByText(/Start with a 5–10 minute revision/)).closest("li")!;
    expect(within(suggestion).getByRole("button", { name: "Mark done" })).toBeInTheDocument();
    const measured = screen.getByText(/2 of 5 students need more practice/).closest("li")!;
    expect(within(measured).queryByRole("button", { name: "Mark done" })).not.toBeInTheDocument();
  });
});

describe("LearnPage", () => {
  const home = (over: Partial<StudentHomeResponse> = {}): StudentHomeResponse => ({
    studentName: "Ravi", activityOpen: false,
    next: { kind: "practice", conceptId: C1, mode: "guided", title: "Practise: Adding fractions", why: "You already know some of this.", minutes: 10 },
    progress: [{ conceptId: C1, title: "Adding fractions", word: "getting_there" }], revisit: [{ conceptId: "c2", title: "Fractions of a whole" }], ...over,
  });

  it("shows one next step with a reason, friendly progress words, and nothing technical", async () => {
    mount("/learn", <LearnPage />, "/learn", { "GET /api/v1/student/home": () => json(200, home()) });
    expect(await screen.findByRole("heading", { name: "Hello, Ravi" })).toBeInTheDocument();
    expect(screen.getByText("You already know some of this.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Start/ })).toHaveAttribute("href", `/learn/practice?conceptId=${C1}&mode=guided`);
    expect(screen.getByText("getting there")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Fractions of a whole" })).toHaveAttribute("href", "/learn/practice?conceptId=c2&mode=revisit");
    expect(document.body.textContent).not.toMatch(/needs_foundation|evidence|mastery|score|rank/i);
  });

  it("points to an open activity, and explains when practice is off", async () => {
    mount("/learn", <LearnPage />, "/learn", { "GET /api/v1/student/home": () => json(200, home({ activityOpen: true, next: null, progress: [], revisit: [] })) });
    expect(await screen.findByRole("link", { name: "Go to it" })).toHaveAttribute("href", "/play");
    expect(screen.getByText(/has not turned on practice yet/)).toBeInTheDocument();
  });

  it("sends a student who is not signed in back to join", async () => {
    mount("/learn", <LearnPage />, "/learn", { "GET /api/v1/student/home": () => json(401, { error: { code: "unauthenticated", message: "Join again." }, requestId: "r" }) });
    expect(await screen.findByText("join page")).toBeInTheDocument();
  });
});

describe("PracticePage", () => {
  const set: PracticeSetResponse = {
    setId: "s1", title: "Practice: Adding fractions", conceptTitle: "Adding fractions",
    questions: [{ id: C1, stem: "1/2 + 1/3 = ?", options: [{ id: "a", text: "2/5" }, { id: "b", text: "5/6" }] }],
  };
  const result: PracticeResultResponse = { results: [{ questionId: C1, correct: true, correctOptionId: "b", explanation: "Common denominator." }], message: "Well done. You got them all." };
  const open = (extra: Record<string, Handler> = {}) =>
    mount(`/learn/practice?conceptId=${C1}&mode=guided`, <PracticePage />, "/learn/practice", {
      [`GET /api/v1/student/practice?conceptId=${C1}&mode=guided`]: () => json(200, set),
      ...extra,
    });

  it("shows no answers before finishing, climbs the hint ladder one rung at a time, and sends how many hints were used", async () => {
    const calls = open({
      [`GET /api/v1/student/practice/s1/hint?questionId=${C1}&level=1`]: () => json(200, { level: 1, text: "Think about this idea: add fractions.", more: true }),
      [`GET /api/v1/student/practice/s1/hint?questionId=${C1}&level=2`]: () => json(200, { level: 2, text: "Here is a first step to try: find a common denominator.", more: true }),
      "POST /api/v1/student/practice/s1/submit": () => json(200, result),
    });
    expect(await screen.findByText(/1\/2 \+ 1\/3 = \?/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/✓|Common denominator/);

    await userEvent.click(screen.getByRole("button", { name: "Give me a hint" }));
    expect(await screen.findByText(/Think about this idea/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "More help" }));
    expect(await screen.findByText(/find a common denominator/)).toBeInTheDocument();

    await userEvent.click(screen.getByLabelText(/B\. 5\/6/));
    await userEvent.click(screen.getByRole("button", { name: "Finish" }));
    expect(await screen.findByText("Well done. You got them all.")).toBeInTheDocument();
    expect(screen.getByText("You got it.")).toBeInTheDocument();
    expect(screen.getByText(/Common denominator\./)).toBeInTheDocument();
    expect(calls.find((c) => c.startsWith("POST"))).toContain(`"answers":[{"questionId":"${C1}","optionId":"b","hintLevel":2}]`);
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  });

  it("an unanswered question is sent as no answer, and the page says it kindly", async () => {
    const calls = open({ "POST /api/v1/student/practice/s1/submit": () => json(200, { ...result, results: [{ ...result.results[0]!, correct: null }], message: "Thanks for trying." }) });
    await userEvent.click(await screen.findByRole("button", { name: "Finish" }));
    expect(await screen.findByText(/You left this one/)).toBeInTheDocument();
    expect(calls.find((c) => c.startsWith("POST"))).toContain('"optionId":null');
  });

  it("shows the server's message when practice is not available", async () => {
    mount(`/learn/practice?conceptId=${C1}&mode=guided`, <PracticePage />, "/learn/practice", {
      [`GET /api/v1/student/practice?conceptId=${C1}&mode=guided`]: () => json(403, { error: { code: "forbidden", message: "Your teacher has not turned on practice for your class yet." }, requestId: "r" }),
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("has not turned on practice");
  });
});
