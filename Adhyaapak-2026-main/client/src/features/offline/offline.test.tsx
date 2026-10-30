import "fake-indexeddb/auto";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { OfflinePackDto } from "@adhyaapak/shared";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { resetOfflineDbConnection } from "./offline-db";
import { OfflinePackPage } from "./OfflinePackPage";
import { OfflinePage } from "./OfflinePage";
import { PackPrintPage } from "./PackPrintPage";
import { savePack, listLocalPacks, removePack, preflight } from "./packs";
import { listQueue } from "./queue";
import { SyncProvider } from "./SyncContext";
import { SyncPage } from "./SyncPage";

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

const Q1 = "11111111-1111-4111-8111-111111111111";
const Q2 = "22222222-2222-4222-8222-222222222222";
const options = [{ id: "a", text: "2/5" }, { id: "b", text: "5/6" }];
const pack: OfflinePackDto = {
  id: "33333333-3333-4333-8333-333333333333", version: "abcdef0123456789", builtAt: "2026-10-28T08:00:00.000Z", language: "en", className: "6A", classId: "44444444-4444-4444-8444-444444444444",
  assessmentId: "55555555-5555-4555-8555-555555555555", conceptId: "66666666-6666-4666-8666-666666666666", conceptTitle: "Adding fractions",
  presentation: { title: "Adding fractions", learningObjective: "Add fractions", levels: [{ level: "foundation", title: "Foundation", summary: "s", steps: ["one"], workedExample: null, commonError: null, prompt: null, manipulative: null }] } as never,
  questions: [{ id: Q1, stem: "1/2 + 1/3 = ?", options }, { id: Q2, stem: "2/7 + 3/7 = ?", options }],
  answerKey: [{ questionId: Q1, correctOptionId: "b", explanation: "Common denominator." }, { questionId: Q2, correctOptionId: "b", explanation: null }],
  rollNumbers: [1, 2], offlineNotes: ["Works offline: lesson."],
};

type Handler = () => Promise<Response>;
function mount(route: string, element: React.ReactNode, path: string, handlers: Record<string, Handler> = {}) {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => {
      const key = `${init?.method ?? "GET"} ${url}`;
      calls.push(key + (typeof init?.body === "string" ? ` ${init.body}` : ""));
      const h = handlers[key];
      if (!h) return Promise.reject(new TypeError("Failed to fetch")); // an unreachable server
      return h();
    }),
  );
  render(
    <MemoryRouter initialEntries={[route]}>
      <SyncProvider>
        <Routes>
          <Route path={path} element={element} />
        </Routes>
      </SyncProvider>
    </MemoryRouter>,
  );
  return calls;
}

beforeEach(async () => {
  await resetOfflineDbConnection();
  for (const p of await listLocalPacks()) await removePack(p.id);
  for (const q of await listQueue()) await (await import("./offline-db")).idbDelete("queue", q.operation.idempotencyKey);
  localStorage.clear();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});
afterEach(() => vi.unstubAllGlobals());

describe("pack storage", () => {
  it("round-trips a pack through IndexedDB and reports readiness honestly", async () => {
    await savePack(pack);
    expect((await listLocalPacks()).map((p) => p.conceptTitle)).toEqual(["Adding fractions"]);
    const checks = await preflight(pack);
    expect(checks.find((c) => c.id === "lesson")).toMatchObject({ ok: true, items: 1 });
    expect(checks.find((c) => c.id === "questions")).toMatchObject({ ok: true, items: 2 });
    expect(checks.find((c) => c.id === "roster")!.detail).toMatch(/no names/);
    // jsdom has no service worker cache: the app shell must be reported as NOT ready, not assumed.
    expect(checks.find((c) => c.id === "shell")!.ok).toBe(false);
  });
});

