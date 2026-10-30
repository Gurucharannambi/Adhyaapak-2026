import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { AssessmentDetailDto } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { Icon, PageHead } from "../../components/ui";
import { useApi } from "../../hooks/useApi";

const LETTERS = "ABCDEFGH";

/**
 * Printable answer sheets, one per student, with a box for each answer. A boxed single letter is
 * far easier to read from a photo than free handwriting. Sheets carry the roll number, not the
 * name, because the photo is sent to an AI service to be read.
 */
export function PrintSheetsPage() {
  const { t } = useTranslation();
  const { assessmentId } = useParams();
  const state = useApi<AssessmentDetailDto>(`/assessments/${assessmentId}`);
  return (
    <AsyncView state={state}>
      {(a) => {
        const students = a.students.filter((s) => !s.submitted);
        return (
          <>
            <div className="no-print">
              <PageHead
                title={t("paper.printTitle")}
                lede={t("paper.printIntro", { count: students.length })}
                back={
                  <Link className="back" to={`/activities/${a.id}/paper`}>
                    <Icon name="back" /> <span>{t("paper.title")}</span>
                  </Link>
                }
              />
              <div className="btn-row">
                <button className="btn btn-primary" onClick={() => window.print()} disabled={students.length === 0}>
                  <Icon name="print" /> {t("paper.print")}
                </button>
              </div>
              {students.length === 0 && (
                <p className="state-empty" role="status">
                  {t("paper.everyoneDone")}
                </p>
              )}
            </div>
            {students.map((s) => (
              <section key={s.id} className="print-sheet" aria-label={t("paper.rollNo", { n: s.rosterNumber })} style={{ border: "1px solid var(--rule)", padding: "var(--s5)", marginBottom: "var(--s5)", background: "#fff" }}>
                <div className="sheet-head">
                  <p style={{ margin: 0 }}>{a.title}</p>
                  <p className="roll-big" style={{ margin: "var(--s2) 0" }}>
                    {t("paper.rollNo", { n: s.rosterNumber })}
                  </p>
                  <p style={{ margin: 0 }}>{t("paper.sheetRule")}</p>
                </div>
                {a.questions.map((q, i) => (
                  <div key={q.id} className="qrow">
                    <div>
                      <strong>{i + 1}.</strong> {q.stem}
                      <div className="qopts">
                        {q.options.map((o, k) => (
                          <span key={o.id}>
                            {LETTERS[k]}) {o.text}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="answer-box" aria-hidden="true" />
                  </div>
                ))}
              </section>
            ))}
          </>
        );
      }}
    </AsyncView>
  );
}

