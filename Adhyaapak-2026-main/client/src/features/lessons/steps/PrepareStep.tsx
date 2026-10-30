import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { LessonPrepPlan, LessonResponse, RunRecap } from "@adhyaapak/shared";
import { ApiRequestError, api } from "../../../services/api";
import { AgentPanel } from "../../agents/AgentPanel";
import { AsyncView } from "../../../components/AsyncView";
import { Chip, EmptyState, MarginNote } from "../../../components/ui";
import { useApi } from "../../../hooks/useApi";
import { PrepareOffline } from "../../offline/PrepareOffline";

/**
 * Step 1, before class: what happened last time, what this lesson builds on, and the things to have ready.
 * Everything shown is read from stored records; nothing is estimated.
 */
export function PrepareStep({ classId, lesson, onPrint, onStart, starting, onCheckStarted }: { classId: string; lesson: LessonResponse; onPrint: (what: "worksheet" | "key") => void; onStart: () => void; starting: boolean; onCheckStarted?: () => void }) {
  const { t } = useTranslation();
  const recap = useApi<RunRecap>(`/classes/${classId}/lessons/${lesson.concept.id}/run/recap`);
  return (
    <div className="stack">
      <section aria-labelledby="recap-h">
        <h2 id="recap-h" style={{ marginTop: 0 }}>{t("run.prepare.recapTitle", { defaultValue: "Before you start" })}</h2>
        <AsyncView state={recap}>
          {(r) => (
            <>
              {r.previous ? (
                <div className="q-card">
                  <p className="hint" style={{ margin: 0 }}>
                    {t("run.prepare.last", { defaultValue: "Last lesson: {{title}}", title: r.previous.lessonTitle })} · {r.previous.date}
                  </p>
                  {r.previous.patterns.length > 0 ? (
                    <>
                      <p style={{ margin: "0.5rem 0 0" }}>{t("run.prepare.lastPatterns", { defaultValue: "Its check showed these answer patterns:" })}</p>
                      <ul>
                        {r.previous.patterns.map((p) => (
                          <li key={p.name}>
                            {p.name} · {t("lesson.studentsCount", { count: p.studentCount })}
                          </li>
                        ))}
                      </ul>
                      <MarginNote>{t("run.prepare.recapAdvice", { defaultValue: "Consider a 2-minute recap with a picture before today's new idea." })}</MarginNote>
                    </>
                  ) : (
                    <p className="muted" style={{ margin: "0.5rem 0 0" }}>{t("run.prepare.lastClean", { defaultValue: "No error pattern stood out in its check." })}</p>
                  )}
                </div>
              ) : (
                <p className="muted">{t("run.prepare.noLast", { defaultValue: "No earlier lesson has been wrapped up for this class yet." })}</p>
              )}

              <h3>{t("run.prepare.builtOn", { defaultValue: "This lesson builds on" })}</h3>
              {r.prerequisites.length === 0 ? (
                <p className="muted">{t("run.prepare.noPrereq", { defaultValue: "Nothing earlier: a good place to start." })}</p>
              ) : (
                <ul className="plain rule-list">
                  {r.prerequisites.map((p) => (
                    <li key={p.conceptId} className="row between">
                      <span>{p.title}</span>
                      {p.assessed === 0 ? (
                        <span className="chip">{t("run.prepare.notAssessed", { defaultValue: "Not assessed yet" })}</span>
                      ) : p.notSecure > 0 ? (
                        <span className="chip check">{t("run.prepare.notSecure", { defaultValue: "{{n}} of {{total}} not yet secure", n: p.notSecure, total: p.assessed })}</span>
                      ) : (
                        <span className="chip ok">✓ {t("run.prepare.secure", { defaultValue: "Secure for all assessed" })}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </AsyncView>
      </section>

      <section aria-labelledby="goal-h">
        <h2 id="goal-h">{t("run.prepare.goal", { defaultValue: "From the textbook" })}</h2>
        {lesson.chapter.summary && <p>{lesson.chapter.summary}</p>}
        {lesson.chapter.keyIdeas.length > 0 && (
          <>
            <h3 style={{ marginTop: 0 }}>{t("textbook.keyIdeas")}</h3>
            <ul>
              {lesson.chapter.keyIdeas.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="ready-h">
        <h2 id="ready-h">{t("run.prepare.ready", { defaultValue: "Have ready" })}</h2>
        <ul className="plain rule-list">
          <li className="row between">
            <span>
              <strong>{t("run.prepare.projector", { defaultValue: "Projector view" })}</strong>
              <span className="hint" style={{ display: "block" }}>{t("run.prepare.projectorHelp", { defaultValue: "Teaching content only. No names, no answers." })}</span>
            </span>
            <Link className="btn btn-sm" to={`/present/${lesson.concept.id}`}>{t("lesson.present")}</Link>
          </li>
          <li className="row between">
            <span>
              <strong>{t("run.prepare.paper", { defaultValue: "Printed worksheet and answer key" })}</strong>
              <span className="hint" style={{ display: "block" }}>{t("run.prepare.paperHelp", { defaultValue: "For students without devices. The key prints on its own page." })}</span>
            </span>
            <span className="actions-inline">
              <button className="btn btn-sm" onClick={() => onPrint("worksheet")}>{t("lesson.printWorksheet")}</button>
              <button className="btn btn-sm" onClick={() => onPrint("key")}>{t("lesson.printKey")}</button>
            </span>
          </li>
          <li className="row between">
            <span>
              <strong>{t("run.prepare.pack", { defaultValue: "Save for offline use" })}</strong>
              <span className="hint" style={{ display: "block" }}>{t("run.prepare.packHelp", { defaultValue: "Lesson, questions and response sheet on this device, in case the internet drops." })}</span>
            </span>
            <PrepareOffline classId={classId} conceptId={lesson.concept.id} />
          </li>
        </ul>
        {lesson.questions.length === 0 && <EmptyState title={t("run.prepare.noQuestions", { defaultValue: "This lesson has no check questions yet. You can still teach it and wrap up without a check." })} />}
      </section>

      <div className="btn-row step-bar">
        <button className="btn btn-primary" onClick={onStart} disabled={starting}>
          {t("run.prepare.start", { defaultValue: "Start the lesson" })} →
        </button>
        {lesson.taught && <Chip tone="ok">✓ {t("lesson.taughtOn", { date: new Date(lesson.taught.at).toLocaleDateString() })}</Chip>}
      </div>
      <AgentPanel
        agent="lesson_prep"
        classId={classId}
        conceptId={lesson.concept.id}
        title="Prepare with the agent"
        intro="The lesson prep agent reads what happened last time, how ready the class is on the earlier ideas, and the approved material, then suggests a warm-up, a level and the check questions."
        afterApprove={(run) => <StartWithPlan classId={classId} conceptId={lesson.concept.id} plan={run.plan as LessonPrepPlan} onStarted={onCheckStarted} />}
      />
    </div>
  );
}

/** Starts today's check with the questions an approved prep plan chose. */
function StartWithPlan({ classId, conceptId, plan, onStarted }: { classId: string; conceptId: string; plan: LessonPrepPlan; onStarted?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function go() {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/classes/${classId}/lessons/${conceptId}/run/check/start`, { method: "POST", body: { questionIds: plan.checkQuestionIds } });
      onStarted?.();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : "The check could not start. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="btn-row">
      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void go()}>
        {busy ? "Starting…" : `Start the check with these ${plan.checkQuestionIds.length} questions`}
      </button>
      {error && <span role="alert" className="field-err">{error}</span>}
    </div>
  );
}
