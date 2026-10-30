import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AgentRunDto } from "@adhyaapak/shared";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import "../../i18n";
import { AgentPanel } from "./AgentPanel";

const json = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
afterEach(() => vi.unstubAllGlobals());

const base: AgentRunDto = {
  id: "r1",
  agent: "check_followup",
  status: "awaiting_approval",
  classId: "cl1",
  conceptId: "c1",
  patternId: null,
  steps: [
    { index: 0, reason: "First I need today's results.", tool: "get_check_results", args: {}, observation: '{"answered":6}', ok: true, durationMs: 12 },
    { index: 1, reason: "Who should be grouped together?", tool: "get_groups", args: {}, observation: '{"follow_up":[{"student":"S1"}]}', ok: true, durationMs: 9 },
  ],
  plan: { summary: "One student added the denominators.", decision: "collect_more", reason: "One question is thin evidence.", groups: [{ groupKey: "follow_up", students: ["S1"], activity: "One more question with strips." }], followUpQuestionIds: ["q9"], teacherNote: "" },
  people: { S1: "Ravi Kumar" },
  error: null,
  outcome: null,
  createdAt: "2026-10-29T08:00:00.000Z",
};

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

const panel = () =>
  render(
    <MemoryRouter>
      <AgentPanel agent="check_followup" classId="cl1" conceptId="c1" title="Plan next steps with the agent" intro="Reads today's results." />
    </MemoryRouter>,
  );

describe("agent panel", () => {
  it("runs the agent, shows each step and why, resolves pseudonyms for the teacher only, and approves on request", async () => {
    let state: AgentRunDto = base;
    const calls = mock({
      "GET /api/v1/classes/cl1/agents/check_followup/latest?conceptId=c1": () => json(200, { run: null }),
      "POST /api/v1/agents/check_followup/runs": () => json(202, { id: "r1" }),
      "GET /api/v1/agent-runs/r1": () => json(200, state),
      "POST /api/v1/agent-runs/r1/decision": () => {
        state = { ...base, status: "approved", outcome: { message: "1 students have their next activity.", links: [{ label: "Branch Board", href: "/classes/cl1/branch-board?concept=c1" }] } };
        return json(200, state);
      },
    });
    panel();
    await userEvent.click(await screen.findByRole("button", { name: "Run the agent" }));
    expect(await screen.findByText("Read today's check results")).toBeInTheDocument();
    expect(screen.getByText("First I need today's results.")).toBeInTheDocument();
    expect(screen.getByText(/Collect more evidence first/)).toBeInTheDocument();
    expect(screen.getByText(/Ravi Kumar: One more question with strips\./)).toBeInTheDocument();
    expect(screen.getByText(/shown to the AI only as S1 = Ravi Kumar/)).toBeInTheDocument();
    expect(calls.some((c) => c.key.includes("/decision"))).toBe(false); // nothing happens until the teacher decides
    await userEvent.click(screen.getByRole("button", { name: "Approve and carry out" }));
    expect(await screen.findByText("1 students have their next activity.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Branch Board" })).toHaveAttribute("href", "/classes/cl1/branch-board?concept=c1");
    expect(calls.find((c) => c.key.includes("/decision"))!.body).toEqual({ decision: "approve" });
  });

  it("shows the last run again after a reload, and says plainly when the AI is off", async () => {
    mock({
      "GET /api/v1/classes/cl1/agents/check_followup/latest?conceptId=c1": () => json(200, { run: { ...base, status: "failed", plan: null, error: "The agent stopped. Nothing was changed." } }),
      "POST /api/v1/agents/check_followup/runs": () => json(502, { error: { code: "provider_error", message: "AI is switched off or not configured, so the agent cannot run." }, requestId: "x" }),
    });
    panel();
    expect(await screen.findByText("The agent stopped. Nothing was changed.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Run again" }));
    await waitFor(() => expect(screen.getByText(/AI is switched off or not configured/)).toBeInTheDocument());
  });
});
