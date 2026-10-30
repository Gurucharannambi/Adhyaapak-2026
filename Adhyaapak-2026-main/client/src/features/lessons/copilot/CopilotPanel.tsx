import { useState } from "react";
import { Link, useNavigate } from "react-router";
import type { CopilotAction, CopilotResponse, DraftResourceDto, LessonResponse, QuestionWithConcept, ResourceDto, Suggestion } from "@adhyaapak/shared";
import { AsyncView } from "../../../components/AsyncView";
import { Banner, MarginNote } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { ApiRequestError, api } from "../../../services/api";
import { ResourceView } from "../../curriculum/ResourceView";

const CERTAINTY: Record<Suggestion["certainty"], string> = {
  low: "Evidence: thin",
  medium: "Evidence: a clear signal",
  high: "Evidence: strong",
};

/**
 * The contextual teaching copilot. Suggestions come from the recorded answers by plain rules (server: copilot.ts); each
 * says what the evidence is and how strong it is, and each action leads to something real: material to preview, a check
 * to launch, or an AI draft that stays private until the teacher reviews it. Nothing is added to the lesson automatically.
 */
export function CopilotPanel({ classId, lesson, reloadKey }: { classId: string; lesson: LessonResponse; reloadKey: string }) {
  const state = useApi<CopilotResponse>(`/classes/${classId}/lessons/${lesson.concept.id}/run/copilot?k=${encodeURIComponent(reloadKey)}`);
  return (
    <section aria-labelledby="copilot-h">
      <h2 id="copilot-h" style={{ marginTop: 0, fontSize: "var(--fs-m)" }}>
        Teaching copilot
      </h2>
      <AsyncView state={state}>
        {(r) => (
          <>
            <p className="muted" role="status">
              {r.message}
            </p>
            <ul className="plain stack">
              {r.suggestions.map((s) => (
                <SuggestionCard key={s.id} s={s} classId={classId} lesson={lesson} aiAvailable={r.aiAvailable} />
              ))}
            </ul>
            <MarginNote>These are possibilities for you to judge, not findings about any student.</MarginNote>
          </>
        )}
      </AsyncView>
    </section>
  );
}

function SuggestionCard({ s, classId, lesson, aiAvailable }: { s: Suggestion; classId: string; lesson: LessonResponse; aiAvailable: boolean }) {
  return (
    <li className="q-card" style={{ margin: 0 }}>
      <h3 style={{ margin: "0 0 var(--s2)", fontSize: "var(--fs-b)", fontFamily: "var(--f-body)" }}>{s.title}</h3>
      <p style={{ marginBottom: "var(--s2)" }}>{s.why}</p>
      <ul className="hint" style={{ marginTop: 0 }}>
        {s.evidence.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
      <p>
        <span className={s.certainty === "low" ? "chip check" : "chip"}>{CERTAINTY[s.certainty]}</span>
      </p>
      {s.action && <ActionArea action={s.action} classId={classId} lesson={lesson} aiAvailable={aiAvailable} />}
    </li>
  );
}

function ActionArea({ action, classId, lesson, aiAvailable }: { action: CopilotAction; classId: string; lesson: LessonResponse; aiAvailable: boolean }) {
  switch (action.type) {
    case "preview_resource":
      return <PreviewResource level={action.level} lesson={lesson} />;
    case "preview_question":
      return <PreviewQuestion questionId={action.questionId} stem={action.stem} lesson={lesson} />;
    case "launch_prerequisite_check":
      return <LaunchPrerequisite classId={classId} conceptId={action.conceptId} title={action.conceptTitle} />;
    case "prepare_ai_draft":
      return <PrepareDraft conceptId={lesson.concept.id} level={action.level} aiAvailable={aiAvailable} />;
  }
}

function PreviewResource({ level, lesson }: { level: "foundation" | "guided" | "challenge"; lesson: LessonResponse }) {
  const [open, setOpen] = useState(false);
  const resource: ResourceDto | undefined = lesson.concept.resources.find((r) => r.type === "explanation" && r.level === level);
  if (!resource) return <p className="hint">No approved {level} material in this lesson yet.</p>;
  return (
    <>
      <div className="btn-row" style={{ margin: 0 }}>
        <button className="btn btn-sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide the preview" : "Preview it"}
        </button>
        <Link className="btn btn-sm btn-primary" to={`/present/${lesson.concept.id}?level=${level}`}>
          Show it on the projector
        </Link>
      </div>
      {open && (
        <div className="panel" style={{ marginTop: "var(--s3)" }}>
          <ResourceView resource={resource} />
        </div>
      )}
    </>
  );
}

