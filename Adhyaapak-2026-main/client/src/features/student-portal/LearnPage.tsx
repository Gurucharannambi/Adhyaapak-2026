import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import type { MasteryStatus, StudentHomeResponse } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { StudentShell } from "../../components/StudentShell";
import { StatusGlyph } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { ApiRequestError, api } from "../../services/api";

/** The student words reuse the teacher's five shapes, so the picture is the same but the words are friendly. */
const WORD_SHAPE: Record<string, MasteryStatus> = {
  just_starting: "not_enough_evidence",
  keep_practising: "needs_foundation",
  getting_there: "developing",
  going_well: "likely_secure",
  ready_for_more: "ready_for_challenge",
};

/**
 * A student's home: one next step with a reason in plain words, their own progress in friendly words,
 * and things worth a quick look again. No scores, no ranks, no other students.
 */
export function LearnPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const state = useApi<StudentHomeResponse>("/student/home");

  if (state.error instanceof ApiRequestError && state.error.code === "unauthenticated") {
    navigate("/join", { replace: true });
    return null;
  }

  async function leave() {
    await api("/student/leave", { method: "POST" }).catch(() => undefined);
    navigate("/join", { replace: true });
  }

  return (
    <StudentShell>
      <AsyncView state={state}>
        {(h) => (
          <>
            <h1>{t("learn.hello", { name: h.studentName })}</h1>

            {h.activityOpen && (
              <div className="notice-big" role="status">
                <strong>{t("learn.activityWaiting")}</strong>{" "}
                <Link className="btn btn-primary" to="/play">
                  {t("learn.openActivity")}
                </Link>
              </div>
            )}

            {h.next === null ? (
              <div className="s-card">
                <p>{t("learn.practiceOff")}</p>
              </div>
            ) : (
              <section aria-labelledby="next-h" className="s-card next">
                <h2 id="next-h">{t("learn.nextStep")}</h2>
                <p>
                  <strong>{h.next.title}</strong>
                </p>
                <p>{h.next.why}</p>
                {h.next.minutes && <p className="muted">{t("learn.minutes", { count: h.next.minutes })}</p>}
                {h.next.conceptId && h.next.mode && (
                  <Link className="btn btn-primary btn-block" to={`/learn/practice?conceptId=${h.next.conceptId}&mode=${h.next.mode}`}>
                    {t("learn.start")} →
                  </Link>
                )}
              </section>
            )}

            {h.progress.length > 0 && (
              <section aria-labelledby="prog-h">
                <h2 id="prog-h">{t("learn.progress")}</h2>
                <ul className="plain">
                  {h.progress.map((p) => (
                    <li key={p.conceptId} className="prog-word">
                      <span className="mark">
                        <StatusGlyph status={WORD_SHAPE[p.word] ?? "not_enough_evidence"} />
                        <strong>{t(`learn.word.${p.word}`)}</strong>
                      </span>
                      <span>{p.title}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {h.revisit.length > 0 && (
              <section aria-labelledby="rev-h">
                <h2 id="rev-h">{t("learn.revisit")}</h2>
                <ul className="plain rule-list">
                  {h.revisit.map((r) => (
                    <li key={r.conceptId}>
                      <Link to={`/learn/practice?conceptId=${r.conceptId}&mode=revisit`}>{r.title}</Link>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p style={{ marginTop: "2rem" }}>
              <button className="btn" onClick={() => void leave()}>
                {t("learn.leave")}
              </button>
            </p>
          </>
        )}
      </AsyncView>
    </StudentShell>
  );
}
