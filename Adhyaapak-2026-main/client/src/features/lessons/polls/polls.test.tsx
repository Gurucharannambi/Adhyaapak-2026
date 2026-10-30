import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PollDto, StudentActivityResponse } from "@adhyaapak/shared";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../../i18n";
import { PlayPage } from "../../student-portal/PlayPage";
import { PollPanel } from "./PollPanel";

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
afterEach(() => vi.unstubAllGlobals());

const CUR = "/api/v1/classes/cl1/lessons/c1/polls/current";
const poll = (over: Partial<PollDto> = {}): PollDto => ({
  id: "p1",
  kind: "confidence",
  prompt: "How sure do you feel about this idea?",
  status: "open",
  options: [
    { id: "a", text: "I could explain it to a friend", count: 3 },
    { id: "b", text: "I mostly get it", count: 5 },
    { id: "c", text: "I am not sure yet", count: 2 },
    { id: "d", text: "I would like more help", count: 0 },
  ],
  answers: [],
  expectedAnswer: null,
  answered: 10,
  classSize: 12,
  createdAt: "2026-10-29T08:00:00Z",
  closedAt: null,
  ...over,
});

function mock(routes: Record<string, (body?: unknown) => Promise<Response>>) {
  const calls: Array<{ key: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${String(input)}`;
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ key, body });
      const h = routes[key];
      if (!h) throw new Error(`Unmocked ${key}`);
      return h(body);
    }),
  );
  return calls;
}

const renderPanel = () =>
  render(
    <MemoryRouter>
      <PollPanel classId="cl1" conceptId="c1" />
    </MemoryRouter>,
  );

describe("teacher quick poll", () => {
  it("shows live counts as numbers, says how many answered, and states that it is counts only", async () => {
    mock({ [`GET ${CUR}`]: () => json(200, { poll: poll() }) });
    renderPanel();
    expect(await screen.findByText("10 of 12")).toBeInTheDocument();
    const bars = screen.getByRole("list");
    expect(within(bars).getByText("I mostly get it").closest("li")).toHaveTextContent("5");
    expect(screen.getByRole("button", { name: "Close the poll" })).toBeEnabled();
  });

  it("asks a true/false poll with the teacher's own statement", async () => {
    let current: PollDto | null = null;
    const calls = mock({
      [`GET ${CUR}`]: () => json(200, { poll: current }),
      "POST /api/v1/classes/cl1/lessons/c1/polls": (b) => {
        current = poll({ kind: "true_false", prompt: (b as { prompt: string }).prompt, options: [{ id: "a", text: "True", count: 0 }, { id: "b", text: "False", count: 0 }], answered: 0 });
        return json(201, current);
      },
    });
    renderPanel();
    expect(await screen.findByText("No poll asked in this lesson yet.")).toBeInTheDocument();
    expect(screen.getByText(/who chose what is not shown/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /True or false/ }));
    await userEvent.type(screen.getByRole("textbox", { name: "Question" }), "2/4 is the same as 1/2");
    await userEvent.click(screen.getByRole("button", { name: "Ask the class" }));
    expect(calls.find((c) => c.key.startsWith("POST"))!.body).toEqual({ kind: "true_false", prompt: "2/4 is the same as 1/2" });
    expect(await screen.findByText("0 of 12")).toBeInTheDocument();
  });

  it("explains a refusal plainly and keeps the form (for example while a check is open)", async () => {
    mock({
      [`GET ${CUR}`]: () => json(200, { poll: null }),
      "POST /api/v1/classes/cl1/lessons/c1/polls": () => json(409, { error: { code: "conflict", message: "A check is open. Close it before asking a poll." }, requestId: "r" }),
    });
    renderPanel();
    await userEvent.click(await screen.findByRole("button", { name: "Ask the class" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("A check is open");
    expect(screen.getByRole("button", { name: "Ask the class" })).toBeEnabled();
  });

  it("groups typed answers for a short-answer question, marking the ones equal to the expected answer", async () => {
    mock({
      [`GET ${CUR}`]: () =>
        json(200, {
          poll: poll({ kind: "short_answer", prompt: "1/2 = ?/8", options: [], expectedAnswer: "4/8", answered: 4, answers: [{ label: "4/8", variants: ["1/2"], count: 3, matches: true }, { label: "2/8", variants: [], count: 1, matches: false }] }),
        }),
    });
    renderPanel();
    expect(await screen.findByText("4 of 12")).toBeInTheDocument();
    const first = screen.getByText("4/8").closest("li")!;
    expect(first).toHaveTextContent("(also 1/2)");
    expect(first).toHaveTextContent("✓ matches");
    expect(first).toHaveTextContent("3");
    expect(screen.getByText("2/8").closest("li")).not.toHaveTextContent("matches");
    expect(screen.getByText(/Your expected answer: 4\/8/)).toBeInTheDocument();
  });

  it("asks a short-answer question with an optional expected answer", async () => {
    let current: PollDto | null = null;
    const calls = mock({
      [`GET ${CUR}`]: () => json(200, { poll: current }),
      "POST /api/v1/classes/cl1/lessons/c1/polls": () => {
        current = poll({ kind: "short_answer", prompt: "1/2 = ?/8", options: [], answered: 0, expectedAnswer: "4/8" });
        return json(201, current);
      },
    });
    renderPanel();
    await userEvent.click(await screen.findByRole("radio", { name: /Short answer/ }));
    await userEvent.type(screen.getByRole("textbox", { name: "Question" }), "1/2 = ?/8");
    await userEvent.type(screen.getByRole("textbox", { name: /Expected answer/ }), "4/8");
    await userEvent.click(screen.getByRole("button", { name: "Ask the class" }));
    expect(calls.find((c) => c.key.startsWith("POST"))!.body).toEqual({ kind: "short_answer", prompt: "1/2 = ?/8", expectedAnswer: "4/8" });
    expect(await screen.findByText("No answers yet.")).toBeInTheDocument();
  });

  it("keeps the last closed poll readable after closing", async () => {
    mock({ [`GET ${CUR}`]: () => json(200, { poll: poll({ status: "closed", closedAt: "2026-10-29T08:05:00Z" }) }) });
    renderPanel();
    expect(await screen.findByRole("heading", { name: /Last poll: How sure/ })).toBeInTheDocument();
    expect(screen.getByText(/\(closed\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ask the class" })).toBeInTheDocument();
  });
});

describe("student quick poll", () => {
  const renderPlay = () =>
    render(
      <MemoryRouter>
        <PlayPage />
      </MemoryRouter>,
    );

  it("shows the question and choices, never counts, and thanks the student after answering", async () => {
    let answered = false;
    const body = (): StudentActivityResponse => ({ studentName: "Ravi", state: "poll", poll: { id: "p1", answerType: "option", prompt: "How sure do you feel about this idea?", options: [{ id: "a", text: "I mostly get it" }, { id: "b", text: "I am not sure yet" }], answered } });
    const calls = mock({
      "GET /api/v1/student/activity": () => json(200, body()),
      "POST /api/v1/student/poll/vote": () => {
        answered = true;
        return json(200, { ok: true });
      },
    });
    renderPlay();
    expect(await screen.findByRole("group", { name: "How sure do you feel about this idea?" })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d+ of \d+|count/i);
    await userEvent.click(screen.getByRole("radio", { name: "I am not sure yet" }));
    await userEvent.click(screen.getByRole("button", { name: "Send my answer" }));
    expect(calls.find((c) => c.key === "POST /api/v1/student/poll/vote")!.body).toEqual({ optionId: "b" });
    expect(await screen.findByText("There is no right or wrong here.", { exact: false })).toBeInTheDocument();
  });

  it("lets a student type a short answer and sends it as text", async () => {
    let answered = false;
    const calls = mock({
      "GET /api/v1/student/activity": () => json(200, { studentName: "Ravi", state: "poll", poll: { id: "p1", answerType: "text", prompt: "1/2 = ?/8", options: [], answered } }),
      "POST /api/v1/student/poll/vote": () => {
        answered = true;
        return json(200, { ok: true });
      },
    });
    renderPlay();
    await userEvent.click(await screen.findByRole("button", { name: "Send my answer" }));
    expect(screen.getByText("Type your answer first.")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "1/2 = ?/8" }), " 4/8 ");
    await userEvent.click(screen.getByRole("button", { name: "Send my answer" }));
    expect(calls.find((c) => c.key === "POST /api/v1/student/poll/vote")!.body).toEqual({ text: "4/8" });
    expect(await screen.findByText(/Your answer is in/)).toBeInTheDocument();
  });

  it("asks the student to pick before sending, without calling the server", async () => {
    const calls = mock({ "GET /api/v1/student/activity": () => json(200, { studentName: "Ravi", state: "poll", poll: { id: "p1", answerType: "option", prompt: "Pick one", options: [{ id: "a", text: "A" }, { id: "b", text: "B" }], answered: false } }) });
    renderPlay();
    await userEvent.click(await screen.findByRole("button", { name: "Send my answer" }));
    expect(screen.getByText("Pick one answer first.")).toBeInTheDocument();
    expect(calls.some((c) => c.key.startsWith("POST"))).toBe(false);
  });
});
