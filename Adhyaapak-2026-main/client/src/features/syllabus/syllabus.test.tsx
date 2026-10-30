import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProposalDto, SyllabusDocumentDto } from "@adhyaapak/shared";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { ConfigProvider } from "../../app/ConfigContext";
import { GraphProposalPage } from "./GraphProposalPage";
import { SyllabusPage } from "./SyllabusPage";
import { layoutGraph } from "./layout";

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("layoutGraph", () => {
  const cs = [1, 2, 3, 4, 5].map((n) => ({ id: `c${n}`, position: n }));
  const e = (a: string, b: string, decision = "accepted") => ({ prerequisiteConceptId: a, dependentConceptId: b, decision });

  it("puts each concept one column after its longest chain of prerequisites", () => {
    const l = layoutGraph(cs, [e("c1", "c2"), e("c2", "c3"), e("c1", "c3"), e("c1", "c4")]);
    expect(Object.fromEntries(l.map((n) => [n.id, n.depth]))).toEqual({ c1: 0, c2: 1, c3: 2, c4: 1, c5: 0 });
  });

  it("numbers rows within a column in teaching order", () => {
    const l = layoutGraph(cs, [e("c1", "c2"), e("c1", "c4")]);
    expect(l.filter((n) => n.depth === 1).map((n) => [n.id, n.row])).toEqual([["c2", 0], ["c4", 1]]);
    expect(l.filter((n) => n.depth === 0).map((n) => [n.id, n.row])).toEqual([["c1", 0], ["c3", 1], ["c5", 2]]);
  });

  it("ignores rejected prerequisites, counts pending ones, and survives a loop", () => {
    expect(layoutGraph(cs, [e("c1", "c2", "rejected")]).find((n) => n.id === "c2")!.depth).toBe(0);
    expect(layoutGraph(cs, [e("c1", "c2", "pending")]).find((n) => n.id === "c2")!.depth).toBe(1);
    expect(() => layoutGraph(cs, [e("c1", "c2"), e("c2", "c1")])).not.toThrow();
  });
});

function proposal(over: Partial<ProposalDto> = {}): ProposalDto {
  return {
    id: "p1", documentId: "d1", status: "draft", title: "Class 6 Fractions", board: "CBSE", academicYear: "2026-27", grade: 6, subject: "Mathematics", model: "openai/gpt-4o-mini", promptVersion: "syllabus-graph-1",
    notes: ["1 repeated prerequisite was merged."], suspiciousDocument: false,
    concepts: [
      { id: "a", key: "equivalent-fractions", title: "Equivalent fractions", description: "d", learningObjective: "o", evidenceQuote: "Students first learn equivalent fractions", grounded: true, addedByTeacher: false, position: 1 },
      { id: "b", key: "common-denominator", title: "Common denominator", description: "d", learningObjective: "o", evidenceQuote: null, grounded: false, addedByTeacher: false, position: 2 },
    ],
    edges: [{ id: "e1", prerequisiteConceptId: "a", dependentConceptId: "b", evidenceQuote: null, grounding: "inferred", confidence: "medium", decision: "pending" }],
    blockers: ["1 prerequisite still needs your decision."], canPublish: false, publishedCurriculumVersionId: null, ...over,
  };
}

