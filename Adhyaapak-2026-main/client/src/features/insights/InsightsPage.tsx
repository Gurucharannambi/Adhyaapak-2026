import { Link, useSearchParams } from "react-router";
import type { ClassDto, InsightsResponse } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";
import { classLabel } from "../../utils/classLabel";
import { initials } from "../../utils/initials";
import { GROWTH_LABEL } from "./GrowthCards";
import { ProgressChart, STATUS_LABEL, STATUS_ORDER } from "./ProgressChart";

/**
 * Insights: concept mastery, change between checks, error patterns and growth for one class. Computed on the server
 * from the same evidence as the class map and the Atlas; nothing here is estimated in the browser.
 */
export function InsightsPage() {
  const [params, setParams] = useSearchParams();
  const classes = useApi<{ classes: ClassDto[] }>("/classes");
  return (
    <>
      <section className="hello" style={{ marginBottom: 20 }}>
        <div>
          <h1>Insights</h1>
          <p>What your students understand, where they are struggling, and who has grown. From recorded answers only.</p>
        </div>
      </section>
      <AsyncView state={classes}>
        {({ classes: list }) => {
          if (list.length === 0) return <div className="glass">Create a class first; its insights appear once students answer a check.</div>;
          const classId = params.get("class") && list.some((c) => c.id === params.get("class")) ? params.get("class")! : list[0]!.id;
          return (
            <>
              {list.length > 1 && (
                <div className="cls-switch" role="group" aria-label="Class" style={{ marginBottom: 18 }}>
                  {list.map((c) => (
                    <button key={c.id} type="button" aria-pressed={c.id === classId} onClick={() => setParams({ class: c.id })}>
                      {classLabel(c, list)}
                    </button>
                  ))}
                </div>
              )}
              <ClassInsights classId={classId} />
            </>
          );
        }}
      </AsyncView>
    </>
  );
}

