import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { AssignResponse, BoardCard, BranchBoardResponse, GroupKey, InterventionDto } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";
import { ApiRequestError, api } from "../../services/api";
import { Banner, Icon, StatusGlyph } from "../../components/ui";

const LANES: GroupKey[] = ["foundation", "guided", "challenge", "follow_up"];
const EFFECT_SYMBOL = { improved: "↑", no_change: "→", declined: "↓", not_enough_evidence: "…", evidence_gathered: "◔" } as const;

export function BranchBoardPage() {
  const { t } = useTranslation();
  const { classId } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const concept = params.get("concept") ?? "";

  const board = useApi<BranchBoardResponse>(`/classes/${classId}/branch-board${concept ? `?conceptId=${concept}` : ""}`);
  const conceptId = board.data?.conceptId ?? undefined;
  const acts = useApi<{ interventions: InterventionDto[] }>(conceptId ? `/classes/${classId}/interventions?conceptId=${conceptId}` : null);

  // The teacher's choices: which lane each student goes to, why they moved, and who is included.
  const [lane, setLane] = useState<Record<string, GroupKey>>({});
  const [why, setWhy] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<AssignResponse>();
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Reset choices whenever a different concept (or freshly loaded board) arrives.
  useEffect(() => {
    setLane({});
    setWhy({});
    setSkip(new Set());
    setResult(undefined);
    setPicked(new Set());
  }, [conceptId]);

  const refresh = () => {
    board.reload();
    acts.reload();
  };

  async function assign(cards: Array<BoardCard & { recommended: GroupKey }>) {
    setBusy(true);
    setError(undefined);
    try {
      const assignments = cards
        .filter((c) => !c.assigned && !skip.has(c.studentId))
        .map((c) => {
          const groupKey = lane[c.studentId] ?? c.recommended;
          return { studentId: c.studentId, groupKey, ...(groupKey !== c.recommended ? { movedReason: why[c.studentId] ?? "" } : {}) };
        });
      const res = await api<AssignResponse>(`/classes/${classId}/interventions`, { method: "POST", body: { conceptId, assignments } });
      setResult(res);
      refresh();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  async function followUp() {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api<{ assessmentId: string }>(`/classes/${classId}/interventions/follow-up`, { method: "POST", body: { conceptId, interventionIds: [...picked] } });
      navigate(`/activities/${r.assessmentId}`);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
      setBusy(false);
    }
  }

  async function finish(id: string, to: "completed" | "dismissed") {
    setError(undefined);
    try {
      await api(`/interventions/${id}/finish`, { method: "POST", body: { to } });
      refresh();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    }
  }

  return (
    <>
      <div className="page-head no-print">
        <Link className="back" to={`/classes/${classId}`}>
          <Icon name="back" /> <span>{t("activity.backToClass")}</span>
        </Link>
        <h1>{t("board.title")}</h1>
        <p className="lede">{t("board.intro")}</p>
      </div>

      <AsyncView state={board}>
        {(b) => {
          if (!b.conceptId) return <div className="state-empty"><p>{t("board.empty")}</p></div>;
          const all = LANES.flatMap((l) => b.lanes[l].map((c) => ({ ...c, recommended: l })));
          const todo = all.filter((c) => !c.assigned && !skip.has(c.studentId));
          const missing = todo.filter((c) => (lane[c.studentId] ?? c.recommended) !== c.recommended && (why[c.studentId] ?? "").trim().length < 3);
          return (
            <>
              <div className="field no-print">
                <label htmlFor="board-concept">{t("board.concept")}</label>
                <select id="board-concept" value={b.conceptId} onChange={(e) => setParams({ concept: e.target.value })}>
                  {b.concepts.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="board no-print">
                {LANES.map((l) => (
                  <section key={l} aria-labelledby={`lane-${l}`} className={l === "follow_up" ? "lane evidence" : "lane"}>
                    <h2 id={`lane-${l}`} style={{ marginTop: 0 }}>
                      {t(`board.lane.${l}`)} ({b.lanes[l].length})
                    </h2>
                    <p className="lane-help">{t(`board.laneHelp.${l}`, { minutes: b.lanes[l][0]?.suggestedMinutes ?? 0 })}</p>
                    {b.lanes[l].length === 0 && <p>—</p>}
                    {b.lanes[l].map((c) => {
                      const chosen = lane[c.studentId] ?? l;
                      const moved = chosen !== l;
                      return (
                        <article key={c.studentId} className="slip" style={{ opacity: skip.has(c.studentId) ? 0.5 : 1 }}>
                          <h4>
                            {c.rosterNumber}. <Link to={`/classes/${classId}/students/${c.studentId}`}>{c.name}</Link>
                          </h4>
                          <p className="hint" style={{ margin: 0 }}>
                            <StatusGlyph status={c.status} size={18} /> {t(`status.${c.status}`)}
                            {c.evidenceCount > 0 && ` (${t("map.items", { count: c.evidenceCount })})`}
                          </p>
                          <p style={{ margin: "0.3rem 0" }}>
                            <strong>{t(`board.activity.${c.activity}`)}</strong>
                            {c.targetConceptId !== b.conceptId && (
                              <>
                                {": "}
                                {c.targetConceptTitle}
                              </>
                            )}
                          </p>
                          <details>
                            <summary>{t("board.why")}</summary>
                            <span className="pen" style={{ display: "block" }}>{c.reason}</span>
                            <small>{t(`board.uncertainty.${c.uncertainty}`)}</small>
                          </details>
                          {c.teacherReviewRequired && <p><span className="chip check">⚑ {t("board.reviewFlag")}</span></p>}
                          {c.assigned ? (
                            <p className="assigned">
                              ✓ <strong>{t("board.assigned")}</strong>{" "}
                              <button className="btn" onClick={() => void finish(c.assigned!.interventionId, "completed")}>{t("board.done")}</button>{" "}
                              <button className="btn" onClick={() => void finish(c.assigned!.interventionId, "dismissed")}>{t("board.dismiss")}</button>
                            </p>
                          ) : (
                            <>
                              <div className="field" style={{ marginTop: "var(--s2)", marginBottom: "var(--s2)" }}>
                                <label htmlFor={`move-${c.studentId}`}>{t("board.moveTo")}</label>
                                <select id={`move-${c.studentId}`} value={chosen} onChange={(e) => setLane((x) => ({ ...x, [c.studentId]: e.target.value as GroupKey }))}>
                                  {LANES.map((k) => (
                                    <option key={k} value={k}>
                                      {t(`board.lane.${k}`)}
                                      {k === l ? ` (${t("board.suggested")})` : ""}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              {moved && (
                                <div className="field" style={{ marginBottom: "var(--s2)" }}>
                                  <label htmlFor={`why-${c.studentId}`}>{t("board.movedWhy")}</label>
                                  <input className="input" id={`why-${c.studentId}`} value={why[c.studentId] ?? ""} onChange={(e) => setWhy((x) => ({ ...x, [c.studentId]: e.target.value }))} />
                                </div>
                              )}
                              <div className="choice" style={{ minHeight: 0 }}>
                                <input
                                  id={`inc-${c.studentId}`}
                                  type="checkbox"
                                  checked={!skip.has(c.studentId)}
                                  onChange={() =>
                                    setSkip((s) => {
                                      const n = new Set(s);
                                      if (n.has(c.studentId)) n.delete(c.studentId);
                                      else n.add(c.studentId);
                                      return n;
                                    })
                                  }
                                />
                                <label htmlFor={`inc-${c.studentId}`}>{t("board.include")}</label>
                              </div>
                            </>
                          )}
                        </article>
                      );
                    })}
                  </section>
                ))}
              </div>

              <div className="btn-row no-print">
                <button className="btn btn-primary" disabled={busy || todo.length === 0 || missing.length > 0} onClick={() => void assign(all)}>
                  {t("board.assignAll", { count: todo.length })}
                </button>
                <button className="btn" onClick={() => window.print()}>{t("board.print")}</button>
                {missing.length > 0 && <span className="pen inline">{t("board.needReason", { names: missing.map((m) => m.name).join(", ") })}</span>}
              </div>
              {error && (
                <div className="no-print">
                  <Banner tone="err"><p>{error}</p></Banner>
                </div>
              )}
              {result && (
                <div aria-live="polite" className="no-print">
                  <Banner tone="ok"><p>{t("board.assignedCount", { count: result.assigned.length })}</p></Banner>
                  {result.skipped.map((s) => (
                    <p key={s.studentId}>
                      ✗ {all.find((c) => c.studentId === s.studentId)?.name ?? s.studentId}: {s.message}
                    </p>
                  ))}
                </div>
              )}

              <section aria-labelledby="acts-h" className="no-print">
                <h2 id="acts-h">{t("board.activities")}</h2>
                <AsyncView state={acts}>
                  {(a) =>
                    a.interventions.length === 0 ? (
                      <div className="state-empty"><p>{t("board.noActivities")}</p></div>
                    ) : (
                      <>
                        <div className="table-wrap"><table className="ruled">
                          <thead>
                            <tr>
                              <th scope="col" />
                              <th scope="col">{t("classPage.name")}</th>
                              <th scope="col">{t("board.activityCol")}</th>
                              <th scope="col">{t("board.statusCol")}</th>
                              <th scope="col">{t("board.didItHelp")}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {a.interventions.map((i) => (
                              <tr key={i.id}>
                                <td>
                                  {i.status === "assigned" && (
                                    <input
                                      type="checkbox"
                                      aria-label={t("board.pick", { name: i.studentName })}
                                      checked={picked.has(i.id)}
                                      onChange={() =>
                                        setPicked((s) => {
                                          const n = new Set(s);
                                          if (n.has(i.id)) n.delete(i.id);
                                          else n.add(i.id);
                                          return n;
                                        })
                                      }
                                    />
                                  )}
                                </td>
                                <td>{i.studentName}</td>
                                <td>
                                  {t(`board.activity.${i.activity}`)} — {i.targetConceptTitle}
                                  {i.movedReason && (
                                    <>
                                      <br />
                                      <small>{t("board.movedNote", { reason: i.movedReason })}</small>
                                    </>
                                  )}
                                </td>
                                <td>
                                  {t(`board.istatus.${i.status}`)}
                                  {i.followUpAssessmentId && (
                                    <>
                                      <br />
                                      <Link to={`/activities/${i.followUpAssessmentId}`}>{t("board.followUpLink")}</Link>
                                    </>
                                  )}
                                </td>
                                <td>
                                  {i.effect && (
                                    <>
                                      <strong>
                                        {EFFECT_SYMBOL[i.effect.outcome]} {t(`board.effect.${i.effect.outcome}`)}
                                      </strong>
                                      <br />
                                      <small>{i.effect.explanation}</small>
                                    </>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table></div>
                        <p>
                          <button className="btn btn-primary" disabled={busy || picked.size === 0} onClick={() => void followUp()}>
                            {t("board.makeFollowUp", { count: picked.size })}
                          </button>
                        </p>
                        <p>
                          <small>{t("board.effectNote")}</small>
                        </p>
                      </>
                    )
                  }
                </AsyncView>
              </section>

              {/* Printed group slips: one block per lane, shown only when printing. */}
              <div className="print-only">
                {LANES.filter((l) => b.lanes[l].length > 0).map((l) => (
                  <section key={l} style={{ border: "2px solid #000", padding: "1rem", marginBottom: "1rem", pageBreakInside: "avoid" }}>
                    <h2>{t(`board.lane.${l}`)}</h2>
                    <p>
                      {b.conceptTitle} · {t("board.slipMinutes", { minutes: b.lanes[l][0]!.suggestedMinutes })}
                    </p>
                    <p>
                      <strong>{t("board.slipStudents")}:</strong> {b.lanes[l].map((c) => c.name).join(", ")}
                    </p>
                    <p>
                      <strong>{t("board.slipDo")}:</strong> {t(`board.slip.${l}`)}
                    </p>
                  </section>
                ))}
              </div>
            </>
          );
        }}
      </AsyncView>
    </>
  );
}
