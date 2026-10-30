import { useState, type FormEvent } from "react";
import type { CreatePollRequest, CurrentPollResponse, PollDto, PollKind } from "@adhyaapak/shared";
import { Banner } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { useLive } from "../../../hooks/useLive";
import { ApiRequestError, api } from "../../../services/api";

const KINDS: Array<{ kind: PollKind; label: string; hint: string }> = [
  { kind: "confidence", label: "How sure are you?", hint: "Fixed, gentle wording. A quick read of how the class feels about the idea." },
  { kind: "true_false", label: "True or false", hint: "Write a statement; students pick True or False." },
  { kind: "choice", label: "Pick one", hint: "Your own question with two to four choices." },
  { kind: "short_answer", label: "Short answer", hint: "Students type a short answer; equal fractions are grouped for you." },
];

/** A quick pulse of the class. Counts only; never scored and never added to anyone's learning record. */
export function PollPanel({ classId, conceptId }: { classId: string; conceptId: string }) {
  const url = `/classes/${classId}/lessons/${conceptId}/polls/current`;
  const current = useApi<CurrentPollResponse>(url, { refreshMs: 20000 });
  // Answers arrive as signals; the counts are then re-read from the permission-checked API.
  const live = useLive(`/api/v1/classes/${classId}/live`, current.reload);
  const [kind, setKind] = useState<PollKind>("confidence");
  const [prompt, setPrompt] = useState("");
  const [choices, setChoices] = useState(["", ""]);
  const [expected, setExpected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const message = (err: unknown) => (err instanceof ApiRequestError ? (err.code === "network_error" || err.code === "offline" ? "There is no connection. Nothing was changed." : err.message) : "Something went wrong. Nothing was changed.");

  async function ask(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    const body: CreatePollRequest =
      kind === "confidence"
        ? { kind }
        : kind === "true_false"
          ? { kind, prompt }
          : kind === "short_answer"
            ? { kind, prompt, ...(expected.trim() ? { expectedAnswer: expected.trim() } : {}) }
            : { kind, prompt, options: choices.map((c) => c.trim()).filter(Boolean) };
    setBusy(true);
    try {
      await api(`/classes/${classId}/lessons/${conceptId}/polls`, { method: "POST", body });
      setPrompt("");
      setChoices(["", ""]);
      setExpected("");
      current.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  async function close(poll: PollDto) {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/polls/${poll.id}/close`, { method: "POST" });
      current.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const poll = current.data?.poll ?? null;

  return (
    <div className="poll-panel">
      {current.error && !current.data && (
        <Banner tone="err">
          <p>{current.error.message}</p>
        </Banner>
      )}
      {error && (
        <Banner tone="err">
          <p>{error}</p>
        </Banner>
      )}

      {poll?.status === "open" && (
        <section aria-labelledby="poll-open-h">
          <p className="hint" role="status">
            {live ? "Live: answers appear as students send them." : "Checking every few seconds."}
          </p>
          <PollResults poll={poll} headingId="poll-open-h" />
          <div className="btn-row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void close(poll)}>
              {busy ? "Saving…" : "Close the poll"}
            </button>
          </div>
        </section>
      )}

      {poll?.status !== "open" && (
        <form onSubmit={(e) => void ask(e)} aria-label="Ask the class a quick question">
          <fieldset className="poll-kinds">
            <legend>What kind of question?</legend>
            {KINDS.map((k) => (
              <label key={k.kind} className={kind === k.kind ? "on" : undefined}>
                <input type="radio" name="poll-kind" checked={kind === k.kind} onChange={() => setKind(k.kind)} />
                <span>
                  <strong>{k.label}</strong>
                  <span className="hint"> {k.hint}</span>
                </span>
              </label>
            ))}
          </fieldset>
          {kind !== "confidence" && (
            <label className="field">
              <span>Question</span>
              <input value={prompt} maxLength={200} onChange={(e) => setPrompt(e.target.value)} placeholder={kind === "true_false" ? "2/4 is the same amount as 1/2" : "Which picture shows more?"} />
            </label>
          )}
          {kind === "short_answer" && (
            <label className="field">
              <span>
                Expected answer <span className="hint">(optional, only you see it)</span>
              </span>
              <input value={expected} maxLength={24} onChange={(e) => setExpected(e.target.value)} placeholder="4/8" />
            </label>
          )}
          {kind === "choice" && (
            <fieldset className="poll-choices">
              <legend>Choices (two to four)</legend>
              {choices.map((c, i) => (
                <input key={i} aria-label={`Choice ${i + 1}`} value={c} maxLength={80} onChange={(e) => setChoices((all) => all.map((x, j) => (j === i ? e.target.value : x)))} />
              ))}
              {choices.length < 4 && (
                <button type="button" className="btn btn-sm" onClick={() => setChoices((all) => [...all, ""])}>
                  Add a choice
                </button>
              )}
            </fieldset>
          )}
          <div className="btn-row">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? "Saving…" : "Ask the class"}
            </button>
          </div>
          <p className="hint">Students see it on their devices. You see counts only; who chose what is not shown, and nothing here is saved to a student's learning record.</p>
        </form>
      )}

      {poll?.status === "closed" && (
        <section aria-labelledby="poll-last-h" style={{ marginTop: "var(--s4)" }}>
          <PollResults poll={poll} headingId="poll-last-h" prefix="Last poll: " />
        </section>
      )}
      {!poll && current.data && <p className="hint">No poll asked in this lesson yet.</p>}
    </div>
  );
}

/** Bars with the number written out, so the result never depends on length or colour alone. */
export function PollResults({ poll, headingId, prefix = "" }: { poll: PollDto; headingId: string; prefix?: string }) {
  const typed = poll.kind === "short_answer";
  const rows = typed ? poll.answers.map((a, i) => ({ id: String(i), text: a.label, count: a.count, variants: a.variants, matches: a.matches })) : poll.options.map((o) => ({ ...o, variants: [] as string[], matches: null as boolean | null }));
  const max = Math.max(1, ...rows.map((o) => o.count));
  return (
    <>
      <h3 id={headingId} style={{ fontSize: "var(--fs-m)", margin: "0 0 var(--s2)" }}>
        {prefix}
        {poll.prompt}
      </h3>
      <p>
        <strong>
          {poll.answered} of {poll.classSize}
        </strong>{" "}
        answered
        {poll.status === "closed" ? " (closed)" : ""}
      </p>
      {typed && poll.expectedAnswer && <p className="hint">Your expected answer: {poll.expectedAnswer}. Equal fractions and decimals count as the same answer.</p>}
      {typed && rows.length === 0 && <p className="hint">No answers yet.</p>}
      <ul className="plain poll-bars" aria-labelledby={headingId}>
        {rows.map((o) => (
          <li key={o.id}>
            <span className="poll-label">
              {o.text}
              {o.variants.length > 0 && <span className="hint"> (also {o.variants.join(", ")})</span>}
              {o.matches === true && <span className="chip ok"> ✓ matches</span>}
            </span>
            <span className="poll-track" aria-hidden="true">
              <span className="poll-fill" style={{ width: `${(o.count / max) * 100}%` }} />
            </span>
            <span className="poll-count">{o.count}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