function PreviewQuestion({ questionId, stem, lesson }: { questionId: string; stem: string; lesson: LessonResponse }) {
  const q: QuestionWithConcept | undefined = lesson.questions.find((x) => x.id === questionId);
  return (
    <div className="panel" style={{ marginTop: 0 }}>
      <p>
        <strong>{stem}</strong>
      </p>
      {q && (
        <ul className="plain">
          {q.options.map((o, i) => (
            <li key={o.id} className={o.id === q.correctOptionId ? "opt correct" : "opt"}>
              <span className="letter">{"ABCDEFGH"[i]}.</span> {o.text}
            </li>
          ))}
        </ul>
      )}
      <p className="hint">Preview for you only. Use it in tomorrow's check or as a challenge on paper.</p>
    </div>
  );
}

/** Previews the earlier idea's questions, then launches a real check on it, so the teacher sees what will run before it does. */
function LaunchPrerequisite({ classId, conceptId, title }: { classId: string; conceptId: string; title: string }) {
  const navigate = useNavigate();
  const [qs, setQs] = useState<QuestionWithConcept[]>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function preview() {
    setBusy(true);
    setError(undefined);
    try {
      setQs((await api<{ questions: QuestionWithConcept[] }>(`/classes/${classId}/assessments/suggest`, { method: "POST", body: { mode: "diagnostic", conceptIds: [conceptId], count: 3 } })).questions);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Could not load the questions.");
    } finally {
      setBusy(false);
    }
  }
  async function launch() {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/classes/${classId}/lessons/${conceptId}/run/check/start`, { method: "POST", body: { questionIds: qs!.map((q) => q.id) } });
      navigate(`/classes/${classId}/lessons/${conceptId}?step=check`);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "Could not start the check.");
      setBusy(false);
    }
  }

  return (
    <>
      {!qs ? (
        <button className="btn btn-sm" onClick={() => void preview()} disabled={busy}>
          {busy ? "Loading…" : `Preview a check on “${title}”`}
        </button>
      ) : (
        <div className="panel" style={{ marginTop: 0 }}>
          <p className="mono eyebrow">Questions that would run</p>
          <ol>
            {qs.map((q) => (
              <li key={q.id}>{q.stem}</li>
            ))}
          </ol>
          <div className="btn-row" style={{ margin: 0 }}>
            <button className="btn btn-primary btn-sm" onClick={() => void launch()} disabled={busy}>
              Launch this check
            </button>
            <button className="btn btn-sm" onClick={() => setQs(undefined)}>
              Not now
            </button>
          </div>
          <p className="hint">This opens that idea's own lesson flow with the check running. You can come back from Today.</p>
        </div>
      )}
      {error && (
        <Banner tone="err">
          <p>{error}</p>
        </Banner>
      )}
    </>
  );
}

/** Asks the server to draft an explanation. The draft is private and unusable in class until the teacher reviews and approves it. */
/**
 * Drafts a parallel explanation with the AI, then lets the teacher read the whole of it and, only after confirming they
 * checked it, add it to the lesson and show it on the projector. Approval goes through the same audited review as the
 * drafts page; the server refuses it without the by-hand confirmation.
 */
function PrepareDraft({ conceptId, level, aiAvailable }: { conceptId: string; level: "foundation" | "guided" | "challenge"; aiAvailable: boolean }) {
  type State =
    | { kind: "idle" }
    | { kind: "working" }
    | { kind: "review"; draft: DraftResourceDto; checked: boolean; busy: boolean; error?: string }
    | { kind: "approved"; draft: DraftResourceDto }
    | { kind: "rejected" }
    | { kind: "failed"; message: string };
  const [state, setState] = useState<State>({ kind: "idle" });
  if (!aiAvailable) return <p className="hint">AI drafting is switched off or not configured, so nothing can be drafted. Use the lesson's own material.</p>;

  async function draft() {
    setState({ kind: "working" });
    try {
      const d = await api<DraftResourceDto>(`/concepts/${conceptId}/drafts/explanations`, { method: "POST", body: { level } });
      setState({ kind: "review", draft: d, checked: false, busy: false });
    } catch (e) {
      setState({ kind: "failed", message: e instanceof ApiRequestError ? e.message : "The AI service did not respond. Nothing was changed." });
    }
  }

  async function decide(s: Extract<State, { kind: "review" }>, decision: "approve" | "reject") {
    setState({ ...s, busy: true, error: undefined });
    try {
      await api(`/resource-drafts/${s.draft.id}/review`, { method: "POST", body: decision === "approve" ? { decision, checkedByHand: s.checked } : { decision } });
      setState(decision === "approve" ? { kind: "approved", draft: s.draft } : { kind: "rejected" });
    } catch (e) {
      setState({ ...s, busy: false, error: e instanceof ApiRequestError ? e.message : "Nothing was changed. Try again." });
    }
  }

  if (state.kind === "approved")
    return (
      <div className="panel" style={{ marginTop: 0 }}>
        <p>
          <span className="chip ok">✓ Added to your lesson</span> <span className="chip ai">From an AI draft you checked</span>
        </p>
        <p>
          <strong>{state.draft.title}</strong> is now the {state.draft.level} explanation.
        </p>
        <Link className="btn btn-primary btn-sm" to={`/present/${conceptId}?level=${state.draft.level}`}>
          Show it on the projector
        </Link>
      </div>
    );
  if (state.kind === "rejected") return <p className="hint">Draft set aside. Nothing was added to your lesson.</p>;

  if (state.kind === "review") {
    const d = state.draft;
    return (
      <div className="panel" style={{ marginTop: 0 }}>
        <p>
          <span className="chip ai">AI draft</span> <span className="chip draft">Not in your lesson yet</span>
        </p>
        <h4 style={{ margin: "0 0 var(--s2)" }}>{d.title}</h4>
        <p>{d.content.summary}</p>
        {d.content.steps.length > 0 && (
          <ol>
            {d.content.steps.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        )}
        {d.content.workedExample && (
          <>
            <p>
              <strong>Worked example:</strong> {d.content.workedExample.problem}
            </p>
            <ol>
              {d.content.workedExample.steps.map((x, i) => (
                <li key={i}>{x}</li>
              ))}
            </ol>
          </>
        )}
        {d.content.commonError && (
          <p>
            <strong>Common error:</strong> {d.content.commonError}
          </p>
        )}
        {d.check.issues.length > 0 && (
          <Banner tone={d.approvable ? "warn" : "err"}>
            <p>{d.check.issues.join(" ")}</p>
          </Banner>
        )}
        {state.error && (
          <Banner tone="err">
            <p>{state.error}</p>
          </Banner>
        )}
        {d.approvable ? (
          <>
            <div className="choice">
              <input id={`chk-${d.id}`} type="checkbox" checked={state.checked} onChange={(e) => setState({ ...state, checked: e.target.checked })} />
              <label htmlFor={`chk-${d.id}`}>I have read all of it and checked it is correct.</label>
            </div>
            <div className="btn-row">
              <button className="btn btn-primary btn-sm" disabled={!state.checked || state.busy} onClick={() => void decide(state, "approve")}>
                {state.busy ? "Saving…" : "Add to the lesson"}
              </button>
              <button className="btn btn-sm" disabled={state.busy} onClick={() => void decide(state, "reject")}>
                Not this one
              </button>
            </div>
          </>
        ) : (
          <p className="hint">This draft cannot be used as it is.</p>
        )}
        <Link to={`/curriculum/concepts/${conceptId}/drafts`}>Edit it on the drafts page instead</Link>
      </div>
    );
  }

  return (
    <>
      <button className="btn btn-sm" onClick={() => void draft()} disabled={state.kind === "working"}>
        {state.kind === "working" ? "Drafting…" : state.kind === "failed" ? "Try again" : "Draft a parallel example"}
      </button>
      {state.kind === "failed" && (
        <Banner tone="err">
          <p>{state.message} Nothing was added to your lesson.</p>
        </Banner>
      )}
    </>
  );
}
