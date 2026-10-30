import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import type { AssessmentSummaryDto, ClassMisconceptionsResponse, EvidenceDrilldown, LearningMapResponse, MasteryStatus } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";
import { ApiRequestError, api } from "../../services/api";
import { Banner, Icon, MarginNote, PageHead, StatusMark } from "../../components/ui";

const ORDER: MasteryStatus[] = ["needs_foundation", "developing", "not_enough_evidence", "likely_secure", "ready_for_challenge"];

export function LearningMapPage() {
  const { t } = useTranslation();
  const { classId } = useParams();
  const [params, setParams] = useSearchParams();
  const activity = params.get("activity") ?? "";
  const [sortByNeed, setSortByNeed] = useState(true);
  const [selected, setSelected] = useState<{ studentId: string; conceptId: string }>();

  const list = useApi<{ assessments: AssessmentSummaryDto[] }>(`/classes/${classId}/assessments`);
  const map = useApi<LearningMapResponse>(`/classes/${classId}/learning-map${activity ? `?assessmentId=${activity}` : ""}`);
  const patterns = useApi<ClassMisconceptionsResponse>(`/classes/${classId}/misconceptions`);

  return (
    <>
      <PageHead
        title={t("map.title")}
        back={
          <Link className="back" to={`/classes/${classId}`}>
            <Icon name="back" /> <span>{t("activity.backToClass")}</span>
          </Link>
        }
      />

      <div className="field">
        <label htmlFor="map-showing">{t("map.showing")}</label>
        <select id="map-showing" value={activity} onChange={(e) => (e.target.value ? setParams({ activity: e.target.value }) : setParams({}))}>
          <option value="">{t("map.allAssessed")}</option>
          {list.data?.assessments.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title} ({t(`activity.status.${a.status}`)})
            </option>
          ))}
        </select>
      </div>
      <div className="choice">
        <input id="map-sort" type="checkbox" checked={sortByNeed} onChange={(e) => setSortByNeed(e.target.checked)} />
        <label htmlFor="map-sort">{t("map.sortByNeed")}</label>
      </div>

      <AsyncView state={map}>
        {(m) => {
          if (m.concepts.length === 0)
            return (
              <div className="state-empty">
                <p>{t("map.empty")}</p>
              </div>
            );
          const first = m.concepts[0]!.id;
          const rank = (s: LearningMapResponse["students"][number]) => ORDER.indexOf(s.cells[first]!.status);
          const students = sortByNeed ? [...m.students].sort((a, b) => rank(a) - rank(b) || a.rosterNumber - b.rosterNumber) : m.students;
          return (
            <>
              <ul className="legend" aria-label={t("map.legendLabel", { defaultValue: "Key to the marks" })}>
                {(["not_enough_evidence", "needs_foundation", "developing", "likely_secure", "ready_for_challenge"] as MasteryStatus[]).map((st) => (
                  <li key={st}>
                    <StatusMark status={st} />
                  </li>
                ))}
                <li>⚑ {t("map.legendFlag", { defaultValue: "a repeated error pattern was seen" })}</li>
              </ul>
              <p className="hint">{t("map.legendSelect", { defaultValue: "Select a cell to see the evidence." })}</p>
              <div className="register-wrap">
              <table className="register">
                <thead>
                  <tr>
                    <th scope="col">{t("classPage.name")}</th>
                    {m.concepts.map((c) => (
                      <th key={c.id} scope="col">
                        {c.title}
                        <span className="sum">
                          {ORDER.filter((s) => c.counts[s] > 0)
                            .map((s) => `${c.counts[s]} ${t(`status.${s}`).toLowerCase()}`)
                            .join(" · ")}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.id}>
                      <th scope="row">
                        {s.rosterNumber}. <Link to={`/classes/${classId}/students/${s.id}`}>{s.name}</Link>
                      </th>
                      {m.concepts.map((c) => {
                        const cell = s.cells[c.id]!;
                        const isSel = selected?.studentId === s.id && selected.conceptId === c.id;
                        return (
                          <td key={c.id}>
                            <button className={cell.status === "not_enough_evidence" ? "cell quiet" : "cell"} aria-pressed={isSel} onClick={() => setSelected({ studentId: s.id, conceptId: c.id })}>
                              <StatusMark status={cell.status} />
                              {cell.evidenceCount > 0 && <span className="meta">({t("map.items", { count: cell.evidenceCount })})</span>}
                              {cell.pattern && <span className="flag">⚑ {cell.pattern}</span>}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </>
          );
        }}
      </AsyncView>

      {selected && <WhyPanel classId={classId!} {...selected} onClose={() => setSelected(undefined)} />}

      <section aria-labelledby="pat-h">
        <h2 id="pat-h">{t("map.patterns")}</h2>
        <AsyncView state={patterns}>
          {(p) =>
            p.patterns.length === 0 ? (
              <div className="state-empty"><p>{t("map.noPatterns")}</p></div>
            ) : (
              p.patterns.map((pt) => <PatternCard key={pt.patternId} classId={classId!} pattern={pt} onReviewed={() => { patterns.reload(); map.reload(); }} />)
            )
          }
        </AsyncView>
      </section>
    </>
  );
}

function WhyPanel({ classId, studentId, conceptId, onClose }: { classId: string; studentId: string; conceptId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const why = useApi<EvidenceDrilldown>(`/classes/${classId}/students/${studentId}/concepts/${conceptId}/evidence`);
  return (
    <section aria-labelledby="why-h" className="panel">
      <button className="btn btn-sm close" onClick={onClose}>
        {t("map.close")}
      </button>
      <AsyncView state={why}>
        {(w) => (
          <>
            <h2 id="why-h">
              {t("map.whyTitle", { student: w.student.name, concept: w.concept.title })}
            </h2>
            <p>
              <strong>
                <StatusMark status={w.mastery.status} />
              </strong>{" "}
              <span className="hint">{t("map.basedOn", { count: w.mastery.evidenceCount, version: w.mastery.algorithmVersion })}</span>
            </p>
            {w.rows.length === 0 ? (
              <p>{t("map.noEvidence")}</p>
            ) : (
              <div className="table-wrap"><table className="ruled">
                <thead>
                  <tr>
                    <th scope="col">{t("map.question")}</th>
                    <th scope="col">{t("map.answered")}</th>
                    <th scope="col">{t("map.result")}</th>
                    <th scope="col">{t("map.sure")}</th>
                    <th scope="col">{t("map.counted")}</th>
                  </tr>
                </thead>
                <tbody>
                  {w.rows.map((r) => (
                    <tr key={r.evidenceId}>
                      <td>{r.question}</td>
                      <td>
                        {r.chosen ?? "—"}
                        {r.misconception && <small> ⚑ {r.misconception}</small>}
                      </td>
                      <td>{t(`map.results.${r.result}`)}</td>
                      <td>{r.confidence ? t(`play.${r.confidence}`) : "—"}</td>
                      <td>{r.counted ? t("map.countedYes", { weight: r.weight }) : t("map.countedNo")}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
            <MarginNote>{t("map.whyNote")}</MarginNote>
          </>
        )}
      </AsyncView>
    </section>
  );
}

function PatternCard({ classId, pattern, onReviewed }: { classId: string; pattern: ClassMisconceptionsResponse["patterns"][number]; onReviewed: () => void }) {
  const { t } = useTranslation();
  const [error, setError] = useState<string>();
  const [showMirror, setShowMirror] = useState(false);

  async function review(studentId: string, decision: "confirm" | "reject") {
    setError(undefined);
    try {
      await api(`/classes/${classId}/misconceptions/review`, { method: "POST", body: { studentId, patternId: pattern.patternId, decision } });
      onReviewed();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    }
  }

  return (
    <article className="pattern">
      <h3 style={{ marginTop: 0 }}>{pattern.name}</h3>
      <p>{pattern.summary}</p>
      <ul className="plain rule-list">
        {pattern.students.map((s) => (
          <li key={s.id} className="row">
            <span>{s.name} — <em>{t(`map.obs.${s.status}`)}</em></span>
            {s.status !== "confirmed" && (
              <>
                <button className="btn btn-sm" disabled={s.status !== "likely"} title={s.status !== "likely" ? t("map.needsTwo") : undefined} onClick={() => void review(s.id, "confirm")}>
                  {t("map.confirm")}
                </button>{" "}
                <button className="btn btn-sm btn-danger" onClick={() => void review(s.id, "reject")}>{t("map.reject")}</button>
              </>
            )}
          </li>
        ))}
      </ul>
      {error && <Banner tone="err"><p>{error}</p></Banner>}
      <button className="btn" onClick={() => setShowMirror((v) => !v)} aria-expanded={showMirror}>
        {t("map.mirror")}
      </button>
      {showMirror && (
        <blockquote className="slip tilt" style={{ marginTop: "1rem" }}>
          <p>{pattern.mirror.prompt}</p>
          <p>
            <strong>{t("map.tryShowing")}:</strong> {pattern.mirror.whatToShow}
          </p>
          <MarginNote>{t("map.mirrorNote")}</MarginNote>
        </blockquote>
      )}
    </article>
  );
}
