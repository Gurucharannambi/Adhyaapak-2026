import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import type { StudentActivityResponse } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { StudentShell } from "../../components/StudentShell";
import { Banner } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { useLive } from "../../hooks/useLive";
import { ApiRequestError, api } from "../../services/api";

type Confidence = "sure" | "unsure" | "guess";

/** Student view of the open activity. Never shows answers or whether an answer was right. */
export function PlayPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // Slow polling is only the fallback: the server tells this screen the moment the check opens, closes or is released.
  const state = useApi<StudentActivityResponse>("/student/activity", { refreshMs: 20000 });
  const live = useLive(state.error?.code === "unauthenticated" ? null : "/api/v1/student/live", state.reload);
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [confidence, setConfidence] = useState<Record<string, Confidence>>({});
  const [pollChoice, setPollChoice] = useState<string>();
  const [pollText, setPollText] = useState("");
  // A message belongs to the screen it was shown on; a new state (paused, resumed, closed) starts clean.
  const screen = state.data?.state;
  useEffect(() => setError(undefined), [screen]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // One key per page load: pressing "Send" twice or retrying after a bad connection cannot submit twice.
  const key = useRef(crypto.randomUUID());

  async function leave() {
    await api("/student/leave", { method: "POST" }).catch(() => undefined);
    navigate("/join", { replace: true });
  }

  async function submit(e: FormEvent, questionIds: string[]) {
    e.preventDefault();
    const answers = questionIds
      .filter((id) => choices[id])
      .map((id) => ({ questionId: id, optionId: choices[id]!, ...(confidence[id] ? { confidence: confidence[id] } : {}) }));
    if (answers.length === 0) {
      setError(t("play.answerOne"));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await api("/student/activity/answers", { method: "POST", body: { idempotencyKey: key.current, answers } });
      state.reload();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "unauthenticated") return void navigate("/join", { replace: true });
      // Paused or closed meanwhile: show what the screen should say now. The chosen answers stay in this page.
      if (err instanceof ApiRequestError && err.code === "conflict") state.reload();
      setError(err instanceof ApiRequestError ? (err.code === "network_error" || err.code === "offline" ? t(`errors.${err.code}`) : err.message) : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  async function vote(e: FormEvent) {
    e.preventDefault();
    const typed = state.data?.poll?.answerType === "text";
    if (typed ? !pollText.trim() : !pollChoice) {
      setError(typed ? t("play.typeOne", { defaultValue: "Type your answer first." }) : t("play.pickOne", { defaultValue: "Pick one answer first." }));
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      // The server keeps the first answer, so a double tap or a retry cannot count twice.
      await api("/student/poll/vote", { method: "POST", body: typed ? { text: pollText.trim() } : { optionId: pollChoice } });
      setPollChoice(undefined);
      setPollText("");
      state.reload();
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === "unauthenticated") return void navigate("/join", { replace: true });
      setError(err instanceof ApiRequestError ? (err.code === "network_error" || err.code === "offline" ? t(`errors.${err.code}`) : err.message) : t("common.unexpectedError"));
      // A closed poll: show whatever is next.
      if (err instanceof ApiRequestError && err.code === "conflict") state.reload();
    } finally {
      setBusy(false);
    }
  }

  if (state.error?.code === "unauthenticated") {
    return (
      <StudentShell>
        <div className="s-card">
          <p>{t("play.joinFirst")}</p>
          <Link className="btn btn-primary" to="/join">
            {t("play.toJoin")}
          </Link>
        </div>
      </StudentShell>
    );
  }

  return (
    <StudentShell>
      <AsyncView state={state}>
        {(a) => {
          if (a.state === "no_activity")
            return (
              <div className="s-card">
                <h1>{t("play.hello", { name: a.studentName })}</h1>
                <p>{t("play.nothingOpen")}</p>
                <p className="hint" role="status">{live ? t("play.waitingLive", { defaultValue: "This page will change by itself when your teacher starts." }) : t("play.waitingPoll", { defaultValue: "Checking every few seconds." })}</p>
                <div className="btn-row">
                  <button className="btn btn-primary" onClick={state.reload}>
                    {t("play.checkAgain")}
                  </button>
                  <button className="btn" onClick={() => void leave()}>
                    {t("play.leave")}
                  </button>
                </div>
              </div>
            );
          if (a.state === "paused")
            return (
              <div className="s-card">
                <h1>{t("play.pausedTitle", { defaultValue: "Paused for a moment" })}</h1>
                <p>{t("play.pausedBody", { defaultValue: "Your teacher has paused the check. Anything you chose is kept. This page will carry on when it starts again." })}</p>
              </div>
            );
          if (a.state === "poll" && a.poll) {
            const poll = a.poll;
            if (poll.answered)
              return (
                <div className="s-card">
                  <h1>{t("play.pollThanks", { defaultValue: "Thanks, {{name}}", name: a.studentName })}</h1>
                  <p>{t("play.pollSent", { defaultValue: "Your answer is in. There is no right or wrong here." })}</p>
                  <p className="hint" role="status">{t("play.pollWait", { defaultValue: "This page will change when your teacher moves on." })}</p>
                </div>
              );
            return (
              <form onSubmit={(e) => void vote(e)}>
                <p className="muted">{t("play.hello", { name: a.studentName })}</p>
                {poll.answerType === "text" ? (
                  <div className="s-q">
                    <label className="field">
                      <span style={{ fontSize: "var(--fs-l)" }}>{poll.prompt}</span>
                      <input value={pollText} maxLength={24} autoComplete="off" inputMode="text" onChange={(e) => setPollText(e.target.value)} />
                    </label>
                  </div>
                ) : (
                  <fieldset className="s-q">
                    <legend>{poll.prompt}</legend>
                    {poll.options.map((o) => (
                      <label key={o.id} className="opt-btn">
                        <input type="radio" name={`poll-${poll.id}`} checked={pollChoice === o.id} onChange={() => setPollChoice(o.id)} />
                        <span>{o.text}</span>
                      </label>
                    ))}
                  </fieldset>
                )}
                {error && (
                  <Banner tone="err">
                    <p>{error}</p>
                  </Banner>
                )}
                <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
                  {busy ? t("common.saving") : t("play.sendOne", { defaultValue: "Send my answer" })}
                </button>
              </form>
            );
          }
          if (a.state === "results" && a.results)
            return (
              <>
                <h1>{t("play.resultsTitle", { defaultValue: "Your answers" })}</h1>
                <p className="muted">{t("play.resultsLede", { defaultValue: "Here is how each one went, with the reason. Only you can see this page." })}</p>
                {a.results.questions.map((q, i) => (
                  <section key={i} className="s-card" aria-label={`${i + 1}`}>
                    <h2 style={{ fontSize: "var(--fs-m)" }}>
                      {i + 1}. {q.stem}
                    </h2>
                    <p>
                      {q.outcome === "right" && <span className="pen-tick" aria-hidden="true">✓ </span>}
                      <strong>{q.outcome === "right" ? t("learn.gotIt") : q.outcome === "blank" ? t("learn.noAnswer") : t("learn.tryAgainLater")}</strong>
                    </p>
                    {q.outcome === "not_yet" && q.yourAnswer && <p className="muted">{t("play.youChose", { defaultValue: "You chose: {{answer}}", answer: q.yourAnswer })}</p>}
                    {q.outcome !== "right" && <p>{t("play.rightAnswer", { defaultValue: "The right answer: {{answer}}", answer: q.correctAnswer })}</p>}
                    <p className="hint">{q.explanation}</p>
                  </section>
                ))}
                <button className="btn" onClick={() => void leave()}>
                  {t("play.leave")}
                </button>
              </>
            );
          if (a.state === "submitted")
            return (
              <div className="s-card">
                <h1>{t("play.thanks", { name: a.studentName })}</h1>
                <p>{t("play.sent")}</p>
                <p className="hint" role="status">{t("play.waitForResults", { defaultValue: "Your teacher will show the answers when everyone has finished." })}</p>
                <button className="btn" onClick={() => void leave()}>
                  {t("play.leave")}
                </button>
              </div>
            );
          const { questions, title } = a.assessment!;
          return (
            <form onSubmit={(e) => void submit(e, questions.map((q) => q.id))}>
              <h1>{title}</h1>
              <p className="muted">{t("play.hello", { name: a.studentName })}</p>
              {questions.map((q, i) => (
                <fieldset key={q.id} className="s-q">
                  <legend>
                    {i + 1}. {q.stem}
                  </legend>
                  {q.options.map((o) => (
                    <label key={o.id} className="opt-btn">
                      <input type="radio" name={`q-${q.id}`} checked={choices[q.id] === o.id} onChange={() => setChoices((c) => ({ ...c, [q.id]: o.id }))} />
                      <span>
                        {o.id.toUpperCase()}. {o.text}
                      </span>
                    </label>
                  ))}
                  {choices[q.id] && (
                    <div role="radiogroup" aria-label={t("play.howSure")}>
                      <p className="hint" style={{ marginTop: "1rem", marginBottom: 0 }}>
                        {t("play.howSure")}
                      </p>
                      <div className="sure">
                        {(["sure", "unsure", "guess"] as const).map((c) => (
                          <label key={c} className={confidence[q.id] === c ? "on" : undefined}>
                            <input type="radio" name={`c-${q.id}`} checked={confidence[q.id] === c} onChange={() => setConfidence((x) => ({ ...x, [q.id]: c }))} />
                            {t(`play.${c}`)}
                          </label>
                        ))}
                      </div>
                    </div>
                  )}
                </fieldset>
              ))}
              {error && (
                <Banner tone="err">
                  <p>{error}</p>
                </Banner>
              )}
              <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
                {busy ? t("common.saving") : t("play.send")}
              </button>
            </form>
          );
        }}
      </AsyncView>
    </StudentShell>
  );
}
