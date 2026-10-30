import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { HomeNoteDto } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";
import { Icon } from "../../components/ui";

/** A page for a family: what is going well and a little to practise. Printed by the teacher, who reads it first. */
export function HomeNotePage() {
  const { t } = useTranslation();
  const { classId, studentId } = useParams();
  const state = useApi<HomeNoteDto>(`/classes/${classId}/students/${studentId}/home-note`);
  return (
    <>
      <Link className="back no-print" to={`/classes/${classId}/students/${studentId}`}>
        <Icon name="back" /> <span>{t("activity.backToClass")}</span>
      </Link>
      <AsyncView state={state}>
        {(n) => (
          <>
            <div className="banner info no-print">
              <Icon name="info" />
              <div>
                <p>{t("homeNote.teacherHelp")}</p>
                <p style={{ marginTop: "var(--s3)" }}>
                  <button className="btn btn-primary" onClick={() => window.print()}>
                    <Icon name="print" /> {t("paper.print")}
                  </button>
                </p>
              </div>
            </div>
            <article style={{ maxWidth: 640, fontSize: "1.25rem", lineHeight: 1.6 }}>
              <h1>{t("homeNote.heading", { name: n.studentFirstName })}</h1>
              <p>
                <small>{n.className}</small>
              </p>
              {n.goingWell.length > 0 && (
                <>
                  <h2>{t("homeNote.goingWell")}</h2>
                  <ul>
                    {n.goingWell.map((g) => (
                      <li key={g}>{g}</li>
                    ))}
                  </ul>
                </>
              )}
              {n.practise.length > 0 && (
                <>
                  <h2>{t("homeNote.practise")}</h2>
                  {n.practise.map((p) => (
                    <div key={p.topic}>
                      <h3>{p.topic}</h3>
                      <ol>
                        {p.tryThese.map((q) => (
                          <li key={q}>{q}</li>
                        ))}
                      </ol>
                    </div>
                  ))}
                </>
              )}
              <p>{n.note}</p>
            </article>
          </>
        )}
      </AsyncView>
    </>
  );
}