describe("OfflinePage", () => {
  it("lists packs from the device with no network at all", async () => {
    await savePack(pack);
    mount("/offline", <OfflinePage />, "/offline");
    expect(await screen.findByText("Adding fractions")).toBeInTheDocument();
    expect(screen.getByText(/Available offline/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open pack" })).toHaveAttribute("href", `/offline/packs/${pack.id}`);
  });

  it("says plainly when there are none", async () => {
    mount("/offline", <OfflinePage />, "/offline");
    expect(await screen.findByText(/No packs yet/)).toBeInTheDocument();
  });
});

describe("OfflinePackPage", () => {
  const open = () => mount(`/offline/packs/${pack.id}`, <OfflinePackPage />, "/offline/packs/:packId");

  it("records a student's answers in the durable queue while the server is unreachable", async () => {
    await savePack(pack);
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    open();
    expect(await screen.findByRole("heading", { name: "Adding fractions" })).toBeInTheDocument();
    expect(screen.getByText(/Offline: work is saved on this device/)).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText("Roll 1, question 1"), "b");
    await userEvent.selectOptions(screen.getByLabelText("Roll 1, question 2"), "a");
    const row = within(screen.getByRole("row", { name: /^1/ }));
    await userEvent.click(row.getByRole("button", { name: "Record" }));
    expect(await row.findByText(/Recorded/)).toBeInTheDocument();

    const queued = await listQueue();
    expect(queued).toHaveLength(1);
    expect(queued[0]!.operation).toMatchObject({
      type: "record_responses",
      baseVersion: pack.version,
      payload: { assessmentId: pack.assessmentId, rosterNumber: 1, responses: [{ questionId: Q1, answer: { kind: "option", optionId: "b" } }, { questionId: Q2, answer: { kind: "option", optionId: "a" } }] },
    });
    expect(queued[0]!.operation.idempotencyKey).toMatch(/^op-/);
  });

  it("records an empty question as blank, and cannot record the same student twice", async () => {
    await savePack(pack);
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });
    open();
    await userEvent.selectOptions(await screen.findByLabelText("Roll 2, question 1"), "b");
    const row = within(screen.getByRole("row", { name: /^2/ }));
    await userEvent.click(row.getByRole("button", { name: "Record" }));
    await row.findByText(/Recorded/);
    expect((await listQueue())[0]!.operation.payload.responses[1]!.answer).toEqual({ kind: "blank" });
    expect(row.queryByRole("button", { name: "Record" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Roll 2, question 1")).toBeDisabled();
  });

  it("sends the work when the connection is there, and the queue empties once it is acknowledged", async () => {
    await savePack(pack);
    const calls = mount(`/offline/packs/${pack.id}`, <OfflinePackPage />, "/offline/packs/:packId", {
      "POST /api/v1/sync/operations": () => json(200, { results: [{ idempotencyKey: "x", status: "applied" }] }),
    });
    await userEvent.selectOptions(await screen.findByLabelText("Roll 1, question 1"), "b");
    await userEvent.click(within(screen.getByRole("row", { name: /^1/ })).getByRole("button", { name: "Record" }));
    await waitFor(() => expect(calls.some((c) => c.startsWith("POST /api/v1/sync/operations"))).toBe(true));
    // The scripted reply names a different key, so the real one is kept for retry rather than assumed saved.
    await waitFor(async () => expect((await listQueue()).length).toBe(1));
  });

  it("shows a clear message for a pack that is not on this device", async () => {
    open();
    expect(await screen.findByRole("alert")).toHaveTextContent("not saved on this device");
  });
});

describe("PackPrintPage", () => {
  it("prints worksheet, response sheet and key from the device, with the key on its own page", async () => {
    await savePack(pack);
    mount(`/offline/packs/${pack.id}/print`, <PackPrintPage />, "/offline/packs/:packId/print");
    expect(await screen.findByText(/Worksheet: Adding fractions/)).toBeInTheDocument();
    expect(screen.getByText(/Response sheet: Adding fractions/)).toBeInTheDocument();
    expect(screen.getByText(/Teacher only\. Do not hand this page to students\./)).toBeInTheDocument();
    expect(screen.getAllByText(/B\) 5\/6/)).toHaveLength(2);
  });
});

describe("SyncPage", () => {
  it("shows what is waiting and lets the teacher settle a conflict, applying only what still matches", async () => {
    const conflict = { id: "c1", assessmentId: pack.assessmentId, assessmentTitle: "Offline check", rosterNumber: 3, studentName: "Anu", reason: "pack_stale", explanation: "The questions changed.", responseCount: 2, recordedAt: "2026-10-28T09:00:00Z", canApply: true };
    const calls = mount("/sync", <SyncPage />, "/sync", {
      "GET /api/v1/sync/conflicts": () => json(200, { conflicts: [conflict] }),
      "GET /api/v1/sync/status": () => json(200, { applied: 4, conflicts: 1, rejected: 0, lastAppliedAt: null }),
      "POST /api/v1/sync/conflicts/c1/resolve": () => json(200, { status: "applied", attemptId: "a1" }),
    });
    expect(await screen.findByText("The questions changed.")).toBeInTheDocument();
    expect(screen.getByText(/On the server: 4 saved, 1 waiting for you/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Apply the answers that still match" }));
    await waitFor(() => expect(calls.some((c) => c.startsWith("POST /api/v1/sync/conflicts/c1/resolve") && c.includes('"apply"'))).toBe(true));
  });

  it("hides 'apply' when the server already holds answers, and says it cannot reach the server when offline", async () => {
    mount("/sync", <SyncPage />, "/sync", {
      "GET /api/v1/sync/conflicts": () => json(200, { conflicts: [{ id: "c2", assessmentId: pack.assessmentId, assessmentTitle: "Offline check", rosterNumber: 1, studentName: null, reason: "already_answered", explanation: "The server already has answers.", responseCount: 2, recordedAt: "2026-10-28T09:00:00Z", canApply: false }] }),
      "GET /api/v1/sync/status": () => json(200, { applied: 0, conflicts: 1, rejected: 0, lastAppliedAt: null }),
    });
    expect(await screen.findByText("The server already has answers.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Discard these answers" })).toBeInTheDocument();
  });

  it("when the server cannot be reached, still shows work waiting on the device", async () => {
    await savePack(pack);
    const { enqueue } = await import("./queue");
    await enqueue({ idempotencyKey: "op-waiting-0001", type: "record_responses", baseVersion: "v", recordedAt: "2026-10-28T09:00:00.000Z", payload: { assessmentId: pack.assessmentId, rosterNumber: 2, responses: [{ questionId: Q1, answer: { kind: "blank" } }] } });
    mount("/sync", <SyncPage />, "/sync");
    expect(await screen.findByText(/Waiting on this device \(1\)/)).toBeInTheDocument();
    expect(await screen.findByText(/Could not reach the server to load conflicts/)).toBeInTheDocument();
    expect(screen.getByText(/Roll 2: 1 answers recorded/)).toBeInTheDocument();
  });
});