function ClassInsights({ classId }: { classId: string }) {
  const state = useApi<InsightsResponse>(`/classes/${classId}/insights`);
  return (
    <AsyncView state={state}>
      {(i) => {
        const secure = i.distribution.byStatus.likely_secure + i.distribution.byStatus.ready_for_challenge;
        const assessedPairs = i.distribution.cells - i.distribution.byStatus.not_enough_evidence;
        return (
          <>
            <div className="stat-cards">
              <div className="glass stat-card">
                <p className="label">Students</p>
                <b>{i.studentCount}</b>
                <small>Active on the {i.className} roster</small>
              </div>
              <div className="glass stat-card">
                <p className="label">Concepts with answers</p>
                <b>{i.distribution.concepts}</b>
                <small>Concepts this class has any recorded answers on</small>
              </div>
              <div className="glass stat-card">
                <p className="label">Likely secure</p>
                <b>{assessedPairs ? `${secure}/${assessedPairs}` : "–"}</b>
                <small>Student-and-concept pairs with enough answers that read as secure</small>
              </div>
              <div className="glass stat-card">
                <p className="label">Book progress</p>
                <b>{i.coverage.total ? `${i.coverage.taught}/${i.coverage.total}` : "–"}</b>
                <small>Lessons recorded as taught{i.coverage.bookTitle ? ` in ${i.coverage.bookTitle}` : ""}</small>
              </div>
            </div>

            {i.distribution.concepts === 0 ? (
              <div className="glass">
                <p style={{ marginTop: 0 }}>No recorded answers yet, so there is nothing to show. Insights fill in after a check in a lesson.</p>
                <Link className="pill-btn" to="/">
                  Go to Today
                </Link>
              </div>
            ) : (
              <>
                <div className="grid-2" style={{ gap: 20, alignItems: "start" }}>
                  <section className="glass" aria-labelledby="dist-h">
                    <div className="g-head">
                      <h2 id="dist-h">Learning progress distribution</h2>
                      <Link className="pill-btn" to={`/classes/${classId}/map`}>
                        Open the class map
                      </Link>
                    </div>
                    <ProgressChart byStatus={i.distribution.byStatus} caption={`Each of ${i.studentCount} students on each of ${i.distribution.concepts} concepts: ${i.distribution.cells} pairs. Hatched = no or too few answers, which is a gap in evidence, not a weakness.`} />
                  </section>
                  <Growth i={i} classId={classId} />
                </div>
                <ConceptTable i={i} classId={classId} />
              </>
            )}
            <details className="def">
              <summary>How these numbers are counted</summary>
              <p>Statuses come from the mastery records, which weigh each counted answer by recency and difficulty (see the class map's “Why?”). Answers waiting for review, unreadable answers and low-confidence paper readings are not counted. “Change between checks” compares right answers in the last two class checks that assessed a concept; the questions differ, so treat it as a signal, not a measurement. Growth groups use the rules written under each group and never compare students with each other.</p>
            </details>
          </>
        );
      }}
    </AsyncView>
  );
}

function Growth({ i, classId }: { i: InsightsResponse; classId: string }) {
  const groups = i.growth.filter((g) => g.key !== "practice" || i.practiceRecorded);
  return (
    <section className="glass" aria-labelledby="grow-h">
      <div className="g-head">
        <h2 id="grow-h">Student growth</h2>
        <span className="chip private">Only you see this</span>
      </div>
      {groups.map((g) => (
        <div key={g.key} style={{ marginBottom: 16 }}>
          <h3 style={{ margin: "0 0 4px" }}>
            {GROWTH_LABEL[g.key].title} <span className="g-note">({g.students.length})</span>
          </h3>
          <p className="g-note" style={{ margin: "0 0 8px" }}>
            {GROWTH_LABEL[g.key].criterion}
          </p>
          {g.students.length === 0 ? (
            <p className="g-note" style={{ fontStyle: "italic" }}>
              Nobody yet.
            </p>
          ) : (
            <ul className="plain kvlist">
              {g.students.map((s) => (
                <li key={s.studentId} style={{ justifyContent: "flex-start", fontSize: 15 }}>
                  <span className={`av ${GROWTH_LABEL[g.key].tone}`} aria-hidden="true">
                    {initials(s.name)}
                  </span>
                  <span>
                    <Link to={`/classes/${classId}/students/${s.studentId}`}>{s.name}</Link>
                    <span className="g-note" style={{ display: "block" }}>
                      {s.why}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      {!i.practiceRecorded && <p className="g-note">“Consistent practice” is hidden: no practice sets are recorded for this class.</p>}
    </section>
  );
}

function ConceptTable({ i, classId }: { i: InsightsResponse; classId: string }) {
  return (
    <section className="glass" style={{ marginTop: 20 }} aria-labelledby="concepts-h">
      <div className="g-head">
        <h2 id="concepts-h">Concepts</h2>
        <p className="g-note">Students per status. “Assessed” = students with at least one counted answer.</p>
      </div>
      <div className="table-wrap" style={{ background: "transparent", boxShadow: "none", border: 0 }}>
        <table className="ruled">
          <thead>
            <tr>
              <th>Concept</th>
              <th className="num">Assessed</th>
              {STATUS_ORDER.map((s) => (
                <th key={s} className="num">
                  {STATUS_LABEL[s].title}
                </th>
              ))}
              <th>Change between checks</th>
              <th className="num">Error pattern</th>
            </tr>
          </thead>
          <tbody>
            {i.concepts.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link to={`/classes/${classId}/concept-map?concept=${c.id}`}>{c.title}</Link>
                </td>
                <td className="num">
                  {c.assessed}/{i.studentCount}
                </td>
                {STATUS_ORDER.map((s) => (
                  <td key={s} className="num">
                    {c.counts[s]}
                  </td>
                ))}
                <td>
                  {c.trend ? (
                    <span>
                      {c.trend.previous ? `${c.trend.previous.right}/${c.trend.previous.of} → ` : ""}
                      <strong>
                        {c.trend.latest.right}/{c.trend.latest.of}
                      </strong>{" "}
                      <span className="g-note">right{c.trend.previous ? "" : " (one check so far)"}</span>
                    </span>
                  ) : (
                    <span className="g-note">No class check yet</span>
                  )}
                </td>
                <td className="num">{c.patternStudents > 0 ? <Link to={`/atlas?class=${classId}`}>{c.patternStudents} students</Link> : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
