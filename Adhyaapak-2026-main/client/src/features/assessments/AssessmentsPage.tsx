import { useState } from "react";
import { Link } from "react-router";
import type { AssessmentSummaryDto } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";

type Row = AssessmentSummaryDto & { classId: string; className: string };

const STATUS: Record<AssessmentSummaryDto["status"], { text: string; cls: string }> = {
  draft: { text: "Draft", cls: "chip draft" },
  approved: { text: "Ready", cls: "chip" },
  open: { text: "Open now", cls: "chip check" },
  closed: { text: "Closed", cls: "chip ok" },
};

/** Assessments: every class check, across classes, with how many students answered and a route to the results. */
export function AssessmentsPage() {
  const state = useApi<{ assessments: Row[] }>("/assessments");
  const [cls, setCls] = useState("all");
  const [status, setStatus] = useState("all");
  return (
    <>
      <section className="hello" style={{ marginBottom: 24 }}>
        <div>
          <h1>Assessments</h1>
          <p>Checks you have run, answers collected, and paper sheets to review. A check is started from a lesson.</p>
        </div>
      </section>
      <AsyncView state={state}>
        {({ assessments }) => {
          const classes = [...new Map(assessments.map((a) => [a.classId, a.className])).entries()];
          const shown = assessments.filter((a) => (cls === "all" || a.classId === cls) && (status === "all" || a.status === status));
          const open = assessments.filter((a) => a.status === "open").length;
          const answers = assessments.reduce((n, a) => n + a.submittedCount, 0);
          return (
            <>
              <div className="stat-cards">
                <div className="glass stat-card">
                  <p className="label">Checks run</p>
                  <b>{assessments.length}</b>
                  <small>Across all your classes</small>
                </div>
                <div className="glass stat-card">
                  <p className="label">Open now</p>
                  <b>{open}</b>
                  <small>Taking answers at this moment</small>
                </div>
                <div className="glass stat-card">
                  <p className="label">Students' submissions</p>
                  <b>{answers}</b>
                  <small>One per student per check</small>
                </div>
              </div>
              <section className="glass" aria-labelledby="list-h">
                <div className="g-head">
                  <h2 id="list-h">All checks</h2>
                  <div className="filters" style={{ margin: 0, minWidth: 320 }}>
                    <label>
                      Class
                      <select value={cls} onChange={(e) => setCls(e.target.value)}>
                        <option value="all">All classes</option>
                        {classes.map(([id, name]) => (
                          <option key={id} value={id}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Status
                      <select value={status} onChange={(e) => setStatus(e.target.value)}>
                        <option value="all">Any</option>
                        <option value="open">Open now</option>
                        <option value="closed">Closed</option>
                        <option value="draft">Draft</option>
                        <option value="approved">Ready</option>
                      </select>
                    </label>
                  </div>
                </div>
                {assessments.length === 0 ? (
                  <p className="g-note">No checks yet. Open a lesson from Today and choose “Start the check”; answers you collect appear here.</p>
                ) : shown.length === 0 ? (
                  <p className="g-note">No checks match these filters.</p>
                ) : (
                  <div className="table-wrap" style={{ background: "transparent", boxShadow: "none", border: 0 }}>
                    <table className="ruled">
                      <thead>
                        <tr>
                          <th>Check</th>
                          <th>Class</th>
                          <th>Date</th>
                          <th>Status</th>
                          <th className="num">Questions</th>
                          <th className="num">Answered</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {shown.map((a) => (
                          <tr key={a.id}>
                            <td>
                              <Link to={`/activities/${a.id}`}>{a.title}</Link>
                            </td>
                            <td>{a.className}</td>
                            <td>{new Date(a.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</td>
                            <td>
                              <span className={STATUS[a.status].cls}>{STATUS[a.status].text}</span>
                            </td>
                            <td className="num">{a.questionCount}</td>
                            <td className="num">{a.submittedCount}</td>
                            <td>
                              <span className="actions-inline">
                                <Link className="pill-btn light" to={`/activities/${a.id}`}>
                                  Results
                                </Link>
                                <Link className="pill-btn light" to={`/activities/${a.id}/paper`}>
                                  Paper sheets
                                </Link>
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </>
          );
        }}
      </AsyncView>
    </>
  );
}
