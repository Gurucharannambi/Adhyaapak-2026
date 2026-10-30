import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import type { AgentKind, AgentRunDto, FollowupPlan, InterventionPlan, LessonPrepPlan } from "@adhyaapak/shared";
import { Banner } from "../../components/ui";
import { ApiRequestError, api } from "../../services/api";

const TOOL_LABEL: Record<string, string> = {
  get_pattern_evidence: "Looked at the evidence for the pattern",
  get_concept_status: "Checked where the class stands on a concept",
  get_lesson_material: "Read the lesson's approved material",
  find_questions: "Found questions the class has not seen",
  draft_explanation: "Drafted an explanation (private draft)",
  get_class_recap: "Read what happened last time",
  get_check_results: "Read today's check results",
  get_groups: "Read the suggested groups",
};
const GROUP: Record<string, string> = { foundation: "Foundation", guided: "Guided practice", challenge: "Challenge", follow_up: "Needs more evidence" };

/**
 * A teacher-facing agent run: start it, watch each step (what it looked at and why), read the plan, then approve or set
 * it aside. Nothing the agent proposes changes the class until "Approve". The trace is stored, so it reappears on reload.
 */
export function AgentPanel({
  agent,
  classId,
  conceptId,
  patternId,
  title,
  intro,
  afterApprove,
}: {
  agent: AgentKind;
  classId: string;
  conceptId?: string;
  patternId?: string;
  title: string;
  intro: string;
  /** Extra actions once a plan is approved (e.g. "start the check with these questions"). */
  afterApprove?: (run: AgentRunDto) => ReactNode;
}) {
  const [run, setRun] = useState<AgentRunDto | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const key = new URLSearchParams({ ...(conceptId ? { conceptId } : {}), ...(patternId ? { patternId } : {}) }).toString();

  // The latest run for this lesson or pattern, so a reload shows it again.
  useEffect(() => {
    let live = true;
    api<{ run: AgentRunDto | null }>(`/classes/${classId}/agents/${agent}/latest?${key}`)
      .then((r) => live && setRun(r.run))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [agent, classId, key]);

  // While it runs, follow the trace.
  useEffect(() => {
    if (run?.status !== "running") return;
    const id = run.id;
    const timer = setInterval(() => {
      api<AgentRunDto>(`/agent-runs/${id}`)
        .then(setRun)
        .catch(() => undefined);
    }, 1200);
    return () => clearInterval(timer);
  }, [run?.id, run?.status]);

  const message = (e: unknown) => (e instanceof ApiRequestError ? e.message : "Something went wrong. Nothing was changed.");

  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      const { id } = await api<{ id: string }>(`/agents/${agent}/runs`, { method: "POST", body: { classId, ...(conceptId ? { conceptId } : {}), ...(patternId ? { patternId } : {}) } });
      setRun(await api<AgentRunDto>(`/agent-runs/${id}`));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function decide(decision: "approve" | "reject") {
    if (!run) return;
    setBusy(true);
    setError(undefined);
    try {
      setRun(await api<AgentRunDto>(`/agent-runs/${run.id}/decision`, { method: "POST", body: { decision } }));
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  const name = (ref: string) => run?.people[ref] ?? ref;
  const running = run?.status === "running";

  return (
    <section className="glass agent" aria-labelledby={`agent-${agent}-h`}>
      <div className="g-head">
        <h2 id={`agent-${agent}-h`} className="g-title">
          {title} <span className="chip ai">Agent</span>
        </h2>
        {(!run || run.status === "failed" || run.status === "rejected" || run.status === "approved") && (
          <button type="button" className="pill-btn" disabled={busy} onClick={() => void start()}>
            {busy ? "Starting…" : run ? "Run again" : "Run the agent"}
          </button>
        )}
      </div>
      <p className="g-note" style={{ marginTop: -8 }}>
        {intro} It looks things up step by step, shows you each step, and proposes a plan. Nothing changes until you approve.
      </p>
      {error && (
        <Banner tone="err">
          <p>{error}</p>
        </Banner>
      )}

      {run && (
        <>
          <ol className="agent-trace" aria-label="What the agent did" aria-live="polite">
            {run.steps.map((s) => (
              <li key={s.index} className={s.ok ? undefined : "bad"}>
                <span className="n" aria-hidden="true">
                  {s.index + 1}
                </span>
                <div>
                  <strong>{TOOL_LABEL[s.tool] ?? s.tool}</strong>
                  <span className="g-note" style={{ display: "block" }}>
                    {s.reason}
                  </span>
                  <details>
                    <summary>What it found</summary>
                    <code className="obs">{s.observation.replace(/\bS(\d+)\b/g, (m) => `${m} (${name(m)})`)}</code>
                  </details>
                </div>
              </li>
            ))}
            {running && (
              <li className="thinking">
                <span className="n" aria-hidden="true">
                  {run.steps.length + 1}
                </span>
                <div role="status">Working… choosing the next step.</div>
              </li>
            )}
          </ol>

          {run.status === "failed" && (
            <Banner tone="err">
              <p>{run.error}</p>
            </Banner>
          )}

          {run.plan != null && run.status !== "failed" && (
            <div className="agent-plan">
              <h3 style={{ marginTop: 0 }}>Proposed plan {run.status === "approved" && <span className="chip ok">Approved</span>}{run.status === "rejected" && <span className="chip draft">Set aside</span>}</h3>
              {agent === "intervention_planner" && <InterventionView plan={run.plan as InterventionPlan} />}
              {agent === "lesson_prep" && <PrepView plan={run.plan as LessonPrepPlan} />}
              {agent === "check_followup" && <FollowupView plan={run.plan as FollowupPlan} name={name} />}
              {Object.keys(run.people).length > 0 && (
                <p className="g-note">
                  Students were shown to the AI only as {Object.entries(run.people).map(([ref, n]) => `${ref} = ${n}`).join(", ")}.
                </p>
              )}
              {run.status === "awaiting_approval" && (
                <div className="btn-row">
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void decide("approve")}>
                    Approve and carry out
                  </button>
                  <button type="button" className="btn" disabled={busy} onClick={() => void decide("reject")}>
                    Set aside
                  </button>
                </div>
              )}
            </div>
          )}

          {run.outcome && (
            <Banner tone={run.status === "approved" ? "ok" : "info"}>
              <p>{run.outcome.message}</p>
              {run.outcome.links.length > 0 && (
                <p className="actions-inline" style={{ marginTop: 8 }}>
                  {run.outcome.links.map((l) => (
                    <Link key={l.href} className="pill-btn light sm" to={l.href}>
                      {l.label}
                    </Link>
                  ))}
                </p>
              )}
            </Banner>
          )}
          {run.status === "approved" && afterApprove?.(run)}
        </>
      )}
    </section>
  );
}

function InterventionView({ plan }: { plan: InterventionPlan }) {
  return (
    <dl className="kv">
      <dt>In short</dt>
      <dd>{plan.summary}</dd>
      <dt>Likely reasoning</dt>
      <dd>{plan.diagnosis}</dd>
      <dt>Evidence</dt>
      <dd>{plan.evidenceNote}</dd>
      {plan.prerequisiteFirst && (
        <>
          <dt>First</dt>
          <dd>Revisit the earlier idea: {plan.prerequisiteFirst.reason}</dd>
        </>
      )}
      <dt>Explain</dt>
      <dd>
        {plan.explanation.level} level, {plan.explanation.draftId ? "using a new private draft you will review" : "using approved material"}. {plan.explanation.why}
      </dd>
      <dt>Small group</dt>
      <dd>{plan.groupActivity}</dd>
      <dt>Recheck</dt>
      <dd>
        {plan.recheckQuestionIds.length} new questions, in about {plan.recheckAfterDays} days (created as a draft check)
      </dd>
    </dl>
  );
}

function PrepView({ plan }: { plan: LessonPrepPlan }) {
  return (
    <dl className="kv">
      <dt>In short</dt>
      <dd>{plan.summary}</dd>
      <dt>Warm-up</dt>
      <dd>{plan.warmUp.text}</dd>
      <dt>Teach at</dt>
      <dd>
        {plan.level.level} level: {plan.level.reason}
      </dd>
      <dt>Check</dt>
      <dd>{plan.checkQuestionIds.length} questions chosen from the bank</dd>
      {plan.watchFor.length > 0 && (
        <>
          <dt>Watch for</dt>
          <dd>{plan.watchFor.join("; ")}</dd>
        </>
      )}
      {plan.draftId && (
        <>
          <dt>Drafted</dt>
          <dd>A missing explanation, kept as a private draft for you to review</dd>
        </>
      )}
    </dl>
  );
}

function FollowupView({ plan, name }: { plan: FollowupPlan; name: (ref: string) => string }) {
  const word = { reteach: "Reteach", move_on: "Move on", collect_more: "Collect more evidence first" }[plan.decision];
  return (
    <dl className="kv">
      <dt>Decision</dt>
      <dd>
        <span className="chip check">{word}</span> {plan.reason}
      </dd>
      <dt>In short</dt>
      <dd>{plan.summary}</dd>
      {plan.groups.map((g) => (
        <div key={g.groupKey} style={{ display: "contents" }}>
          <dt>{GROUP[g.groupKey]}</dt>
          <dd>
            {g.students.map(name).join(", ") || "Nobody"}: {g.activity}
          </dd>
        </div>
      ))}
      <dt>Follow-up</dt>
      <dd>{plan.followUpQuestionIds.length ? `${plan.followUpQuestionIds.length} new questions (created as a draft check)` : "None proposed"}</dd>
      {plan.teacherNote && (
        <>
          <dt>Note</dt>
          <dd>{plan.teacherNote}</dd>
        </>
      )}
    </dl>
  );
}
