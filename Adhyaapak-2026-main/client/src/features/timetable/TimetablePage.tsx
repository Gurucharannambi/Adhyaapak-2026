import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import { TIMETABLE_SUBJECTS, type PlanPeriod, type TimetableResponse, type TimetableSlotDto } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { Banner, EmptyState, Icon, PageHead } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { ApiRequestError, api } from "../../services/api";

const key = (weekday: number, period: number) => `${weekday}-${period}`;

/**
 * The teacher's week and the lesson plan it produces. The plan is not stored: it is worked out from the timetable and
 * from which lessons have been taught, so it always matches reality (see server modules/timetable/pacing.ts).
 */
export function TimetablePage() {
  const { t } = useTranslation();
  const { classId } = useParams();
  const state = useApi<TimetableResponse>(`/classes/${classId}/timetable`);
  return (
    <AsyncView state={state}>
      {(tt) => (
        <>
          <PageHead
            title={t("timetable.title")}
            lede={t("timetable.lede")}
            eyebrow={tt.className}
            back={
              <Link className="back" to={`/classes/${classId}`}>
                <Icon name="back" /> <span>{t("timetable.back")}</span>
              </Link>
            }
          />
          {tt.bookTitle ? (
            <>
              <p>{t("timetable.progress", { taught: tt.lessonsTaught, total: tt.lessonsTotal, book: tt.bookTitle })}</p>
              <div className="progress" aria-hidden="true" style={{ maxWidth: 420, marginBottom: "var(--s5)" }}>
                <span style={{ width: `${tt.lessonsTotal ? (tt.lessonsTaught / tt.lessonsTotal) * 100 : 0}%` }} />
              </div>
            </>
          ) : (
            <Banner tone="info">
              <p>{t("timetable.noBook", { grade: tt.grade })}</p>
            </Banner>
          )}
          <Plan classId={tt.classId} upcoming={tt.upcoming} today={tt.today} />
          <Week tt={tt} onSaved={state.reload} />
        </>
      )}
    </AsyncView>
  );
}

function Plan({ classId, upcoming, today }: { classId: string; upcoming: PlanPeriod[]; today: string }) {
  const { t } = useTranslation();
  const maths = upcoming.filter((p) => p.subject === "Mathematics");
  const byDate = useMemo(() => {
    const m = new Map<string, PlanPeriod[]>();
    for (const p of maths) m.set(p.date, [...(m.get(p.date) ?? []), p]);
    return [...m.entries()];
  }, [maths]);
  return (
    <section aria-labelledby="plan-h">
      <h2 id="plan-h">{t("timetable.planTitle")}</h2>
      {byDate.length === 0 ? (
        <EmptyState title={t("timetable.noLesson")} />
      ) : (
        byDate.map(([date, periods]) => (
          <div key={date} style={{ marginBottom: "var(--s5)" }}>
            <p className="diary-date">
              {date === today ? `${t("timetable.today")} · ` : ""}
              {new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
            </p>
            <ol className="plain">
              {periods.map((p) => (
                <li key={`${p.date}-${p.period}`} className="q-card">
                  <p className="hint" style={{ margin: 0 }}>
                    {t("timetable.period", { n: p.period })} · {p.startsAt}–{p.endsAt}
                  </p>
                  {p.lesson ? (
                    <>
                      <h3 style={{ margin: "0.25rem 0" }}>{p.lesson.title}</h3>
                      <p className="muted" style={{ margin: 0 }}>{p.lesson.chapterTitle}</p>
                      <div className="btn-row" style={{ marginBottom: 0 }}>
                        <Link className="btn btn-sm" to={`/classes/${classId}/lessons/${p.lesson.conceptId}`}>
                          {t("timetable.open")}
                        </Link>
                        {p.lesson.taught && <span className="chip ok">✓ {t("timetable.taught")}</span>}
                      </div>
                    </>
                  ) : (
                    <p className="muted" style={{ margin: "0.25rem 0 0" }}>{p.noLesson === "book_finished" ? t("timetable.finished") : t("timetable.noLesson")}</p>
                  )}
                </li>
              ))}
            </ol>
          </div>
        ))
      )}
    </section>
  );
}

function Week({ tt, onSaved }: { tt: TimetableResponse; onSaved: () => void }) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  const slots = useMemo(() => new Map(tt.slots.map((s) => [key(s.weekday, s.period), s])), [tt.slots]);
  const periods = [...new Set(tt.slots.map((s) => s.period))].sort((a, b) => a - b);
  const days = [1, 2, 3, 4, 5, 6];
  const subjectAt = (wd: number, p: number) => draft[key(wd, p)] ?? slots.get(key(wd, p))?.subject ?? "";

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      const out: TimetableSlotDto[] = tt.slots.map((s) => ({ ...s, subject: draft[key(s.weekday, s.period)] ?? s.subject }));
      await api(`/classes/${tt.classId}/timetable`, { method: "PUT", body: { slots: out } });
      setEditing(false);
      setDraft({});
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="week-h">
      <h2 id="week-h">{t("timetable.weekTitle")}</h2>
      <p className="pen">{t("timetable.sample")}</p>
      {saved && !editing && (
        <Banner tone="ok">
          <p>{t("timetable.saved")}</p>
        </Banner>
      )}
      {editing && <p className="hint">{t("timetable.editHelp")}</p>}
      <div className="table-wrap">
        <table className="ruled">
          <thead>
            <tr>
              <th scope="col" />
              {days.map((d) => (
                <th key={d} scope="col">{t(`timetable.days.${d}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((p) => {
              const any = slots.get(key(1, p)) ?? tt.slots.find((s) => s.period === p)!;
              return (
                <tr key={p}>
                  <th scope="row">
                    {t("timetable.period", { n: p })}
                    <span className="hint" style={{ display: "block", fontWeight: 400 }}>{any.startsAt}–{any.endsAt}</span>
                  </th>
                  {days.map((d) => {
                    const s = slots.get(key(d, p));
                    if (!s) return <td key={d} />;
                    return (
                      <td key={d}>
                        {editing ? (
                          <select aria-label={t("timetable.cellLabel", { day: t(`timetable.days.${d}`), n: p })} value={subjectAt(d, p)} onChange={(e) => setDraft((x) => ({ ...x, [key(d, p)]: e.target.value }))}>
                            {TIMETABLE_SUBJECTS.map((sub) => (
                              <option key={sub}>{sub}</option>
                            ))}
                          </select>
                        ) : s.subject === "Mathematics" ? (
                          <strong>{s.subject}</strong>
                        ) : (
                          <span className="muted">{s.subject}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {error && (
        <Banner tone="err">
          <p>{error}</p>
        </Banner>
      )}
      <div className="btn-row">
        {editing ? (
          <>
            <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>
              {busy ? t("timetable.saving") : t("timetable.save")}
            </button>
            <button
              className="btn"
              onClick={() => {
                setEditing(false);
                setDraft({});
              }}
            >
              {t("timetable.cancel")}
            </button>
          </>
        ) : (
          <button className="btn" onClick={() => setEditing(true)}>
            {t("timetable.edit")}
          </button>
        )}
      </div>
    </section>
  );
}
