import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../i18n";
import { parseCell } from "./assessments/FastEntryGrid";
import { LearnPage } from "./student-portal/LearnPage";
import { JoinPage } from "./student-portal/JoinPage";
import { PlayPage } from "./student-portal/PlayPage";

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

function mockApi(routes: Record<string, () => Promise<Response>>, calls: Array<{ key: string; body?: unknown }> = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      calls.push({ key, ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      const h = routes[key];
      if (!h) throw new Error(`Unmocked request: ${key}`);
      return h();
    }),
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("parseCell (Fast Entry Grid)", () => {
  const opts = ["a", "b", "c", "d"];
  it("reads an option, with or without how sure the student was", () => {
    expect(parseCell("b", opts)).toEqual({ answer: { kind: "option", optionId: "b" } });
    expect(parseCell(" B ", opts)).toEqual({ answer: { kind: "option", optionId: "b" } });
    expect(parseCell("as", opts)).toEqual({ answer: { kind: "option", optionId: "a" }, confidence: "sure" });
    expect(parseCell("cu", opts)).toEqual({ answer: { kind: "option", optionId: "c" }, confidence: "unsure" });
    expect(parseCell("dg", opts)).toEqual({ answer: { kind: "option", optionId: "d" }, confidence: "guess" });
  });
  it("treats empty and '-' as blank and '?' as unreadable, never as wrong", () => {
    expect(parseCell("", opts)).toEqual({ answer: { kind: "blank" } });
    expect(parseCell("-", opts)).toEqual({ answer: { kind: "blank" } });
    expect(parseCell("?", opts)).toEqual({ answer: { kind: "unreadable" } });
  });
  it("rejects letters that are not options, instead of guessing", () => {
    expect(parseCell("e", opts)).toHaveProperty("error");
    expect(parseCell("bsx", opts)).toHaveProperty("error");
    expect(parseCell("zz", opts)).toHaveProperty("error");
  });
});

describe("student join and play", () => {
  it("joins with a code and number and moves on to the activity", async () => {
    const calls = mockApi({
      "POST /api/v1/join": () => json(200, { studentName: "Ravi" }),
      "GET /api/v1/student/home": () => json(200, { studentName: "Ravi", activityOpen: true, next: null, progress: [], revisit: [] }),
    });
    render(
      <MemoryRouter initialEntries={["/join"]}>
        <Routes>
          <Route path="/join" element={<JoinPage />} />
          <Route path="/learn" element={<LearnPage />} />
          <Route path="/play" element={<PlayPage />} />
        </Routes>
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText("Class code"), "k7m2qx");
    await userEvent.type(screen.getByLabelText("Your roster number"), "12");
    await userEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByText("Hello, Ravi")).toBeInTheDocument();
    expect(calls.find((c) => c.key === "POST /api/v1/join")?.body).toEqual({ joinCode: "K7M2QX", rosterNumber: "12" });
  });

  it("shows a safe message when the code is wrong", async () => {
    mockApi({ "POST /api/v1/join": () => json(404, { error: { code: "not_found", message: "We could not find that class code and number. Check them and try again." }, requestId: "r" }) });
    render(
      <MemoryRouter>
        <JoinPage />
      </MemoryRouter>,
    );
    await userEvent.type(screen.getByLabelText("Class code"), "ABCDEF");
    await userEvent.type(screen.getByLabelText("Your roster number"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Join" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We could not find that class code and number");
  });

  const activity = {
    studentName: "Ravi",
    state: "ready",
    assessment: { id: "a1", title: "Adding check", questions: [{ id: "q1", stem: "1/2 + 1/3 = ?", options: [{ id: "a", text: "2/5" }, { id: "b", text: "5/6" }] }] },
  };

  it("sends the chosen option and how sure the student is, and never shows right or wrong", async () => {
    let submitted = false;
    const calls = mockApi({
      "GET /api/v1/student/activity": () => json(200, submitted ? { studentName: "Ravi", state: "submitted" } : activity),
      "POST /api/v1/student/activity/answers": () => {
        submitted = true;
        return json(201, { state: "submitted" });
      },
    });
    render(
      <MemoryRouter>
        <PlayPage />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByLabelText("A. 2/5"));
    await userEvent.click(await screen.findByLabelText("Not sure"));
    await userEvent.click(screen.getByRole("button", { name: "Send my answers" }));

    expect(await screen.findByText("Thank you, Ravi")).toBeInTheDocument();
    const post = calls.find((c) => c.key === "POST /api/v1/student/activity/answers")!.body as { idempotencyKey: string; answers: unknown[] };
    expect(post.answers).toEqual([{ questionId: "q1", optionId: "a", confidence: "unsure" }]);
    expect(post.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    expect(document.body.textContent).not.toMatch(/correct|incorrect|wrong|right answer/i);
  });

  it("will not send an empty form", async () => {
    const calls = mockApi({ "GET /api/v1/student/activity": () => json(200, activity) });
    render(
      <MemoryRouter>
        <PlayPage />
      </MemoryRouter>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Send my answers" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Choose at least one answer");
    await waitFor(() => expect(calls.some((c) => c.key.startsWith("POST"))).toBe(false));
  });

  it("asks someone without a session to join first", async () => {
    mockApi({ "GET /api/v1/student/activity": () => json(401, { error: { code: "unauthenticated", message: "Join again" }, requestId: "r" }) });
    render(
      <MemoryRouter>
        <PlayPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText("Please join with your class code first.")).toBeInTheDocument();
  });
});
