import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useSearchParams } from "react-router";
import type { AtlasRecord, AtlasResponse, AtlasWorkspaceResponse, ClassDto, ObservationReview, TrackOutcome } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { Banner } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { classLabel } from "../../utils/classLabel";
import { ApiRequestError, api } from "../../services/api";
import { initials } from "../../utils/initials";
import { AgentPanel } from "../agents/AgentPanel";

const STRENGTH: Record<AtlasRecord["strength"], { text: string; cls: string; help: string }> = {
  single: { text: "Seen once per student", cls: "chip", help: "Each student gave this answer once. That is an incorrect answer to look at, not yet a misconception." },
  repeated: { text: "Repeated", cls: "chip check", help: "At least one student gave a matching answer in more than one question. A possible misconception, worth checking." },
  confirmed: { text: "Confirmed by you", cls: "chip decide", help: "You confirmed it for at least one student after looking at their answers." },
};
const REVIEW: Record<ObservationReview, string> = { open: "Not reviewed", confirmed: "Confirmed", dismissed: "Dismissed", inconclusive: "Inconclusive" };
const OUTCOME: Record<TrackOutcome, { text: string; help: string }> = {
  demonstrated: { text: "Understanding shown", help: "Two or more right answers on the concept since, and no wrong ones." },
  partial: { text: "Partly", help: "Some right answers since, but not yet two right with none wrong." },
  same_error: { text: "Same error again", help: "A later answer matched this pattern again." },
  other_error: { text: "Other mistakes", help: "Later answers were wrong, but not with this pattern." },
  no_new_evidence: { text: "No new evidence", help: "No counted answer on the concept since. Nothing can be said yet." },
};
const STEPS = ["Detect", "Verify", "Understand", "Intervene", "Recheck", "Track"] as const;
type Step = (typeof STEPS)[number];
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/**
 * Misconception Atlas: from a recurring answer pattern to a teaching decision and back to the evidence. Every figure is
 * computed on the server from stored answers; a single wrong answer is never presented as a misconception.
 */
export function AtlasPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "library" ? "library" : "workspace";
  const classes = useApi<{ classes: ClassDto[] }>("/classes");
  return (
    <>
      <section className="hello" style={{ marginBottom: 20 }}>
        <div>
          <h1>{t("atlas.title", { defaultValue: "Misconception Atlas" })}</h1>
          <p>Notice a pattern, check the evidence, teach to it, and see whether it changed.</p>
        </div>
        <div className="cls-switch" role="tablist" aria-label="Atlas view">
          <button type="button" role="tab" aria-selected={tab === "workspace"} aria-pressed={tab === "workspace"} onClick={() => setParams((p) => (p.delete("tab"), p))}>
            My classes
          </button>
          <button type="button" role="tab" aria-selected={tab === "library"} aria-pressed={tab === "library"} onClick={() => setParams((p) => (p.set("tab", "library"), p))}>
            Pattern library
          </button>
        </div>
      </section>
      {tab === "library" ? (
        <Library />
      ) : (
        <AsyncView state={classes}>
          {({ classes: list }) => {
            if (list.length === 0) return <div className="glass">Create a class first. Patterns appear here once its students answer a check.</div>;
            const classId = params.get("class") && list.some((c) => c.id === params.get("class")) ? params.get("class")! : list[0]!.id;
            return (
              <>
                {list.length > 1 && (
                  <div className="cls-switch" role="group" aria-label="Class" style={{ marginBottom: 18 }}>
                    {list.map((c) => (
                      <button key={c.id} type="button" aria-pressed={c.id === classId} onClick={() => setParams({ class: c.id })}>
                        {classLabel(c, list)}
                      </button>
                    ))}
                  </div>
                )}
                <Workspace classId={classId} />
              </>
            );
          }}
        </AsyncView>
      )}
    </>
  );
}

