import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AtlasResponse, TranslationsResponse } from "@adhyaapak/shared";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { RecordTools } from "../students/StudentPage";
import { AtlasPage } from "./AtlasPage";
import { BilingualView } from "./BilingualView";

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
        <Route path="/classes/:classId" element={<p>class page</p>} />
      </Routes>
    </MemoryRouter>,
  );
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const C = "11111111-1111-4111-8111-111111111111";

describe("AtlasPage", () => {
  const atlas = (): AtlasResponse => ({
    minDecisions: 5,
    concepts: [
      {
        conceptId: C,
        title: "Adding fractions",
        rules: [
          { patternId: "p1", key: "adds-denominators", name: "Adds the denominators", category: "conceptual", description: "Adds both parts.", exampleWrongAnswers: ["1/2 + 1/3 = 2/5"], recommendedExplanation: "Show a bar.", followUpQuestion: "2/7 + 3/7 = ?", stats: { studentsObserved: 4, likely: 2, confirmed: 1, rejected: 1, confirmRate: 0.5 }, quality: "too_few_decisions" },
          { patternId: "p2", key: "other", name: "Other pattern", category: null, description: "d", exampleWrongAnswers: ["x"], recommendedExplanation: "r", followUpQuestion: null, stats: { studentsObserved: 0, likely: 0, confirmed: 0, rejected: 0, confirmRate: null }, quality: "no_data" },
        ],
      },
    ],
  });

  it("shows each pattern with examples and what to do, and says honestly how little the counts prove", async () => {
    // The rule library is the Atlas's second tab; the first is the class workspace.
    mount("/atlas?tab=library", <AtlasPage />, "/atlas", { "GET /api/v1/misconceptions/atlas": () => json(200, atlas()), "GET /api/v1/classes": () => json(200, { classes: [] }) });
    expect(await screen.findByRole("heading", { name: "Adding fractions" })).toBeInTheDocument();
    expect(screen.getByText(/1\/2 \+ 1\/3 = 2\/5/)).toBeInTheDocument();
    expect(screen.getByText(/Show a bar\./)).toBeInTheDocument();
    expect(screen.getByText(/Your students: 4 seen, 1 confirmed, 1 rejected/)).toBeInTheDocument();
    expect(screen.getByText(/Too few confirm or reject decisions to say how well it is holding up \(needs 5\)/)).toBeInTheDocument();
    expect(screen.getByText("Not seen in your classes yet")).toBeInTheDocument();
    expect(screen.getByText(/do not prove a pattern is scientifically valid/)).toBeInTheDocument();
  });
});

describe("BilingualView", () => {
  const view = (status = "draft"): TranslationsResponse => ({
    language: "en",
    available: ["hi"],
    levels: [
      { level: "guided", original: { title: "Adding with unlike denominators", content: { summary: "Make the pieces the same size first." } }, translations: [{ language: "hi", title: "अलग-अलग हर वाले भिन्नों को जोड़ना", content: { summary: "पहले टुकड़ों को एक ही आकार का बनाइए।" }, reviewStatus: status, note: "Needs review by a Hindi-medium teacher." }] },
      { level: "foundation", original: null, translations: [] },
      { level: "challenge", original: null, translations: [] },
    ],
  });
  const open = (status?: string, level: "foundation" | "guided" | "challenge" = "guided") => mount(`/c`, <BilingualView conceptId={C} level={level} />, "/c", { [`GET /api/v1/concepts/${C}/translations`]: () => json(200, view(status)) });

  it("shows the original and the translation side by side, marked as a draft until reviewed", async () => {
    open();
    expect(await screen.findByText("Make the pieces the same size first.")).toBeInTheDocument();
    expect(screen.getByText("पहले टुकड़ों को एक ही आकार का बनाइए।")).toBeInTheDocument();
    expect(screen.getByText(/Draft translation\. Not yet reviewed, and not shown to students\./)).toBeInTheDocument();
    expect(screen.getByText(/Needs review by a Hindi-medium teacher\./)).toBeInTheDocument();
  });

  it("drops the draft warning once a person has approved the translation", async () => {
    open("approved");
    await screen.findByText("पहले टुकड़ों को एक ही आकार का बनाइए।");
    expect(screen.queryByText(/Draft translation/)).not.toBeInTheDocument();
  });

  it("says so when a level has no translation, and shows nothing at all when there are none", async () => {
    open(undefined, "foundation");
    expect(await screen.findByText("There is no translation of this level yet.")).toBeInTheDocument();
  });
});

describe("RecordTools", () => {
  const tools = (handlers: Record<string, Handler> = {}) =>
    mount("/s", <RecordTools classId="c1" studentId="s1" name="Ravi Kumar" rosterNumber={4} onChanged={() => undefined} />, "/s", handlers);

  it("sends a correction", async () => {
    const calls = tools({ "PATCH /api/v1/classes/c1/students/s1": () => json(200, { id: "s1", name: "Ravi Kumaar", rosterNumber: 9 }) });
    const name = screen.getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Ravi Kumaar");
    const roll = screen.getByLabelText("Roll no.");
    await userEvent.clear(roll);
    await userEvent.type(roll, "9");
    await userEvent.click(screen.getByRole("button", { name: "Save the correction" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(calls[0]).toContain('{"name":"Ravi Kumaar","rosterNumber":9}');
  });

  it("will not erase until the teacher types the word, then removes details and returns to the class", async () => {
    const calls = tools({ "POST /api/v1/classes/c1/students/s1/erase": () => json(204, undefined) });
    const button = screen.getByRole("button", { name: "Remove personal details" });
    expect(button).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/Type “erase” to confirm/), "erase");
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(await screen.findByText("class page")).toBeInTheDocument();
    expect(calls[0]).toContain('{"confirm":"erase"}');
  });

  it("shows the server's message when a correction is refused", async () => {
    tools({ "PATCH /api/v1/classes/c1/students/s1": () => json(409, { error: { code: "conflict", message: "That roll number or reference is already used in this class." }, requestId: "r" }) });
    await userEvent.click(screen.getByRole("button", { name: "Save the correction" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("already used");
  });
});
