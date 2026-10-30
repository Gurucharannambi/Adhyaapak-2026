import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { AssessmentDetailDto, LessonResponse, LessonRunDto, QuestionWithConcept, StartCheckResponse } from "@adhyaapak/shared";
import { AsyncView } from "../../../components/AsyncView";
import { Banner, EmptyState, MarginNote } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { useLive } from "../../../hooks/useLive";
import { useOnline } from "../../../hooks/useOnline";
import { ApiRequestError, api } from "../../../services/api";
import { FastEntryGrid } from "../../assessments/FastEntryGrid";

type Mode = "paper" | "devices" | "handsup";
const LETTERS = "ABCDEFGH";

/**
 * Step 3: the 2-minute check. Paper is the default because it needs no student devices: print slips, then key the
 * answers in the grid. Devices and a hands-up count are one tap away.
 */
export function CheckStep({ classId, lesson, run, onRunChanged, onGo }: { classId: string; lesson: LessonResponse; run: LessonRunDto; onRunChanged: () => void; onGo: (step: "teach" | "wrap") => void }) {
  const { t } = useTranslation();
  if (run.assessmentId && (run.state === "checking" || run.state === "paused")) return <LiveCheck classId={classId} lesson={lesson} run={run} onRunChanged={onRunChanged} onGo={onGo} />;
  if (run.assessmentId) {
    return (
      <div className="stack">
        <Banner tone="ok">
          <p>{t("run.check.finished", { defaultValue: "The check is finished. Its answers are counted." })}</p>
        </Banner>
        <button className="btn btn-primary" onClick={() => onGo("wrap")}>{t("run.check.toWrap", { defaultValue: "See results and next steps" })} →</button>
      </div>
    );
  }
  return <ChooseQuestions classId={classId} lesson={lesson} onRunChanged={onRunChanged} onGo={onGo} />;
}

function ChooseQuestions({ classId, lesson, onRunChanged, onGo }: { classId: string; lesson: LessonResponse; onRunChanged: () => void; onGo: (step: "teach" | "wrap") => void }) {
  const { t } = useTranslation();
  const bank = lesson.questions;
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; hint?: boolean }>();

  // Start from the same questions the server would pick; the teacher can change them.
  useEffect(() => {
    let off = false;
    api<{ questions: QuestionWithConcept[] }>(`/classes/${classId}/assessments/suggest`, { method: "POST", body: { mode: "diagnostic", conceptIds: [lesson.concept.id], count: 3 } })
      .then((r) => !off && setPicked(r.questions.map((q) => q.id)))
      .catch(() => !off && setPicked(bank.filter((q) => q.role === "diagnostic").slice(0, 3).map((q) => q.id)));
    return () => {
      off = true;
    };
  }, [classId, lesson.concept.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 5 ? [...p, id] : p));

  async function start() {
    setBusy(true);
    setError(undefined);
    try {
      await api<StartCheckResponse>(`/classes/${classId}/lessons/${lesson.concept.id}/run/check/start`, { method: "POST", body: { questionIds: picked } });
      onRunChanged();
    } catch (e) {
      setError({ message: e instanceof ApiRequestError ? e.message : t("common.unexpectedError"), hint: e instanceof ApiRequestError && e.code === "conflict" });
      setBusy(false);
    }
  }

  if (bank.length === 0) {
    return (
      <div className="stack">
        <EmptyState title={t("run.check.noBank", { defaultValue: "This lesson has no check questions yet." })} />
        <button className="btn" onClick={() => onGo("wrap")}>{t("run.check.skip", { defaultValue: "Skip the check and finish the lesson" })}</button>
      </div>
    );
  }

  return (
    <div className="stack">
      <p className="lede">{t("run.check.lede", { defaultValue: "Two to three questions whose wrong answers tell you something. These are chosen from the approved bank; tick or untick to change them." })}</p>
      {bank.map((q, i) => (
        <article key={q.id} className="q-card">
          <div className="choice" style={{ cursor: "pointer" }}>
            <input id={`pick-${q.id}`} type="checkbox" checked={picked.includes(q.id)} onChange={() => toggle(q.id)} />
            <label htmlFor={`pick-${q.id}`}>
              <strong>{q.stem}</strong>
            </label>
          </div>
          <ul className="plain" style={{ marginLeft: "2.25rem" }}>
            {q.options.map((o, k) => (
              <li key={o.id} className={o.id === q.correctOptionId ? "opt correct" : "opt"}>
                <span className="letter">{LETTERS[k]}.</span> {o.text}
              </li>
            ))}
          </ul>
          <p className="hint" style={{ marginLeft: "2.25rem" }}>{t("concept.difficulty", { n: q.difficulty })} · {i + 1}</p>
        </article>
      ))}
      {error && (
        <Banner tone="err">
          <p>{error.message}</p>
        </Banner>
      )}
      <div className="btn-row step-bar">
        <button className="btn btn-primary" disabled={busy || picked.length === 0} onClick={() => void start()}>
          {busy ? t("common.loading") : t("run.check.start", { defaultValue: "Start the check" })}
        </button>
        <button className="btn" onClick={() => onGo("wrap")}>{t("run.check.skip", { defaultValue: "Skip the check and finish the lesson" })}</button>
      </div>
    </div>
  );
}

