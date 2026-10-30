import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { AssessmentSummaryDto, ClassDto, CoverageResponse, ImportRosterResponse, StudentDto, TimetableResponse } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";
import { ApiRequestError, api } from "../../services/api";
import { Banner, EmptyState, Icon, MarginNote } from "../../components/ui";

export function ClassPage() {
  const { t } = useTranslation();
  const { classId } = useParams();
  const cls = useApi<ClassDto>(`/classes/${classId}`);
  const roster = useApi<{ students: StudentDto[] }>(`/classes/${classId}/students`);

  const refresh = () => {
    cls.reload();
    roster.reload();
  };

  return (
    <>
      <Link className="back" to="/">
        <Icon name="back" /> <span>{t("nav.dashboard")}</span>
      </Link>
      <AsyncView state={cls}>
        {(c) => (
          <>
            <div className="row between" style={{ alignItems: "flex-start" }}>
              <div className="page-head">
                <h1>{c.name}</h1>
                <p className="lede">{t("dashboard.classMeta", { grade: c.grade, year: c.academicYear, count: c.studentCount })}</p>
              </div>
              <div className="slip code">
                <div className="hint">{t("classPage.joinCode")}</div>
                <strong className="joincode">{c.joinCode}</strong>
                <MarginNote>{t("classPage.joinCodeHelp")}</MarginNote>
              </div>
            </div>
            <PortalToggle classId={classId!} enabled={c.portalEnabled} onChanged={refresh} />
          </>
        )}
      </AsyncView>

      <NextLesson classId={classId!} />

      <ul className="jump no-print">
        <li><a href="#cov-h">{t("coverage.title")}</a></li>
        <li><a href="#act-h">{t("activity.sectionTitle")}</a></li>
        <li><a href="#roster-h">{t("classPage.roster")}</a></li>
      </ul>

      <CoveragePanel classId={classId!} />

      <ActivitiesPanel classId={classId!} />

      <h2 id="roster-h">{t("classPage.roster")}</h2>
      <AsyncView state={roster}>
        {(r) =>
          r.students.length === 0 ? (
            <EmptyState title={t("classPage.emptyRoster")} />
          ) : (
            <div className="table-wrap"><table className="ruled">
              <thead>
                <tr>
                  <th scope="col" className="num">{t("classPage.rosterNumber")}</th>
                  <th scope="col">{t("classPage.name")}</th>
                  <th scope="col">{t("classPage.referenceId")}</th>
                  <th scope="col">
                    <span className="sr-only">{t("classPage.actions")}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {r.students.map((s) => (
                  <tr key={s.id}>
                    <td className="num">{s.rosterNumber}</td>
                    <td>
                      <Link to={`/classes/${classId}/students/${s.id}`}>{s.name}</Link>
                    </td>
                    <td>{s.referenceId ?? "—"}</td>
                    <td>
                      <button className="btn btn-sm"
                        onClick={async () => {
                          await api(`/classes/${classId}/students/${s.id}`, { method: "DELETE" });
                          refresh();
                        }}
                      >
                        {t("classPage.withdraw")}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )
        }
      </AsyncView>

      <AddStudentForm classId={classId!} onAdded={refresh} />
      <ImportPanel classId={classId!} onImported={refresh} />
    </>
  );
}

/** The first Mathematics lesson the timetable has planned that has not been taught: what to teach next. */
function NextLesson({ classId }: { classId: string }) {
  const { t } = useTranslation();
  const state = useApi<TimetableResponse>(`/classes/${classId}/timetable`);
  if (!state.data) return null;
  const next = state.data.upcoming.find((p) => p.lesson && !p.lesson.taught);
  return (
    <section className="panel" aria-labelledby="next-h" style={{ marginTop: 0 }}>
      <h2 id="next-h" style={{ marginTop: 0, fontSize: "var(--fs-m)" }}>{t("classPage.nextLesson")}</h2>
      {next?.lesson ? (
        <>
          <p style={{ marginBottom: "var(--s1)" }}><strong>{next.lesson.title}</strong></p>
          <p className="hint">
            {t("classPage.nextLessonWhen", { day: new Date(`${next.date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }), n: next.period })} · {next.lesson.chapterTitle}
          </p>
        </>
      ) : (
        <p>{t("classPage.nextLessonNone")}</p>
      )}
      <div className="btn-row" style={{ marginBottom: 0 }}>
        {next?.lesson && (
          <Link className="btn btn-primary btn-sm" to={`/classes/${classId}/lessons/${next.lesson.conceptId}`}>
            {t("dashboard.openLesson")}
          </Link>
        )}
        <Link className="btn btn-sm" to={`/classes/${classId}/timetable`}>{t("classPage.timetableLink")}</Link>
      </div>
    </section>
  );
}

function CoveragePanel({ classId }: { classId: string }) {
  const { t } = useTranslation();
  const state = useApi<CoverageResponse>(`/classes/${classId}/coverage`);
  return (
    <section aria-labelledby="cov-h">
      <h2 id="cov-h">{t("coverage.title")}</h2>
      <AsyncView state={state}>
        {(c) => (
          <>
            <p>{t("coverage.summary", { done: c.taughtCount, total: c.total })}</p>
            <ul className="coverage">
              {c.concepts.map((x) => (
                <li key={x.id}>
                  <span className={x.taughtAt ? "tick on" : "tick"} aria-hidden="true">{x.taughtAt ? "✓" : ""}</span> <Link to={`/classes/${classId}/lessons/${x.id}`}>{x.title}</Link>{" "}
                  <small>
                    ({x.taughtAt ? t("coverage.taught") : t("coverage.notYet")}, {t("coverage.answered", { count: x.studentsWithEvidence })})
                  </small>
                </li>
              ))}
            </ul>
          </>
        )}
      </AsyncView>
    </section>
  );
}

function ActivitiesPanel({ classId }: { classId: string }) {
  const { t } = useTranslation();
  const state = useApi<{ assessments: AssessmentSummaryDto[] }>(`/classes/${classId}/assessments`);
  return (
    <section aria-labelledby="act-h">
      <h2 id="act-h">{t("activity.sectionTitle")}</h2>
      <div className="btn-row">
        <Link className="btn btn-primary" to={`/classes/${classId}/activities/new`}>{t("activity.new")}</Link>
        <Link className="btn" to={`/classes/${classId}/map`}>{t("map.open")}</Link>
        <Link className="btn" to={`/classes/${classId}/branch-board`}>{t("board.open")}</Link>
        <Link className="btn" to={`/classes/${classId}/brief`}>{t("classPage.briefLink")}</Link>
      </div>
      <AsyncView state={state}>
        {(d) =>
          d.assessments.length === 0 ? (
            <EmptyState title={t("activity.none")} />
          ) : (
            <ul className="plain rule-list">
              {d.assessments.map((a) => (
                <li key={a.id}>
                  <Link to={`/activities/${a.id}`}>{a.title}</Link> — {t(`activity.status.${a.status}`)}, {t("activity.submittedOf", { done: a.submittedCount })}
                </li>
              ))}
            </ul>
          )
        }
      </AsyncView>
    </section>
  );
}

function AddStudentForm({ classId, onAdded }: { classId: string; onAdded: () => void }) {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  const [referenceId, setReferenceId] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api(`/classes/${classId}/students`, { method: "POST", body: { name, ...(referenceId.trim() ? { referenceId } : {}) } });
      setName("");
      setReferenceId("");
      onAdded();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="add-student-h">
      <h2 id="add-student-h">{t("classPage.addStudent")}</h2>
      <form onSubmit={submit}>
        <div className="grid-2" style={{ maxWidth: "46rem" }}>
          <div className="field">
            <label htmlFor="stu-name">{t("classPage.name")}</label>
            <input className="input" id="stu-name" value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="stu-ref">{t("classPage.referenceIdOptional")}</label>
            <input className="input" id="stu-ref" value={referenceId} onChange={(e) => setReferenceId(e.target.value)} />
          </div>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {t("classPage.add")}
          </button>
        </div>
      </form>
      {error && <Banner tone="err"><p>{error}</p></Banner>}
    </section>
  );
}

function ImportPanel({ classId, onImported }: { classId: string; onImported: () => void }) {
  const { t } = useTranslation();
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<ImportRosterResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<ImportRosterResponse>(`/classes/${classId}/enrolments/import`, { method: "POST", body: { csv, dryRun } });
      setResult(r);
      if (r.committed) {
        setCsv("");
        onImported();
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="import-h">
      <h2 id="import-h">{t("classPage.importTitle")}</h2>
      <p>{t("classPage.importHelp")}</p>
      <div className="field">
        <label htmlFor="imp-file">{t("classPage.chooseFile")}</label>
        <input
          id="imp-file"
          className="input"
          type="file"
          accept=".csv,text/csv"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              setCsv(await f.text());
              setResult(undefined);
            }
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="imp-csv">{t("classPage.orPaste")}</label>
        <textarea
          id="imp-csv"
          rows={6}
          style={{ fontFamily: "var(--f-mono)" }}
          value={csv}
          onChange={(e) => {
            setCsv(e.target.value);
            setResult(undefined);
          }}
          placeholder={"name,reference_id,roster_number\nRavi Kumar,A-101,\nMeera Shah,A-102,"}
        />
      </div>
      <div className="btn-row">
        <button className="btn" disabled={busy || !csv.trim()} onClick={() => void run(true)}>
          {t("classPage.preview")}
        </button>
        <button className="btn btn-primary" disabled={busy || !csv.trim() || !result || result.errorCount > 0 || result.committed} onClick={() => void run(false)}>
          {t("classPage.importNow")}
        </button>
      </div>
      {error && <Banner tone="err"><p>{error}</p></Banner>}
      {result && (
        <div aria-live="polite">
          <p>
            {result.committed
              ? t("classPage.imported", { count: result.okCount })
              : result.errorCount > 0
                ? t("classPage.importBlocked", { count: result.errorCount })
                : t("classPage.previewOk", { count: result.okCount })}
          </p>
          <div className="table-wrap"><table className="ruled">
            <thead>
              <tr>
                <th scope="col">{t("classPage.line")}</th>
                <th scope="col">{t("classPage.name")}</th>
                <th scope="col">{t("classPage.rosterNumber")}</th>
                <th scope="col">{t("classPage.status")}</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row) => (
                <tr key={row.line}>
                  <td>{row.line}</td>
                  <td>{row.name}</td>
                  <td>{row.rosterNumber ?? "—"}</td>
                  {/* Text + symbol, not colour alone. */}
                  <td>{row.status === "ok" ? `✓ ${t("classPage.ok")}` : `✗ ${row.message}`}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}
    </section>
  );
}

function PortalToggle({ classId, enabled, onChanged }: { classId: string; enabled: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <div className="choice">
        <input
          id="portal-toggle"
          type="checkbox"
          checked={enabled}
          disabled={busy}
          onChange={(e) => {
            setBusy(true);
            void api(`/classes/${classId}`, { method: "PATCH", body: { portalEnabled: e.target.checked } })
              .then(onChanged)
              .finally(() => setBusy(false));
          }}
        />
        <label htmlFor="portal-toggle">
          {t("classPage.portal")}
          <span className="hint" style={{ display: "block" }}>{t("classPage.portalHelp")}</span>
        </label>
    </div>
  );
}
