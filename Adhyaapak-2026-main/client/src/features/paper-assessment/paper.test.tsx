import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AssessmentDetailDto, PaperSubmissionDto } from "@adhyaapak/shared";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { ConfigProvider } from "../../app/ConfigContext";
import { PaperPage } from "./PaperPage";
import { PaperReviewPage } from "./PaperReviewPage";
import { PrintSheetsPage } from "./PrintSheetsPage";

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const options = [{ id: "a", text: "2/5" }, { id: "b", text: "5/6" }];
const Q1 = "11111111-1111-4111-8111-111111111111";
const Q2 = "22222222-2222-4222-8222-222222222222";

function sheet(over: Partial<PaperSubmissionDto> = {}): PaperSubmissionDto {
  return {
    id: "s1", assessmentId: "a1", studentId: "st1", studentName: "Ravi", rosterNumber: 7, status: "needs_review", imageAvailable: true, metadataStripped: true,
    extraction: { extractor: "vision-llm", processingVersion: "sheet-reading-1", status: "ok", createdAt: "2026-10-28T10:00:00Z" },
    items: [
      { questionId: Q1, position: 1, stem: "1/2 + 1/3 = ?", options, extracted: { reading: { kind: "option", optionId: "b" }, legibility: "clear", note: null }, reviewed: null, needsDecision: false },
      { questionId: Q2, position: 2, stem: "2/7 + 3/7 = ?", options, extracted: { reading: { kind: "option", optionId: "a" }, legibility: "unsure", note: "faint pencil" }, reviewed: null, needsDecision: true },
    ],
    blockers: ["Check the answers against the photo and save your review."], canApprove: false, deleteAfter: null, createdAt: "2026-10-28T09:00:00Z", ...over,
  };
}

function detail(over: Partial<AssessmentDetailDto> = {}): AssessmentDetailDto {
  return {
    id: "a1", classId: "c1", classJoinCode: "ABC123", title: "Adding check", type: "diagnostic", status: "open",
    questions: [{ id: Q1, stem: "1/2 + 1/3 = ?", options, conceptTitle: "Adding fractions", correctOptionId: "b" }] as never,
    students: [{ id: "st1", name: "Ravi", rosterNumber: 7, submitted: false, joined: false, score: null }, { id: "st2", name: "Meera", rosterNumber: 8, submitted: false, joined: false, score: null }, { id: "st3", name: "Anu", rosterNumber: 9, submitted: true, joined: true, score: { correct: 1, answered: 1, total: 1 } }],
    tallies: [], resultsReleased: false, ...over,
  };
}

