import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { HintResponse, PracticeResultResponse, PracticeSetResponse } from "@adhyaapak/shared";
import { ApiRequestError, api } from "../../services/api";
import { Banner, Icon } from "../../components/ui";
import { StudentShell } from "../../components/StudentShell";

/**
 * Short practice with a hint ladder. Answers are only revealed after the whole set is submitted. Asking for
 * hints is always allowed: it is recorded as lighter evidence, never counted against the student.
 */
export function PracticePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const conceptId = params.get("conceptId") ?? "";
  const mode = params.get("mode") ?? "guided";

  const [set, setSet] = useState<PracticeSetResponse>();
  const [error, setError] = useState<string>();
  const [choice, setChoice] = useState<Record<string, string>>({});
  const [hints, setHints] = useState<Record<string, HintResponse[]>>({});
  const [result, setResult] = useState<PracticeResultResponse>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<PracticeSetResponse>(`/student/practice?conceptId=${encodeURIComponent(conceptId)}&mode=${encodeURIComponent(mode)}`)
      .then((s) => !cancelled && setSet(s))
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiRequestError && e.code === "unauthenticated") return void navigate("/join", { replace: true });
        setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
      });
    return () => {
      cancelled = true;
    };
  }, [conceptId, mode, navigate, t]);

  async function askHint(questionId: string) {
    const level = (hints[questionId]?.length ?? 0) + 1;
    if (level > 3) return;
    try {
      const h = await api<HintResponse>(`/student/practice/${set!.setId}/hint?questionId=${questionId}&level=${level}`);
      setHints((all) => ({ ...all, [questionId]: [...(all[questionId] ?? []), h] }));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    }
  }

  async function submit() {
    if (!set) return;
    setBusy(true);
    setError(undefined);
    try {
      const answers = set.questions.map((q) => ({ questionId: q.id, optionId: choice[q.id] ?? null, hintLevel: hints[q.id]?.length ?? 0 }));
      setResult(await api<PracticeResultResponse>(`/student/practice/${set.setId}/submit`, { method: "POST", body: { answers } }));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StudentShell>
      <Link className="back no-print" to="/learn">
        <Icon name="back" /> <span>{t("learn.back")}</span>
      </Link>
      {error && (
        <Banner tone="err">
          <p>{error}</p>
        </Banner>
      )}
      {!set && !error && (
        <p className="state-loading" role="status">
          {t("common.loading")}
        </p>
      )}
      {set && (
        <>
          <h1>{set.title}</h1>
          <p className="no-print">
            <button className="btn" onClick={() => window.print()}>{t("learn.printPractice")}</button>
          </p>
          {set.questions.map((q, i) => {
            const r = result?.results.find((x) => x.questionId === q.id);
            return (
              <fieldset key={q.id} className="s-q">
                <legend>
                  {i + 1}. {q.stem}
                </legend>
                {q.options.map((o, k) => (
                  <label key={o.id} className={r && o.id === r.correctOptionId ? "opt-btn right" : "opt-btn"}>
                    <input type="radio" name={`q-${q.id}`} disabled={!!result} checked={choice[q.id] === o.id} onChange={() => setChoice((c) => ({ ...c, [q.id]: o.id }))} /> {"ABCDEFGH"[k]}. {o.text}
                    {r && o.id === r.correctOptionId && <strong> ✓</strong>}
                  </label>
                ))}
                {!result && (
                  <p className="no-print">
                    {(hints[q.id]?.length ?? 0) < 3 && <button className="btn" onClick={() => void askHint(q.id)}>{(hints[q.id]?.length ?? 0) === 0 ? t("learn.hint") : t("learn.moreHelp")}</button>}
                    {(hints[q.id] ?? []).map((h) => (
                      <span key={h.level} className="hint-slip" style={{ display: "block" }}>
                        {h.text}
                      </span>
                    ))}
                  </p>
                )}
                {r && (
                  <p>
                    {r.correct === true ? t("learn.gotIt") : r.correct === false ? t("learn.tryAgainLater") : t("learn.noAnswer")}
                    {r.explanation && <span> {r.explanation}</span>}
                  </p>
                )}
              </fieldset>
            );
          })}
          {!result ? (
            <p className="no-print">
              <button className="btn btn-primary btn-block" onClick={() => void submit()} disabled={busy}>
                {busy ? t("common.loading") : t("learn.finish")}
              </button>
            </p>
          ) : (
            <>
              <Banner tone="ok">
                <p>
                  <strong>{result.message}</strong>
                </p>
              </Banner>
              <p className="no-print">
                <Link className="btn" to="/learn">
                  {t("learn.back")}
                </Link>
              </p>
            </>
          )}
        </>
      )}
    </StudentShell>
  );
}
