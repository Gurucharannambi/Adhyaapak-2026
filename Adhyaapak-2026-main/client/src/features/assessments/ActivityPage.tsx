import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { AssessmentDetailDto } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";
import { ApiRequestError, api } from "../../services/api";
import { Banner, Chip, Icon } from "../../components/ui";
import { FastEntryGrid } from "./FastEntryGrid";

const NEXT = { draft: "approved", approved: "open", open: "closed" } as const;

export function ActivityPage() {
  const { t } = useTranslation();
  const { assessmentId } = useParams();
  // While students are answering, refresh progress every few seconds.
  const state = useApi<AssessmentDetailDto>(`/assessments/${assessmentId}`, { refreshMs: 4000 });
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function advance(to: "approved" | "open" | "closed") {
    setBusy(true);
    setError(undefined);
    try {
      await api(`/assessments/${assessmentId}/status`, { method: "POST", body: { to } });
      state.reload();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AsyncView state={state}>
      {(d) => {
        const next = NEXT[d.status as keyof typeof NEXT];
        const submitted = d.students.filter((s) => s.submitted).length;
        return (
          <>
            <div className="page-head">
              <Link className="back" to={`/classes/${d.classId}`}>
                <Icon name="back" /> <span>{t("activity.backToClass")}</span>
              </Link>
              <h1>{d.title}</h1>
              <p className="lede">
                {t(`activity.mode.${d.type}`)} · <strong>{t(`activity.status.${d.status}`)}</strong>
              </p>
              <ol className="life" aria-label={t("activity.sectionTitle")}>
                {(["draft", "approved", "open", "closed"] as const).map((st, i, all) => (
                  <li key={st} aria-current={d.status === st ? "step" : undefined} className={all.indexOf(d.status as (typeof all)[number]) > i ? "done" : undefined}>
                    {t(`activity.status.${st}`)}
                  </li>
                ))}
              </ol>
            </div>

            {next && (
              <div className="btn-row">
                <button className="btn btn-primary" disabled={busy} onClick={() => void advance(next)}>
                  {t(`activity.action.${next}`)}
                </button>
              </div>
            )}
            {error && <Banner tone="err"><p>{error}</p></Banner>}

            {d.status === "open" && (
              <section aria-labelledby="join-h" className="slip code joinpanel">
                <h2 id="join-h" style={{ marginTop: 0 }}>{t("activity.studentsJoin")}</h2>
                <p className="go">
                  {t("activity.goTo")} <strong>{window.location.origin}/join</strong>
                </p>
                <p className="joincode">{d.classJoinCode}</p>
                <p>{t("activity.thenNumber")}</p>
              </section>
            )}

            <section aria-labelledby="prog-h">
              <h2 id="prog-h">{t("activity.progress", { done: submitted, total: d.students.length })}</h2>
              <div className="progress" aria-hidden="true">
                <span style={{ width: `${d.students.length ? (submitted / d.students.length) * 100 : 0}%` }} />
              </div>
              <ul className="roll-cols" style={{ marginTop: "var(--s3)" }}>
                {d.students.map((s) => (
                  <li key={s.id}>
                    <span className={s.submitted ? "tick on" : "tick"} aria-hidden="true">{s.submitted ? "✓" : ""}</span> {s.rosterNumber}. {s.name} <small>({s.submitted ? t("activity.done") : t("activity.waiting")})</small>
                  </li>
                ))}
              </ul>
            </section>

            <section aria-labelledby="res-h">
              <h2 id="res-h">{t("activity.questions")}</h2>
              {d.questions.map((q, i) => {
                const tally = d.tallies.find((x) => x.questionId === q.id);
                return (
                  <article key={q.id} className="q-card">
                    <h4>
                      Q{i + 1}. {q.stem}
                    </h4>
                    <p className="hint">{q.conceptTitle}</p>
                    <ul className="plain">
                      {q.options.map((o) => {
                        const c = tally?.options.find((x) => x.optionId === o.id);
                        return (
                          <li key={o.id} className={o.id === q.correctOptionId ? "opt correct" : "opt"} style={{ flexWrap: "wrap" }}>
                            {o.id.toUpperCase()}. {o.text}
                            {o.id === q.correctOptionId && <strong> ✓</strong>} — {t("activity.chose", { count: c?.count ?? 0 })}
                            {c?.misconception && c.count > 0 && <small> ({c.misconception})</small>}
                          </li>
                        );
                      })}
                    </ul>
                    {(tally?.insufficient ?? 0) > 0 && <small>{t("activity.noEvidence", { count: tally!.insufficient })}</small>}
                  </article>
                );
              })}
            </section>

            {(d.status === "open" || d.status === "closed") && (
              <p>
                <Link className="btn" to={`/activities/${d.id}/paper`}>{t("paper.fromActivity")} →</Link>
              </p>
            )}

            {d.status !== "draft" && d.status !== "approved" && <FastEntryGrid detail={d} onSaved={state.reload} />}

            <p style={{ marginTop: "var(--s5)" }}>
              <Link className="btn" to={`/classes/${d.classId}/map?activity=${d.id}`}>{t("activity.seeMap")} →</Link>
            </p>
          </>
        );
      }}
    </AsyncView>
  );
}
