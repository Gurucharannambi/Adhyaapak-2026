import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import type { StudentHistoryResponse } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";
import { ApiRequestError, api } from "../../services/api";
import { Banner, EmptyState, Icon, MarginNote, StatusMark } from "../../components/ui";

/** A student's learning story for the teacher: current status per concept, and what has happened, from stored records. */
export function StudentPage() {
  const { t } = useTranslation();
  const { classId, studentId } = useParams();
  const state = useApi<StudentHistoryResponse>(`/classes/${classId}/students/${studentId}/history`);
  return (
    <>
      <Link className="back" to={`/classes/${classId}`}>
        <Icon name="back" /> <span>{t("activity.backToClass")}</span>
      </Link>
      <AsyncView state={state}>
        {(h) => (
          <>
            <h1>
              {h.student.rosterNumber}. {h.student.name}
            </h1>
            <MarginNote>{t("student.note")}</MarginNote>
            <p>
              <Link className="btn" to={`/classes/${classId}/students/${studentId}/home-note`}>{t("classPage.homeNote")}</Link>
            </p>

            <h2>{t("student.where")}</h2>
            {h.mastery.length === 0 ? (
              <EmptyState title={t("student.noEvidence")} />
            ) : (
              <ul className="plain rule-list">
                {h.mastery.map((m) => (
                  <li key={m.conceptId} className="row between">
                    <Link to={`/curriculum/concepts/${m.conceptId}`}>{m.title}</Link>
                    <span>
                      <StatusMark status={m.status} />
                      {m.evidenceCount > 0 && <span className="hint"> ({t("map.items", { count: m.evidenceCount })})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}

            <h2>{t("student.history")}</h2>
            {h.timeline.length === 0 ? (
              <EmptyState title={t("student.nothingYet")} />
            ) : (
              <ol reversed className="rule-list" style={{ paddingLeft: "1.5rem" }}>
                {h.timeline.map((e, i) => (
                  <li key={i}>
                    <span className="hint">{new Date(e.at).toLocaleString()}</span>
                    <br />
                    {e.link?.type === "activity" ? <Link to={`/activities/${e.link.id}`}>{e.text}</Link> : e.text}
                  </li>
                ))}
              </ol>
            )}

            <RecordTools classId={classId!} studentId={studentId!} name={h.student.name} rosterNumber={h.student.rosterNumber} onChanged={state.reload} />
          </>
        )}
      </AsyncView>
    </>
  );
}

/** Fixing a mistake in a student's record, and removing their personal details when they leave. */
export function RecordTools({ classId, studentId, name, rosterNumber, onChanged }: { classId: string; studentId: string; name: string; rosterNumber: number; onChanged: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [newName, setNewName] = useState(name);
  const [roll, setRoll] = useState(String(rosterNumber));
  const [confirmText, setConfirmText] = useState("");
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function correct(e: FormEvent) {
    e.preventDefault();
    setError(undefined);
    setNotice(undefined);
    try {
      await api(`/classes/${classId}/students/${studentId}`, { method: "PATCH", body: { name: newName, rosterNumber: Number(roll) } });
      setNotice(t("record.saved"));
      onChanged();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("common.unexpectedError"));
    }
  }

  async function erase() {
    setError(undefined);
    try {
      await api(`/classes/${classId}/students/${studentId}/erase`, { method: "POST", body: { confirm: "erase" } });
      navigate(`/classes/${classId}`);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : t("common.unexpectedError"));
    }
  }

  return (
    <section aria-labelledby="rec-h" style={{ borderTop: "2px solid var(--ink)", marginTop: "var(--s7)" }}>
      <h2 id="rec-h">{t("record.title")}</h2>
      <form onSubmit={(e) => void correct(e)}>
        <div className="grid-2" style={{ maxWidth: "46rem" }}>
          <div className="field">
            <label htmlFor="rec-name">{t("record.name")}</label>
            <input className="input" id="rec-name" value={newName} onChange={(e) => setNewName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="rec-roll">{t("offline.roll")}</label>
            <input className="input" id="rec-roll" value={roll} onChange={(e) => setRoll(e.target.value.replace(/\D/g, ""))} inputMode="numeric" required />
          </div>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" type="submit">{t("record.correct")}</button>
        </div>
      </form>
      <div className="panel" style={{ background: "#f7f9fd" }}>
        <h3 style={{ marginTop: 0 }}>{t("record.eraseTitle")}</h3>
        <p className="muted">{t("record.eraseHelp")}</p>
        <div className="field">
          <label htmlFor="rec-confirm">{t("record.eraseConfirm")}</label>
          <input className="input" id="rec-confirm" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} autoComplete="off" />
        </div>
        <button className="btn btn-danger" disabled={confirmText.trim().toLowerCase() !== "erase"} onClick={() => void erase()}>
          {t("record.erase")}
        </button>
      </div>
      {notice && <Banner tone="ok"><p>{notice}</p></Banner>}
      {error && <Banner tone="err"><p>{error}</p></Banner>}
    </section>
  );
}
