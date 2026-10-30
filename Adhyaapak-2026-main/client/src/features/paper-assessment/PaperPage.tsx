import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { AssessmentDetailDto, PaperAccuracyDto, PaperListResponse } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { Banner, Icon, PageHead } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { ApiRequestError, apiUpload } from "../../services/api";

/** Paper answer sheets for one activity: upload a photo for a student, then open it to review. */
export function PaperPage() {
  const { t } = useTranslation();
  const { assessmentId } = useParams();
  const activity = useApi<AssessmentDetailDto>(`/assessments/${assessmentId}`);
  const sheets = useApi<PaperListResponse>(`/assessments/${assessmentId}/submission-files`);
  const accuracy = useApi<PaperAccuracyDto>("/paper-accuracy");
  const [studentId, setStudentId] = useState("");
  const [file, setFile] = useState<File>();
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!file || !studentId) return;
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const form = new FormData();
      form.append("assessmentId", assessmentId!);
      form.append("studentId", studentId);
      form.append("file", file);
      await apiUpload("/submission-files", form);
      setNotice(t("paper.uploaded"));
      setFile(undefined);
      setStudentId("");
      (e.target as HTMLFormElement).reset();
      sheets.reload();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AsyncView state={activity}>
      {(a) => {
        const taken = new Set((sheets.data?.submissions ?? []).filter((s) => s.status !== "rejected").map((s) => s.studentId));
        const choices = a.students.filter((s) => !s.submitted && !taken.has(s.id));
        const usable = a.status === "open" || a.status === "closed";
        return (
          <>
            <PageHead
              title={t("paper.title")}
              lede={t("paper.intro")}
              back={
                <Link className="back" to={`/activities/${a.id}`}>
                  <Icon name="back" /> <span>{a.title}</span>
                </Link>
              }
            />
            <ul>
              <li>{t("paper.tipPhoto")}</li>
              <li>{t("paper.tipNames")}</li>
              <li>{t("paper.tipPrivate")}</li>
            </ul>
            <p>
              <Link className="btn" to={`/activities/${a.id}/print-sheets`}>{t("paper.printLink")}</Link>
            </p>

            <section aria-labelledby="up-h" className="panel">
              <h2 id="up-h" style={{ marginTop: 0 }}>{t("paper.addPhoto")}</h2>
              {!usable ? (
                <div className="state-empty" role="status"><p>{t("paper.notStarted")}</p></div>
              ) : choices.length === 0 ? (
                <div className="state-empty" role="status"><p>{t("paper.everyoneDone")}</p></div>
              ) : (
                <form onSubmit={(e) => void submit(e)}>
                  <div className="field">
                    <label htmlFor="paper-who">{t("paper.whoseSheet")}</label>
                    <select id="paper-who" value={studentId} onChange={(e) => setStudentId(e.target.value)} required>
                      <option value="" />
                      {choices.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.rosterNumber}. {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="paper-photo">{t("paper.photo")}</label>
                    <input className="input" id="paper-photo" type="file" accept="image/jpeg,image/png" onChange={(e) => setFile(e.target.files?.[0])} required />
                  </div>
                  <div className="btn-row">
                    <button className="btn btn-primary" type="submit" disabled={busy || !file || !studentId}>
                      {busy ? t("paper.uploading") : t("paper.upload")}
                    </button>
                  </div>
                </form>
              )}
              {notice && <Banner tone="ok"><p>{notice}</p></Banner>}
              {error && <Banner tone="err"><p>{error}</p></Banner>}
            </section>

            <section aria-labelledby="list-h">
              <h2 id="list-h">{t("paper.sheets")}</h2>
              <AsyncView state={sheets}>
                {(list) =>
                  list.submissions.length === 0 ? (
                    <div className="state-empty"><p>{t("paper.noSheets")}</p></div>
                  ) : (
                    <ul className="plain rule-list">
                      {list.submissions.map((s) => (
                        <li key={s.id}>
                          {s.rosterNumber}. {s.studentName} — <strong>{t(`paper.status.${s.status}`)}</strong>
                          {!s.imageAvailable && <small> ({t("paper.photoDeleted")})</small>}{" "}
                          <Link to={`/paper/${s.id}`}>{s.status === "uploaded" || s.status === "needs_review" ? t("paper.review") : t("paper.view")} →</Link>
                        </li>
                      ))}
                    </ul>
                  )
                }
              </AsyncView>
            </section>

            {accuracy.data && accuracy.data.answersReviewed > 0 && (
              <p className="pen">
                {t("paper.accuracy", { answers: accuracy.data.answersReviewed, sheets: accuracy.data.sheetsReviewed, changed: accuracy.data.answersCorrectedByTeacher })}
              </p>
            )}
          </>
        );
      }}
    </AsyncView>
  );
}
