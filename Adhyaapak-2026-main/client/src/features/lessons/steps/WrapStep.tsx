import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import type { LessonRunDto, RunSummary, TimetableResponse, WrapResponse } from "@adhyaapak/shared";
import { AsyncView } from "../../../components/AsyncView";
import { Banner, EmptyState, MarginNote } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { CopilotPanel } from "../copilot/CopilotPanel";
import { NextStepsPanel } from "./NextStepsPanel";
import { AgentPanel } from "../../agents/AgentPanel";
import type { LessonResponse, RunEventDto } from "@adhyaapak/shared";
import { ApiRequestError, api } from "../../../services/api";

const LANE_LABEL: Record<string, string> = { foundation: "board.lane.foundation", guided: "board.lane.guided", challenge: "board.lane.challenge", follow_up: "board.lane.follow_up" };

/**
 * Step 4: results and what to do next. The advice is a suggestion with its reason and how much evidence it rests on;
 * the teacher decides what to tick. Nothing is assigned or recorded until Finish.
 */
export function WrapStep({ classId, conceptId, run, onRunChanged, lesson }: { classId: string; conceptId: string; run: LessonRunDto; onRunChanged: () => void; lesson?: LessonResponse }) {
  const { t } = useTranslation();
  const history = useApi<{ events: RunEventDto[] }>(`/classes/${classId}/lessons/${conceptId}/run/history?k=${run.state}`);
  const [confirming, setConfirming] = useState(false);
  const summary = useApi<RunSummary>(`/classes/${classId}/lessons/${conceptId}/run/summary`);
  const timetable = useApi<TimetableResponse>(`/classes/${classId}/timetable`);
  const navigate = useNavigate();
  const [markTaught, setMarkTaught] = useState(true);
  const [assign, setAssign] = useState<boolean>();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function release(s: RunSummary) {
    setError(undefined);
    try {
      await api(`/assessments/${s.run.assessmentId}/release-results`, { method: "POST" });
      summary.reload();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    }
  }

  async function finish(s: RunSummary) {
    setBusy(true);
    setError(undefined);
    try {
      const res = await api<WrapResponse>(`/classes/${classId}/lessons/${conceptId}/run/wrap`, { method: "POST", body: { markTaught, assignGroups: !lesson && (assign ?? s.recommendation?.sufficiency === "enough") } });
      onRunChanged();
      navigate("/", { state: { wrapped: { title: s.conceptTitle, assigned: res.assigned } } });
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
      setBusy(false);
    }
  }

  return (
    <AsyncView state={summary}>
      {(s) => {
        const next = timetable.data?.upcoming.find((p) => p.lesson && !p.lesson.taught && p.lesson.conceptId !== conceptId);
        const done = s.run.state === "done";
        const groupsWithStudents = s.groups.filter((g) => g.students.length > 0);
        // With the Next steps panel, assigning happens there, so Finish never assigns behind the teacher's moves.
        const defaultAssign = !lesson && (assign ?? s.recommendation?.sufficiency === "enough");
        return (
          <div className="stack">
            {done && (
              <Banner tone="ok">
                <p>{t("run.wrap.done", { defaultValue: "This lesson is wrapped up." })}</p>
              </Banner>
            )}

            {!s.run.assessmentId ? (
              <EmptyState title={t("run.wrap.noCheck", { defaultValue: "No check was run for this lesson today, so there are no results to show. You can still record it as taught." })} />
            ) : (
              <>
                {lesson && s.run.assessmentId && <CopilotPanel classId={classId} lesson={lesson} reloadKey={`wrap-${s.answered}-${s.run.state}`} />}
                {s.recommendation && !dismissed && (
                  <section className="decide-box" aria-labelledby="rec-h">
                    <h2 id="rec-h" style={{ marginTop: 0, fontSize: "var(--fs-m)" }}>{s.recommendation.headline}</h2>
                    <p>{s.recommendation.reason}</p>
                    <p>
                      <span className={s.recommendation.sufficiency === "enough" ? "chip ok" : "chip check"}>
                        {s.recommendation.sufficiency === "enough" ? t("run.wrap.enough", { defaultValue: "Enough answers to say" }) : t("run.wrap.thin", { defaultValue: "Not enough answers yet" })}
                      </span>{" "}
                      <span className="chip sug">{t("run.wrap.suggestion", { defaultValue: "Suggestion" })}</span>
                    </p>
                    <button className="btn btn-sm" onClick={() => setDismissed(true)}>{t("run.wrap.dismiss", { defaultValue: "Dismiss this advice" })}</button>
                  </section>
                )}

                <section aria-labelledby="res-h">
                  <h2 id="res-h" style={{ marginTop: 0 }}>{t("run.wrap.results", { defaultValue: "What the check showed" })}</h2>
                  <p className="muted">{t("run.wrap.answered", { defaultValue: "{{n}} of {{total}} students answered.", n: s.answered, total: s.studentCount })}</p>
                  <div className="grid-2" style={{ alignItems: "start" }}>
                  {s.questions.map((q, i) => (
                    <article key={q.questionId} className="q-card">
                      <h4>
                        Q{i + 1}. {q.stem}
                      </h4>
                      <ul className="plain">
                        {q.options.map((o, k) => (
                          <li key={o.optionId} className="row" style={{ marginBottom: "var(--s2)" }}>
                            <span style={{ minWidth: "9rem" }}>
                              <strong>{"ABCDEFGH"[k]}.</strong> {o.text} {o.correct && <span className="chip ok">✓</span>}
                            </span>
                            <span className="progress" aria-hidden="true" style={{ flex: "1 1 6rem", height: 10 }}>
                              <span style={{ width: `${q.answered ? (o.count / q.answered) * 100 : 0}%` }} />
                            </span>
                            <span className="mono">{o.count}</span>
                            {o.pattern && o.count > 0 && <span className="pen inline">{o.pattern}</span>}
                          </li>
                        ))}
                      </ul>
                      {q.noEvidence > 0 && <p className="hint">{t("activity.noEvidence", { count: q.noEvidence })}</p>}
                    </article>
                  ))}
                  </div>
                </section>

                {lesson && <NextStepsPanel classId={classId} lesson={lesson} groups={s.groups} onAssigned={summary.reload} />}
                {s.run.assessmentId && (
                  <AgentPanel
                    agent="check_followup"
                    classId={classId}
                    conceptId={conceptId}
                    title="Plan next steps with the agent"
                    intro="The follow-up agent reads today's results and the suggested groups, decides whether to reteach, move on or gather more evidence, and proposes an activity per group and a follow-up check."
                  />
                )}
                {!lesson && groupsWithStudents.length > 0 && (
                  <section aria-labelledby="groups-h">
                    <h2 id="groups-h">{t("run.wrap.groups", { defaultValue: "Suggested groups for the next activity" })}</h2>
                    <p className="muted">{t("board.intro")}</p>
                    <div className="board">
                      {groupsWithStudents.map((g) => (
                        <div key={g.key} className={g.key === "follow_up" ? "lane evidence" : "lane"}>
                          <h3>
                            {t(LANE_LABEL[g.key]!)} ({g.students.length})
                          </h3>
                          <p className="actions-inline">
                            {g.students.map((st) => (
                              <span key={st.studentId} className="chip">
                                {st.rosterNumber}. {st.name}
                              </span>
                            ))}
                          </p>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}

            {s.run.assessmentId && (
              <section aria-labelledby="share-h">
                <h2 id="share-h" style={{ fontSize: "var(--fs-m)" }}>{t("run.wrap.shareTitle", { defaultValue: "Students' own results" })}</h2>
                {s.resultsReleased ? (
                  <p>
                    <span className="chip ok">✓ {t("run.wrap.shared", { defaultValue: "Shared" })}</span>{" "}
                    <span className="muted">{t("run.wrap.sharedHelp", { defaultValue: "Each student sees only their own answers, with the explanation." })}</span>
                  </p>
                ) : (
                  <>
                    <p className="muted">{t("run.wrap.shareHelp", { defaultValue: "Let students see which of their answers were right, with the explanation. Each sees only their own. No scores or comparisons." })}</p>
                    <button className="btn btn-sm" onClick={() => void release(s)}>{t("run.wrap.share", { defaultValue: "Show students their results" })}</button>
                  </>
                )}
              </section>
            )}

            {!done && (
              <section className="panel" aria-labelledby="finish-h" style={{ marginTop: 0 }}>
                <h2 id="finish-h" style={{ marginTop: 0, fontSize: "var(--fs-m)" }}>{t("run.wrap.finishTitle", { defaultValue: "Finish this lesson" })}</h2>
                <div className="choice">
                  <input id="wrap-taught" type="checkbox" checked={markTaught} onChange={(e) => setMarkTaught(e.target.checked)} />
                  <label htmlFor="wrap-taught">{t("run.wrap.markTaught", { defaultValue: "Record this lesson as taught" })}</label>
                </div>
                {!lesson && groupsWithStudents.length > 0 && (
                  <div className="choice">
                    <input id="wrap-assign" type="checkbox" checked={!!defaultAssign} onChange={(e) => setAssign(e.target.checked)} />
                    <label htmlFor="wrap-assign">
                      {t("run.wrap.assign", { defaultValue: "Assign the suggested groups for the next period" })}
                      <span className="hint" style={{ display: "block" }}>{t("run.wrap.assignHelp", { defaultValue: "You can still move students on the Branch Board." })}</span>
                    </label>
                  </div>
                )}
                {error && (
                  <Banner tone="err">
                    <p>{error}</p>
                  </Banner>
                )}
                {confirming && (
                  <div className="decide-box" role="alertdialog" aria-labelledby="confirm-h" style={{ marginBottom: "var(--s3)" }}>
                    <p id="confirm-h" style={{ margin: 0 }}>
                      <strong>End this lesson session?</strong> It is recorded
                      {markTaught ? " as taught" : " without being marked as taught"}
                      {defaultAssign ? ", and the suggested groups are assigned for the next period" : ""}. The check stays closed and cannot be reopened.
                    </p>
                  </div>
                )}
                <div className="btn-row" style={{ marginBottom: 0 }}>
                  {confirming ? (
                    <>
                      <button className="btn btn-primary" disabled={busy} onClick={() => void finish(s)}>
                        {busy ? t("common.saving") : t("run.wrap.confirm", { defaultValue: "Yes, end the session" })}
                      </button>
                      <button className="btn" disabled={busy} onClick={() => setConfirming(false)}>
                        {t("run.wrap.keepGoing", { defaultValue: "Not yet" })}
                      </button>
                    </>
                  ) : (
                    <button className="btn btn-primary" disabled={busy} onClick={() => setConfirming(true)}>
                      {t("run.wrap.finish", { defaultValue: "Finish" })}
                    </button>
                  )}
                </div>
              </section>
            )}

            {(history.data?.events.length ?? 0) > 0 && (
              <section aria-labelledby="hist-h">
                <h2 id="hist-h" style={{ fontSize: "var(--fs-m)" }}>{t("run.wrap.history", { defaultValue: "What happened in this lesson" })}</h2>
                <ol className="plain rule-list">
                  {history.data!.events.map((e, i) => (
                    <li key={i} className="row between">
                      <span>{e.label}</span>
                      <span className="hint">{new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

            <section aria-labelledby="more-h">
              <h2 id="more-h" style={{ fontSize: "var(--fs-m)" }}>{t("run.wrap.more", { defaultValue: "Look closer" })}</h2>
              <div className="actions-inline">
                <Link className="btn btn-sm" to={`/classes/${classId}/map`}>{t("map.open")}</Link>
                <Link className="btn btn-sm" to={`/classes/${classId}/branch-board?concept=${conceptId}`}>{t("board.open")}</Link>
                {s.run.assessmentId && (
                  <Link className="btn btn-sm" to={`/activities/${s.run.assessmentId}`}>{t("run.check.details", { defaultValue: "Activity details" })}</Link>
                )}
                <Link className="btn btn-sm" to={`/classes/${classId}/brief`}>{t("classPage.briefLink")}</Link>
              </div>
            </section>

            {next?.lesson && (
              <section aria-labelledby="next-h">
                <h2 id="next-h" style={{ fontSize: "var(--fs-m)" }}>{t("run.wrap.next", { defaultValue: "Next lesson" })}</h2>
                <p style={{ marginBottom: "var(--s1)" }}><strong>{next.lesson.title}</strong></p>
                <p className="hint">
                  {t("classPage.nextLessonWhen", { day: new Date(`${next.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }), n: next.period })}
                </p>
              </section>
            )}
            <MarginNote>{t("run.wrap.provisional", { defaultValue: "Patterns are provisional. A single check cannot show what a student can or cannot do." })}</MarginNote>
          </div>
        );
      }}
    </AsyncView>
  );
}