function Workspace({ classId }: { classId: string }) {
  const state = useApi<AtlasWorkspaceResponse>(`/classes/${classId}/atlas`);
  const [selected, setSelected] = useState<string>();
  const [q, setQ] = useState("");
  const [concept, setConcept] = useState("all");
  const [strength, setStrength] = useState("all");
  const [review, setReview] = useState("all");
  return (
    <AsyncView state={state}>
      {(w) => {
        const concepts = [...new Map(w.records.map((r) => [r.concept.id, r.concept])).values()];
        const shown = w.records.filter(
          (r) =>
            (concept === "all" || r.concept.id === concept) &&
            (strength === "all" || r.strength === strength) &&
            (review === "all" || (review === "open" ? r.review.open > 0 : r.review[review as ObservationReview] > 0)) &&
            (q === "" || `${r.name} ${r.description} ${r.concept.title}`.toLowerCase().includes(q.toLowerCase())),
        );
        const current = shown.find((r) => r.patternId === selected) ?? shown[0];
        return (
          <>
            <p className="g-note" style={{ margin: "-6px 0 16px" }}>
              Class {w.className} · Mathematics{concepts[0] ? ` · ${[...new Set(concepts.map((c) => c.chapterTitle))].join(", ")}` : ""}
            </p>
            <div className="stat-cards">
              <div className="glass stat-card">
                <p className="label">Needs investigation</p>
                <b>{w.summary.needsInvestigation}</b>
                <small>Students with repeated evidence of a pattern (not dismissed)</small>
              </div>
              <div className="glass stat-card">
                <p className="label">Concepts to revisit</p>
                <b>{w.summary.conceptsToRevisit}</b>
                <small>Concepts with a repeated or confirmed pattern, from recorded checks</small>
              </div>
              <div className="glass stat-card">
                <p className="label">Awaiting your review</p>
                <b>{w.summary.awaitingReview}</b>
                <small>Students with repeated evidence you have not looked at yet</small>
              </div>
            </div>

            {w.records.length === 0 ? (
              <div className="glass">
                <p style={{ marginTop: 0 }}>No answer patterns in {w.className} yet. They appear when students choose an answer that matches a known pattern in a check.</p>
                <Link className="pill-btn" to="/">
                  Go to Today
                </Link>
              </div>
            ) : (
              <div className="split">
                <section className="glass" aria-labelledby="patterns-h">
                  <div className="g-head">
                    <h2 id="patterns-h">Patterns</h2>
                    <span className="g-note">{shown.length} shown</span>
                  </div>
                  <div className="filters">
                    <label>
                      Search
                      <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. denominators" />
                    </label>
                    <label>
                      Concept
                      <select value={concept} onChange={(e) => setConcept(e.target.value)}>
                        <option value="all">All concepts</option>
                        {concepts.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Evidence
                      <select value={strength} onChange={(e) => setStrength(e.target.value)}>
                        <option value="all">Any</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="repeated">Repeated</option>
                        <option value="single">Seen once</option>
                      </select>
                    </label>
                    <label>
                      Review
                      <select value={review} onChange={(e) => setReview(e.target.value)}>
                        <option value="all">Any</option>
                        <option value="open">Not reviewed</option>
                        <option value="confirmed">Confirmed</option>
                        <option value="inconclusive">Inconclusive</option>
                      </select>
                    </label>
                  </div>
                  <ul className="reclist">
                    {shown.map((r) => (
                      <li key={r.patternId}>
                        <button type="button" aria-current={r === current} onClick={() => setSelected(r.patternId)}>
                          <span className="t">
                            <span>{r.name}</span>
                            <span className={STRENGTH[r.strength].cls}>{STRENGTH[r.strength].text}</span>
                          </span>
                          <span className="m">
                            {r.concept.title} · {r.affected} of {r.answeredOnConcept} students who answered · last seen {day(r.lastSeen)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  {shown.length === 0 && <p className="g-note">No pattern matches these filters.</p>}
                </section>
                {current && <Record key={current.patternId} r={current} classId={classId} onChanged={state.reload} />}
              </div>
            )}
          </>
        );
      }}
    </AsyncView>
  );
}

function Record({ r, classId, onChanged }: { r: AtlasRecord; classId: string; onChanged: () => void }) {
  const [step, setStep] = useState<Step>("Detect");
  return (
    <article className="glass" aria-labelledby="rec-h">
      <div className="g-head" style={{ alignItems: "flex-start" }}>
        <div>
          <h2 id="rec-h" style={{ fontSize: "1.5rem" }}>
            {r.name}
          </h2>
          <p className="g-note" style={{ marginTop: 4 }}>
            {r.concept.chapterTitle} · {r.concept.title}
          </p>
        </div>
        <span className={STRENGTH[r.strength].cls}>{STRENGTH[r.strength].text}</span>
      </div>
      <ol className="flow" role="tablist" aria-label="From diagnosis to intervention">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" role="tab" aria-selected={step === s} onClick={() => setStep(s)}>
              <span>{i + 1}</span>
              {s}
            </button>
          </li>
        ))}
      </ol>
      <div role="tabpanel" aria-label={step}>
        {step === "Detect" && <Detect r={r} />}
        {step === "Verify" && <Verify r={r} classId={classId} onChanged={onChanged} />}
        {step === "Understand" && <Understand r={r} classId={classId} />}
        {step === "Intervene" && <Intervene r={r} classId={classId} />}
        {step === "Recheck" && <Recheck r={r} classId={classId} />}
        {step === "Track" && <Track r={r} classId={classId} />}
      </div>
    </article>
  );
}

function Detect({ r }: { r: AtlasRecord }) {
  const example = r.responses[0];
  return (
    <>
      <p style={{ fontSize: "1.0625rem" }}>
        <strong>Possible pattern:</strong> {r.description}
      </p>
      {example && (
        <div className="quote">
          <span className="g-note">Example response</span>
          <div className="ans">
            {example.question} → <s>{example.answer}</s> <span className="g-note">(expected {example.expected})</span>
          </div>
        </div>
      )}
      <div className="stat-cards" style={{ marginTop: 14 }}>
        <div className="glass-in">
          <p className="g-note">Students affected</p>
          <b style={{ font: "400 2rem/1 var(--f-head)" }}>
            {r.affected}
            <span className="g-note" style={{ fontSize: 15 }}>
              {" "}
              of {r.answeredOnConcept} who answered
            </span>
          </b>
        </div>
        <div className="glass-in">
          <p className="g-note">Seen in more than one answer</p>
          <b style={{ font: "400 2rem/1 var(--f-head)" }}>{r.repeated}</b>
        </div>
        <div className="glass-in">
          <p className="g-note">Checks · dates</p>
          <b style={{ font: "500 1.0625rem/1.4 var(--f-body)" }}>
            {r.checks} {r.checks === 1 ? "check" : "checks"} · {day(r.firstSeen)}
            {r.firstSeen.slice(0, 10) !== r.lastSeen.slice(0, 10) ? ` to ${day(r.lastSeen)}` : ""}
          </b>
        </div>
      </div>
      <p className="pen" style={{ marginTop: 16 }}>
        Evidence: {STRENGTH[r.strength].help} This is a possible misconception, not a permanent label.
      </p>
    </>
  );
}

function Verify({ r, classId, onChanged }: { r: AtlasRecord; classId: string; onChanged: () => void }) {
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [done, setDone] = useState<string>();
  async function decide(studentId: string, name: string, decision: "confirm" | "reject" | "inconclusive") {
    setBusy(studentId);
    setError(undefined);
    setDone(undefined);
    try {
      await api(`/classes/${classId}/misconceptions/review`, { method: "POST", body: { studentId, patternId: r.patternId, decision } });
      setDone(`${name}: ${decision === "confirm" ? "confirmed" : decision === "reject" ? "dismissed" : "marked inconclusive"}. The answers are kept.`);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Nothing was changed. Try again.");
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <>
      <p className="g-note">Read the actual answers, then decide for each student. Confirming needs the pattern in more than one question. Inconclusive keeps the evidence and waits for more; a new matching answer reopens it.</p>
      {error && (
        <Banner tone="err">
          <p>{error}</p>
        </Banner>
      )}
      {done && (
        <Banner tone="ok">
          <p>{done}</p>
        </Banner>
      )}
      <ul className="plain">
        {r.students.map((s) => {
          const theirs = r.responses.filter((x) => x.studentId === s.id);
          return (
            <li key={s.id} className="glass-in" style={{ marginBottom: 10 }}>
              <div className="row between">
                <span className="row" style={{ gap: 10 }}>
                  <span className="av" aria-hidden="true">
                    {initials(s.name)}
                  </span>
                  <span>
                    <strong style={{ fontWeight: 500 }}>{s.name}</strong>
                    <span className="g-note" style={{ display: "block" }}>
                      {s.observations} matching {s.observations === 1 ? "answer" : "answers"} · last {day(s.lastSeen)} · {REVIEW[s.review]}
                    </span>
                  </span>
                </span>
                {s.review === "open" && (
                  <span className="actions-inline">
                    <button type="button" className="pill-btn" disabled={busy === s.id || s.observations < 2} title={s.observations < 2 ? "Needs the pattern in more than one question" : undefined} onClick={() => void decide(s.id, s.name, "confirm")}>
                      Confirm
                    </button>
                    <button type="button" className="pill-btn light" disabled={busy === s.id} onClick={() => void decide(s.id, s.name, "inconclusive")}>
                      Inconclusive
                    </button>
                    <button type="button" className="pill-btn light" disabled={busy === s.id} onClick={() => void decide(s.id, s.name, "reject")}>
                      Dismiss
                    </button>
                  </span>
                )}
              </div>
              {theirs.length > 0 && (
                <ul className="plain" style={{ marginTop: 10 }}>
                  {theirs.map((x, i) => (
                    <li key={i} className="g-note" style={{ padding: "3px 0" }}>
                      {day(x.at)} · {x.check}: “{x.question}” → <strong style={{ color: "var(--tx)" }}>{x.answer}</strong> (expected {x.expected})
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function Understand({ r, classId }: { r: AtlasRecord; classId: string }) {
  return (
    <>
      <h3 style={{ marginTop: 0 }}>Likely reasoning</h3>
      <p>{r.description}</p>
      <h3>What tends to help</h3>
      <p>{r.recommendedExplanation}</p>
      <h3>Builds on</h3>
      {r.prerequisites.length === 0 ? (
        <p className="g-note">No earlier idea is recorded for this concept.</p>
      ) : (
        <p className="actions-inline">
          {r.prerequisites.map((p) => (
            <Link key={p.id} className="pill-btn light" to={`/classes/${classId}/concept-map?concept=${p.id}`}>
              {p.title}
            </Link>
          ))}
        </p>
      )}
      <p className="g-note">If several students are also not secure on an earlier idea, revisit that first; the concept map shows where the class stands on each.</p>
    </>
  );
}

function Intervene({ r, classId }: { r: AtlasRecord; classId: string }) {
  const lesson = `/classes/${classId}/lessons/${r.concept.id}`;
  return (
    <>
      <AgentPanel
        agent="intervention_planner"
        classId={classId}
        patternId={r.patternId}
        title="Plan it with the agent"
        intro={`The intervention planner investigates this pattern's evidence, the earlier ideas it builds on and the material you have, then proposes an explanation, a small-group activity and a recheck with new questions.`}
      />
      <h3>Or choose a tool yourself</h3>
      <p className="g-note">Each option opens the real lesson tools for {r.concept.title}. Nothing is assigned until you choose.</p>
      <ul className="plain kvlist">
        <li>
          <span>
            <strong style={{ fontWeight: 500 }}>Visual explanation</strong>
            <span className="g-note" style={{ display: "block" }}>The Foundation explanation on the projector, with fraction pictures.</span>
          </span>
          <Link className="pill-btn" to={`/present/${r.concept.id}?level=foundation`}>
            Open on projector
          </Link>
        </li>
        <li>
          <span>
            <strong style={{ fontWeight: 500 }}>Worked example in the lesson</strong>
            <span className="g-note" style={{ display: "block" }}>Teach step with the Guided level, steps revealed one at a time.</span>
          </span>
          <Link className="pill-btn light" to={`${lesson}?step=teach`}>
            Open lesson
          </Link>
        </li>
        <li>
          <span>
            <strong style={{ fontWeight: 500 }}>Small-group activity</strong>
            <span className="g-note" style={{ display: "block" }}>Place the {r.affected} affected students on the Foundation path; moves need a reason.</span>
          </span>
          <Link className="pill-btn light" to={`/classes/${classId}/branch-board?concept=${r.concept.id}`}>
            Branch Board
          </Link>
        </li>
        <li>
          <span>
            <strong style={{ fontWeight: 500 }}>Differentiated worksheet</strong>
            <span className="g-note" style={{ display: "block" }}>Print the lesson pack with all three levels for paper work.</span>
          </span>
          <Link className="pill-btn light" to="/offline">
            Lesson packs
          </Link>
        </li>
      </ul>
      <p className="g-note">
        Assigned so far: {r.interventions.assigned} active, {r.interventions.completed} completed, among the affected students.
      </p>
    </>
  );
}

function Recheck({ r, classId }: { r: AtlasRecord; classId: string }) {
  return (
    <>
      <p>A recheck should test the idea underneath, not repeat the same question with new numbers. The check step picks approved questions on {r.concept.title}; swap any you have already used.</p>
      <div className="actions-inline">
        <Link className="pill-btn" to={`/classes/${classId}/lessons/${r.concept.id}?step=check`}>
          Prepare a recheck
        </Link>
        <Link className="pill-btn light" to={`/classes/${classId}/branch-board?concept=${r.concept.id}`}>
          Follow-up for a group
        </Link>
      </div>
      <p className="g-note" style={{ marginTop: 14 }}>
        New answers update this pattern's Track tab by themselves. A pattern is never marked resolved because an activity was launched.
      </p>
    </>
  );
}

function Track({ r, classId }: { r: AtlasRecord; classId: string }) {
  const order: TrackOutcome[] = ["demonstrated", "partial", "same_error", "other_error", "no_new_evidence"];
  const counted = r.students.filter((s) => s.review !== "dismissed");
  return (
    <>
      <p className="g-note">What each affected student's answers on {r.concept.title} say since their latest matching answer.</p>
      <ul className="plain kvlist">
        {order.map((o) => (
          <li key={o}>
            <span>
              {OUTCOME[o].text}
              <span className="g-note" style={{ display: "block" }}>
                {OUTCOME[o].help}
              </span>
            </span>
            <b>
              {r.track[o]}
              <span className="g-note"> / {counted.length}</span>
            </b>
          </li>
        ))}
      </ul>
      <details className="def">
        <summary>By student</summary>
        <ul className="plain" style={{ marginTop: 8 }}>
          {counted.map((s) => (
            <li key={s.id} style={{ padding: "4px 0" }}>
              <Link to={`/classes/${classId}/students/${s.id}`}>{s.name}</Link>: {OUTCOME[s.outcome].text}
            </li>
          ))}
        </ul>
      </details>
    </>
  );
}

/** The rule library: every known pattern per concept, with this teacher's own confirm and dismiss record. */
function Library() {
  const { t } = useTranslation();
  const state = useApi<AtlasResponse>("/misconceptions/atlas");
  const [q, setQ] = useState("");
  return (
    <AsyncView state={state}>
      {(a) => {
        const concepts = a.concepts.map((c) => ({ ...c, rules: c.rules.filter((r) => q === "" || `${r.name} ${r.description}`.toLowerCase().includes(q.toLowerCase())) })).filter((c) => c.rules.length > 0);
        return (
          <>
            <div className="filters" style={{ maxWidth: 420 }}>
              <label>
                Search patterns
                <input className="input" value={q} onChange={(e) => setQ(e.target.value)} />
              </label>
            </div>
            <p className="g-note">{t("atlas.intro")}</p>
            {concepts.map((c) => (
              <section key={c.conceptId} className="glass" style={{ marginBottom: 16 }} aria-labelledby={`c-${c.conceptId}`}>
                <h2 id={`c-${c.conceptId}`} style={{ marginTop: 0 }}>
                  {c.title}
                </h2>
                {c.rules.map((r) => (
                  <article key={r.patternId} className="glass-in" style={{ marginBottom: 10 }}>
                    <h3 style={{ marginTop: 0 }}>{r.name}</h3>
                    <p>{r.description}</p>
                    <p>
                      <strong>{t("atlas.examples")}:</strong> {r.exampleWrongAnswers.join(" · ")}
                    </p>
                    <p>
                      <strong>{t("atlas.whatToDo")}:</strong> {r.recommendedExplanation}
                    </p>
                    {r.followUpQuestion && (
                      <p>
                        <strong>{t("atlas.followUp")}:</strong> {r.followUpQuestion}
                      </p>
                    )}
                    <p className="g-note">
                      {t("atlas.stats", { observed: r.stats.studentsObserved, confirmed: r.stats.confirmed, rejected: r.stats.rejected })} · <strong>{t(`atlas.quality.${r.quality}`, { min: a.minDecisions })}</strong>
                    </p>
                  </article>
                ))}
              </section>
            ))}
          </>
        );
      }}
    </AsyncView>
  );
}
