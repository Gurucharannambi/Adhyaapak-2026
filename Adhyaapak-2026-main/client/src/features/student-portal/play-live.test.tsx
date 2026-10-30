import { render, screen } from "@testing-library/react";
import type { StudentActivityResponse } from "@adhyaapak/shared";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { PlayPage } from "./PlayPage";

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
afterEach(() => vi.unstubAllGlobals());

const show = (body: StudentActivityResponse) => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => (String(input) === "/api/v1/student/activity" ? json(200, body) : Promise.reject(new Error(`Unmocked ${String(input)}`)))));
  return render(
    <MemoryRouter>
      <PlayPage />
    </MemoryRouter>,
  );
};

describe("student screen, live", () => {
  it("shows the student only their own answers once released: friendly words, the right answer and the reason, never a score", async () => {
    show({
      studentName: "Ravi",
      state: "results",
      results: {
        title: "Check: Adding fractions",
        questions: [
          { stem: "1/2 + 1/3 = ?", yourAnswer: "2/5", correctAnswer: "5/6", outcome: "not_yet", explanation: "Make the pieces the same size first." },
          { stem: "1/4 + 1/4 = ?", yourAnswer: "1/2", correctAnswer: "1/2", outcome: "right", explanation: "Same size pieces: 2 quarters." },
          { stem: "2/3 + 1/6 = ?", yourAnswer: null, correctAnswer: "5/6", outcome: "blank", explanation: "Sixths first." },
        ],
      },
    });
    expect(await screen.findByRole("heading", { name: "Your answers" })).toBeInTheDocument();
    expect(screen.getByText("Not this time. Have another look:")).toBeInTheDocument();
    expect(screen.getByText("You chose: 2/5")).toBeInTheDocument();
    expect(screen.getAllByText(/The right answer: 5\/6/)).toHaveLength(2);
    expect(screen.getByText("You got it.")).toBeInTheDocument();
    expect(screen.getByText("You left this one. Have a look:")).toBeInTheDocument();
    expect(screen.getByText("Make the pieces the same size first.")).toBeInTheDocument();
    // No scores, percentages or ranks anywhere on the page.
    expect(document.body.textContent).not.toMatch(/score|percent|%|rank|out of/i);
  });

  it("tells a student the check is paused and shows no questions until it carries on", async () => {
    show({ studentName: "Ravi", state: "paused" });
    expect(await screen.findByRole("heading", { name: "Paused for a moment" })).toBeInTheDocument();
    expect(screen.getByText(/Anything you chose is kept/)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("tells a student who has submitted that the teacher will show the answers, and does not reveal anything yet", async () => {
    show({ studentName: "Ravi", state: "submitted" });
    expect(await screen.findByText("Your teacher will show the answers when everyone has finished.")).toBeInTheDocument();
    expect(screen.queryByText(/right answer/i)).not.toBeInTheDocument();
  });

  it("waits quietly when nothing is open, and says the page will change by itself or that it is checking", async () => {
    show({ studentName: "Ravi", state: "no_activity" });
    expect(await screen.findByText(/Nothing is open right now/)).toBeInTheDocument();
    expect(screen.getByText("Checking every few seconds.")).toBeInTheDocument(); // no live connection in the test environment
  });
});