function LiveCheck({ classId, lesson, run, onRunChanged, onGo }: { classId: string; lesson: LessonResponse; run: LessonRunDto; onRunChanged: () => void; onGo: (step: "teach" | "wrap") => void }) {
  const { t } = useTranslation();
  // Live: the server tells us the moment a student answers or joins. Polling is only the slow fallback.
  const detail = useApi<AssessmentDetailDto>(`/assessments/${run.assessmentId}`, { refreshMs: 15000 });
  const live = useLive(`/api/v1/classes/${classId}/live`, detail.reload);
  const online = useOnline();
  const [mode, setMode] = useState<Mode>("paper");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function finish() {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/classes/${classId}/lessons/${lesson.concept.id}/run/check/finish`, { method: "POST" });
      onRunChanged();
      onGo("wrap");
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
      setBusy(false);
    }
  }

  const paused = run.state === "paused";
  async function togglePause() {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/classes/${classId}/lessons/${lesson.concept.id}/run/${paused ? "resume" : "pause"}`, { method: "POST" });
      onRunChanged();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  const modes: Array<[Mode, string]> = [
    ["paper", t("run.check.paper", { defaultValue: "Paper answers" })],
    ["devices", t("run.check.devices", { defaultValue: "Student devices" })],
    ["handsup", t("run.check.handsUp", { defaultValue: "Hands-up count" })],
  ];

  return (
    <AsyncView state={detail}>
      {(d) => {
        const done = d.students.filter((s) => s.submitted).length;
        const joined = d.students.filter((s) => s.joined).length;
        return (
          <div className="stack">
            <section aria-label={t("run.check.progress", { defaultValue: "Progress" })}>
              <p style={{ marginBottom: "var(--s2)" }}>
                <strong>{t("activity.progress", { done, total: d.students.length })}</strong>{" "}
                <span className={live ? "chip ok" : "chip check"} role="status">
                  {!online ? `⚠ ${t("run.live.offline", { defaultValue: "Offline" })}` : live ? `● ${t("run.live.on", { defaultValue: "Live" })}` : `○ ${t("run.live.off", { defaultValue: "Reconnecting…" })}`}
                </span>
              </p>
              <div className="btn-row" style={{ marginBottom: "var(--s2)" }}>
                <button type="button" className="btn btn-sm" disabled={busy} onClick={() => void togglePause()}>
                  {paused ? t("run.check.resume", { defaultValue: "Resume the check" }) : t("run.check.pause", { defaultValue: "Pause the check" })}
                </button>
              </div>
              {paused && (
                <Banner tone="info">
                  <p>{t("run.check.pausedHelp", { defaultValue: "Paused. Students' devices are not taking new answers, and their screens say so. You can still key in paper answers, or finish the check." })}</p>
                </Banner>
              )}
              {!online && (
                <Banner tone="warn">
                  <p>{t("run.live.offlineHelp", { defaultValue: "You are offline. Answers keyed in now cannot be saved until the connection is back. Keep the paper slips safe and enter them when you are online." })}</p>
                </Banner>
              )}
              <div className="progress" aria-hidden="true">
                <span style={{ width: `${d.students.length ? (done / d.students.length) * 100 : 0}%` }} />
              </div>
            </section>

            <div className="tabs" role="tablist" aria-label={t("run.check.how", { defaultValue: "How are students answering?" })}>
              {modes.map(([m, label]) => (
                <button key={m} className="tab" role="tab" aria-selected={mode === m} onClick={() => setMode(m)}>
                  {label}
                </button>
              ))}
            </div>

            {mode === "paper" && (
              <section aria-labelledby="paper-h">
                <h2 id="paper-h" style={{ marginTop: 0 }}>{t("run.check.paperTitle", { defaultValue: "Key in the answers from paper" })}</h2>
                <p className="muted">{t("run.check.paperHelp", { defaultValue: "Hand out the slips, collect them, then type one letter per box. Blank means no answer, which is never counted as wrong." })}</p>
                <div className="btn-row" style={{ marginTop: 0 }}>
                  <Link className="btn btn-sm" to={`/activities/${d.id}/print-sheets`} target="_blank" rel="noopener noreferrer">
                    {t("run.check.printSlips", { defaultValue: "Print answer slips" })}
                  </Link>
                  <Link className="btn btn-sm" to={`/activities/${d.id}/paper`}>
                    {t("run.check.photo", { defaultValue: "Photograph sheets instead" })}
                  </Link>
                </div>
                <FastEntryGrid detail={d} onSaved={detail.reload} />
              </section>
            )}

            {mode === "devices" && (
              <section className="slip code joinpanel" aria-labelledby="join-h">
                <h2 id="join-h" style={{ marginTop: 0 }}>{t("activity.studentsJoin")}</h2>
                <p className="go">
                  {t("activity.goTo")} <strong>{window.location.origin}/join</strong>
                </p>
                <p className="joincode">{d.classJoinCode}</p>
                <p>{t("activity.thenNumber")}</p>
                <p className="hint" aria-live="polite">{t("run.live.joined", { defaultValue: "{{n}} of {{total}} have joined", n: joined, total: d.students.length })}</p>
              </section>
            )}

            {mode === "handsup" && <HandsUp detail={d} />}

            <Scoreboard detail={d} />

            <section aria-labelledby="sofar-h">
              <h2 id="sofar-h" style={{ fontSize: "var(--fs-m)" }}>{t("run.check.soFar", { defaultValue: "Answers so far" })}</h2>
              <ul className="plain rule-list">
                {d.questions.map((q, i) => {
                  const tally = d.tallies.find((x) => x.questionId === q.id);
                  return (
                    <li key={q.id}>
                      <strong>Q{i + 1}.</strong> {q.stem}
                      <div className="actions-inline" style={{ marginTop: "var(--s1)" }}>
                        {q.options.map((o, k) => (
                          <span key={o.id} className="chip">
                            {LETTERS[k]} · {tally?.options.find((x) => x.optionId === o.id)?.count ?? 0}
                          </span>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            {error && (
              <Banner tone="err">
                <p>{error}</p>
              </Banner>
            )}
            <div className="btn-row step-bar">
              <button className="btn btn-primary" onClick={() => void finish()} disabled={busy}>
                {t("run.check.see", { defaultValue: "See results" })} →
              </button>
              <Link className="btn btn-sm" to={`/activities/${d.id}`}>{t("run.check.details", { defaultValue: "Activity details" })}</Link>
            </div>
            <MarginNote>{t("run.check.seeHelp", { defaultValue: "Seeing results closes the check. Answers you keyed are saved as you go." })}</MarginNote>
          </div>
        );
      }}
    </AsyncView>
  );
}

/**
 * Live scores for the teacher. Each student's answers are checked the moment they are saved, so this fills in as the
 * class answers. Teacher-only: students never see scores, and a blank answer is no evidence, not a wrong one.
 */
function Scoreboard({ detail }: { detail: AssessmentDetailDto }) {
  const { t } = useTranslation();
  const scored = detail.students.filter((s) => s.score);
  const right = scored.reduce((n, s) => n + s.score!.correct, 0);
  const answered = scored.reduce((n, s) => n + s.score!.answered, 0);
  return (
    <section aria-labelledby="board-h">
      <h2 id="board-h" style={{ fontSize: "var(--fs-m)" }}>{t("run.live.scoreboard", { defaultValue: "Live scores" })}</h2>
      <p className="chip private">{t("run.live.teacherOnly", { defaultValue: "Only you see this" })}</p>
      <p aria-live="polite" className="muted">
        {answered > 0
          ? t("run.live.classSoFar", { defaultValue: "{{right}} of {{answered}} answers right so far", right, answered })
          : t("run.live.waiting", { defaultValue: "Waiting for the first answers." })}
      </p>
      <div className="table-wrap scroll-y">
        <table className="ruled">
          <thead>
            <tr>
              <th scope="col" className="num">{t("classPage.rosterNumber")}</th>
              <th scope="col">{t("classPage.name")}</th>
              <th scope="col">{t("run.live.status", { defaultValue: "Status" })}</th>
              <th scope="col" className="num">{t("run.live.right", { defaultValue: "Right" })}</th>
            </tr>
          </thead>
          <tbody>
            {detail.students.map((s) => (
              <tr key={s.id}>
                <td className="num">{s.rosterNumber}</td>
                <td>{s.name}</td>
                <td>
                  {s.submitted ? <span className="chip ok">✓ {t("run.live.answered", { defaultValue: "Answered" })}</span> : s.joined ? <span className="chip">{t("run.live.joinedChip", { defaultValue: "Joined" })}</span> : <span className="muted">{t("run.live.notYet", { defaultValue: "Not yet" })}</span>}
                </td>
                <td className="num">{s.score ? `${s.score.correct} / ${s.score.total}` : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * A quick class-level count when students answer by raising hands. It lives only on this screen: it is not saved,
 * and it is never added to any student's record (no names are attached).
 */
function HandsUp({ detail }: { detail: AssessmentDetailDto }) {
  const { t } = useTranslation();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const bump = (key: string, by: number) => setCounts((c) => ({ ...c, [key]: Math.max(0, (c[key] ?? 0) + by) }));
  return (
    <section aria-labelledby="hands-h">
      <h2 id="hands-h" style={{ marginTop: 0 }}>{t("run.check.handsTitle", { defaultValue: "Hands-up count" })}</h2>
      <Banner tone="info">
        <p>{t("run.check.handsNote", { defaultValue: "This count is for a quick decision in class. It is not saved and is not added to any student's record. To record answers, key them in on the Paper tab." })}</p>
      </Banner>
      {detail.questions.map((q, i) => {
        const total = q.options.reduce((s, o) => s + (counts[`${q.id}:${o.id}`] ?? 0), 0);
        return (
          <article key={q.id} className="q-card">
            <h4>
              Q{i + 1}. {q.stem}
            </h4>
            <ul className="plain">
              {q.options.map((o, k) => {
                const n = counts[`${q.id}:${o.id}`] ?? 0;
                return (
                  <li key={o.id} className="row" style={{ marginBottom: "var(--s2)" }}>
                    <span style={{ minWidth: "6rem" }}>
                      <strong>{LETTERS[k]}.</strong> {o.text}
                    </span>
                    <button className="btn btn-sm" aria-label={t("run.check.minus", { defaultValue: "Remove one for {{letter}}, question {{n}}", letter: LETTERS[k], n: i + 1 })} onClick={() => bump(`${q.id}:${o.id}`, -1)}>
                      −
                    </button>
                    <span className="mono" style={{ minWidth: "2ch", textAlign: "center" }} aria-live="polite">{n}</span>
                    <button className="btn btn-sm" aria-label={t("run.check.plus", { defaultValue: "Add one for {{letter}}, question {{n}}", letter: LETTERS[k], n: i + 1 })} onClick={() => bump(`${q.id}:${o.id}`, 1)}>
                      +
                    </button>
                    <span className="progress" aria-hidden="true" style={{ flex: "1 1 6rem", height: 10 }}>
                      <span style={{ width: `${total ? (n / total) * 100 : 0}%` }} />
                    </span>
                  </li>
                );
              })}
            </ul>
          </article>
        );
      })}
    </section>
  );
}