function mount(route: string, element: React.ReactNode, path: string, handlers: Record<string, () => Promise<Response>>, aiEnabled = true) {
  const calls: Array<{ key: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      calls.push({ key, ...(init?.body && typeof init.body === "string" ? { body: JSON.parse(init.body) } : {}) });
      if (key === "GET /api/v1/config") return json(200, { appName: "Adhyaapak", aiEnabled });
      const h = handlers[key];
      if (!h) throw new Error(`Unmocked request: ${key}`);
      return h();
    }),
  );
  render(
    <MemoryRouter initialEntries={[route]}>
      <ConfigProvider>
        <Routes>
          <Route path={path} element={element} />
          <Route path="/activities/:id/paper" element={<p>paper home</p>} />
        </Routes>
      </ConfigProvider>
    </MemoryRouter>,
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const review = (handlers: Record<string, () => Promise<Response>>, aiEnabled = true) => mount("/paper/s1", <PaperReviewPage />, "/paper/:sheetId", handlers, aiEnabled);

describe("PaperReviewPage", () => {
  it("shows the photo beside the answers, and marks the answer that needs a look", async () => {
    review({ "GET /api/v1/submission-files/s1": () => json(200, sheet()) });
    expect(await screen.findByRole("img", { name: /Photographed answer sheet for Ravi/ })).toHaveAttribute("src", "/api/v1/submission-files/s1/image");
    expect(screen.getByText(/Read as B \(clear\)/)).toBeInTheDocument();
    expect(screen.getByText(/Read as A \(not sure\)/)).toBeInTheDocument();
    expect(screen.getByText(/faint pencil/)).toBeInTheDocument();
    expect(screen.getByText("Check the photo")).toBeInTheDocument();
    expect(screen.getByText("1 answer still needs your decision.")).toBeInTheDocument();
    expect(screen.getByText(/Location and camera details were removed/)).toBeInTheDocument();
  });

  it("will not approve until the unclear answer has been decided, then saves and approves in order", async () => {
    const calls = review({
      "GET /api/v1/submission-files/s1": () => json(200, sheet()),
      "POST /api/v1/submission-files/s1/review": () => json(200, sheet()),
      "POST /api/v1/submission-files/s1/approve": () => json(200, { attemptId: "at1", alreadyApproved: false }),
    });
    const approve = await screen.findByRole("button", { name: /Approve and add to the learning record/ });
    expect(approve).toBeDisabled();

    const q2 = within(screen.getByRole("group", { name: /2\. 2\/7 \+ 3\/7/ }));
    await userEvent.click(q2.getByLabelText("B. 5/6")); // the teacher looked at the photo and chose B
    expect(screen.queryByText(/still needs your decision/)).not.toBeInTheDocument();
    expect(approve).toBeEnabled();

    await userEvent.click(approve);
    expect(await screen.findByText(/Approved\. These answers are now part of the learning record/)).toBeInTheDocument();
    const keys = calls.map((c) => c.key).filter((k) => k.startsWith("POST"));
    expect(keys).toEqual(["POST /api/v1/submission-files/s1/review", "POST /api/v1/submission-files/s1/approve"]);
    expect(calls.find((c) => c.key.endsWith("/review"))?.body).toEqual({
      items: [
        { questionId: Q1, reading: { kind: "option", optionId: "b" }, confirmed: false },
        { questionId: Q2, reading: { kind: "option", optionId: "b" }, confirmed: true },
      ],
    });
  });

  it("offers 'Can't read' and 'No answer' as real choices, not wrong answers", async () => {
    review({ "GET /api/v1/submission-files/s1": () => json(200, sheet()) });
    const q2 = within(await screen.findByRole("group", { name: /2\. 2\/7 \+ 3\/7/ }));
    expect(q2.getByLabelText("Can't read")).toBeInTheDocument();
    expect(q2.getByLabelText("No answer")).toBeInTheDocument();
    expect(screen.getByText(/count as no evidence, not as wrong/)).toBeInTheDocument();
  });

  it("asks for consent before sending the photo to the AI, and works without one", async () => {
    const unread = sheet({ extraction: null, items: sheet().items.map((i) => ({ ...i, extracted: null, needsDecision: true })) });
    const calls = review({
      "GET /api/v1/submission-files/s1": () => json(200, unread),
      "POST /api/v1/submission-files/s1/process": () => json(200, sheet()),
    });
    const read = await screen.findByRole("button", { name: "Read the sheet with AI" });
    expect(read).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/photo will be sent to the AI service/));
    expect(read).toBeEnabled();
    await userEvent.click(read);
    expect(calls.find((c) => c.key.endsWith("/process"))?.body).toEqual({ confirmSendToAi: true });
  });

  it("when AI is off, says so and still lets the teacher choose from the photo", async () => {
    review({ "GET /api/v1/submission-files/s1": () => json(200, sheet({ extraction: null, items: sheet().items.map((i) => ({ ...i, extracted: null, needsDecision: true })) })) }, false);
    expect(await screen.findByText(/AI reading is switched off/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Read the sheet with AI" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Not read yet/)).toHaveLength(2);
  });

  it("is read-only once approved, and says when the photo is gone", async () => {
    review({ "GET /api/v1/submission-files/s1": () => json(200, sheet({ status: "approved", imageAvailable: false })) });
    expect(await screen.findByText(/Approved\. These answers are now part of the learning record/)).toBeInTheDocument();
    expect(screen.getByText(/photo has been deleted/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Approve and add/ })).not.toBeInTheDocument();
    for (const radio of screen.getAllByRole("radio")) expect(radio).toBeDisabled();
  });

  it("shows the server's message when approval is refused", async () => {
    review({
      "GET /api/v1/submission-files/s1": () => json(200, sheet({ items: sheet().items.map((i) => ({ ...i, needsDecision: false })) })),
      "POST /api/v1/submission-files/s1/review": () => json(200, sheet()),
      "POST /api/v1/submission-files/s1/approve": () => json(409, { error: { code: "conflict", message: "This student has already submitted this assessment." }, requestId: "r" }),
    });
    await userEvent.click(await screen.findByRole("button", { name: /Approve and add/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already submitted");
  });
});

describe("PaperPage", () => {
  const page = (handlers: Record<string, () => Promise<Response>>) =>
    mount("/activities/a1/paper", <PaperPage />, "/activities/:assessmentId/paper", {
      "GET /api/v1/assessments/a1": () => json(200, detail()),
      "GET /api/v1/paper-accuracy": () => json(200, { sheetsReviewed: 2, answersReviewed: 8, answersAsRead: 7, answersCorrectedByTeacher: 1, clearReadings: 6, clearReadingsUnchanged: 6 }),
      ...handlers,
    });

  it("offers only students who have no answer or waiting sheet, and shows the honest accuracy", async () => {
    page({ "GET /api/v1/assessments/a1/submission-files": () => json(200, { submissions: [{ ...sheet(), studentId: "st2", studentName: "Meera", rosterNumber: 8 }] }) });
    const select = await screen.findByLabelText("Whose sheet?");
    const names = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual(["", "7. Ravi"]); // Meera has a sheet waiting, Anu already answered
    expect(await screen.findByText(/reader got 8 answers from 2 sheets and you changed 1 of them/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Review/ })).toHaveAttribute("href", "/paper/s1");
  });

  it("explains that the activity must be started first", async () => {
    mount("/activities/a1/paper", <PaperPage />, "/activities/:assessmentId/paper", {
      "GET /api/v1/assessments/a1": () => json(200, detail({ status: "approved" })),
      "GET /api/v1/assessments/a1/submission-files": () => json(200, { submissions: [] }),
      "GET /api/v1/paper-accuracy": () => json(200, { sheetsReviewed: 0, answersReviewed: 0, answersAsRead: 0, answersCorrectedByTeacher: 0, clearReadings: 0, clearReadingsUnchanged: 0 }),
    });
    expect(await screen.findByText(/Start the activity/)).toBeInTheDocument();
    expect(screen.queryByLabelText("Whose sheet?")).not.toBeInTheDocument();
  });
});

describe("PrintSheetsPage", () => {
  it("prints one sheet per unanswered student with the roll number and no name", async () => {
    mount("/activities/a1/print-sheets", <PrintSheetsPage />, "/activities/:assessmentId/print-sheets", { "GET /api/v1/assessments/a1": () => json(200, detail()) });
    expect(await screen.findByRole("region", { name: "Roll no. 7" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Roll no. 8" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Roll no. 9" })).not.toBeInTheDocument(); // Anu already answered
    expect(screen.queryByText(/Ravi|Meera|Anu/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/Please do not write your name/)).toHaveLength(2);
  });
});