function mount(route: string, element: React.ReactNode, path: string, handlers: Record<string, () => Promise<Response>>) {
  const calls: Array<{ key: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      calls.push({ key, ...(init?.body && typeof init.body === "string" ? { body: JSON.parse(init.body) } : {}) });
      if (key === "GET /api/v1/config") return json(200, { appName: "Adhyaapak", aiEnabled: true });
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
          <Route path="/syllabus" element={<p>syllabus home</p>} />
        </Routes>
      </ConfigProvider>
    </MemoryRouter>,
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("GraphProposalPage", () => {
  const page = (handlers: Record<string, () => Promise<Response>>) => mount("/syllabus/graphs/p1", <GraphProposalPage />, "/syllabus/graphs/:proposalId", handlers);

  it("shows what is and is not backed by the document, and blocks publishing until the teacher decides", async () => {
    page({ "GET /api/v1/graph-proposals/p1": () => json(200, proposal()) });
    expect(await screen.findByText(/Not stated in the document\./)).toBeInTheDocument();
    expect(screen.getByText(/check that it is right for your syllabus/)).toBeInTheDocument();
    expect(screen.getByText("1 prerequisite still needs your decision.")).toBeInTheDocument();
    expect(screen.getByText(/Students first learn equivalent fractions/)).toBeInTheDocument(); // the quote for a grounded concept
    expect(screen.getByText(/No passage in the document could be matched/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Publish curriculum" })).toBeDisabled();
    expect(screen.getByLabelText(/I have reviewed the concepts/)).toBeDisabled();
    expect(screen.getByRole("img", { name: /Concept graph with 2 concepts/ })).toBeInTheDocument();
  });

  it("sends the decision for a prerequisite", async () => {
    const calls = page({
      "GET /api/v1/graph-proposals/p1": () => json(200, proposal()),
      "PATCH /api/v1/graph-proposals/p1/edges/e1": () => json(200, proposal({ edges: [{ ...proposal().edges[0]!, decision: "accepted" }], blockers: [], canPublish: true })),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(calls.find((c) => c.key.startsWith("PATCH"))?.body).toEqual({ decision: "accepted" });
  });

  it("publishes only after the explicit confirmation, and sends confirm: true", async () => {
    const ready = proposal({ edges: [{ ...proposal().edges[0]!, decision: "accepted" }], blockers: [], canPublish: true });
    const calls = page({
      "GET /api/v1/graph-proposals/p1": () => json(200, ready),
      "POST /api/v1/graph-proposals/p1/publish": () => json(201, { curriculumVersionId: "cv", version: 2, conceptCount: 2, edgeCount: 1 }),
    });
    const publish = await screen.findByRole("button", { name: "Publish curriculum" });
    expect(publish).toBeDisabled();
    await userEvent.click(screen.getByLabelText(/I have reviewed the concepts/));
    expect(publish).toBeEnabled();
    await userEvent.click(publish);
    expect(await screen.findByText(/Published as version 2: 2 concepts and 1 prerequisites\./)).toBeInTheDocument();
    expect(calls.find((c) => c.key.endsWith("/publish"))?.body).toEqual({ confirm: true });
  });

  it("warns about a document that talks to the AI, and shows our checks' notes", async () => {
    page({ "GET /api/v1/graph-proposals/p1": () => json(200, proposal({ suspiciousDocument: true })) });
    expect(await screen.findByText(/looks like instructions to an AI/)).toBeInTheDocument();
    expect(screen.getByText("1 repeated prerequisite was merged.")).toBeInTheDocument();
  });

  it("is read-only once published", async () => {
    page({ "GET /api/v1/graph-proposals/p1": () => json(200, proposal({ status: "published", publishedCurriculumVersionId: "cv", blockers: ["This graph is already published."] })) });
    expect(await screen.findByText(/This graph has been published/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Publish curriculum" })).not.toBeInTheDocument();
  });

  it("shows a reason when an edit is refused", async () => {
    page({
      "GET /api/v1/graph-proposals/p1": () => json(200, proposal()),
      "PATCH /api/v1/graph-proposals/p1/edges/e1": () => json(400, { error: { code: "validation_error", message: "That would make a loop: A → B → A." }, requestId: "r" }),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That would make a loop");
  });
});

describe("SyllabusPage", () => {
  const doc = (over: Partial<SyllabusDocumentDto> = {}): SyllabusDocumentDto => ({ id: "d1", title: "Unit 7", originalFilename: "unit7.pdf", fileType: "pdf", pageCount: 3, characters: 4000, suspicious: false, createdAt: "2026-10-01T00:00:00Z", proposals: [], ...over });

  it("lists documents, warns about suspicious ones, and offers to propose a graph", async () => {
    mount("/syllabus", <SyllabusPage />, "/syllabus", { "GET /api/v1/syllabus-documents": () => json(200, { documents: [doc({ suspicious: true, proposals: [{ id: "p1", title: "Class 6 Fractions", status: "draft" }] })] }) });
    expect(await screen.findByText("Unit 7")).toBeInTheDocument();
    expect(screen.getByText(/PDF, 3 pages/)).toBeInTheDocument();
    expect(screen.getByText(/looks like instructions to an AI/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Class 6 Fractions" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Propose a concept graph" })).toBeEnabled();
  });

  it("adds pasted text only when it has a title and text, and tells the teacher when it was already added", async () => {
    const calls = mount("/syllabus", <SyllabusPage />, "/syllabus", {
      "GET /api/v1/syllabus-documents": () => json(200, { documents: [] }),
      "POST /api/v1/syllabus-documents/text": () => json(200, { document: doc(), alreadyUploaded: true }),
    });
    const add = await screen.findByRole("button", { name: "Add syllabus" });
    expect(add).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Title"), "Unit 7");
    await userEvent.type(screen.getByLabelText("Syllabus text"), "Fractions chapter text.");
    expect(add).toBeEnabled();
    await userEvent.click(add);
    expect(await screen.findByText(/already added this exact text/)).toBeInTheDocument();
    expect(calls.find((c) => c.key.startsWith("POST"))?.body).toEqual({ title: "Unit 7", text: "Fractions chapter text." });
  });

  it("shows the server's reason when a file is refused", async () => {
    mount("/syllabus", <SyllabusPage />, "/syllabus", {
      "GET /api/v1/syllabus-documents": () => json(200, { documents: [] }),
      "POST /api/v1/syllabus-documents": () => json(400, { error: { code: "validation_error", message: "We could not find readable text in this PDF. It may be a scan." }, requestId: "r" }),
    });
    await screen.findByRole("button", { name: "Add syllabus" });
    await userEvent.upload(screen.getByLabelText("A PDF or text file"), new File(["%PDF-1.4"], "scan.pdf", { type: "application/pdf" }));
    await userEvent.click(screen.getByRole("button", { name: "Add syllabus" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("It may be a scan");
  });

  it("generates a graph and moves to its review page", async () => {
    const calls = mount("/syllabus", <SyllabusPage />, "/syllabus", {
      "GET /api/v1/syllabus-documents": () => json(200, { documents: [doc()] }),
      "POST /api/v1/syllabus-documents/d1/generate-graph": () => json(201, proposal()),
    });
    await userEvent.click(await screen.findByRole("button", { name: "Propose a concept graph" }));
    await userEvent.click(screen.getByRole("button", { name: "Propose graph" }));
    await vi.waitFor(() => expect(calls.some((c) => c.key.includes("generate-graph"))).toBe(true));
    expect(calls.find((c) => c.key.includes("generate-graph"))?.body).toEqual({ title: "Unit 7", grade: 6, subject: "Mathematics", board: "CBSE", academicYear: "2026-27" });
  });
});
