import { Link } from "react-router";
import type { DashboardResponse } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";
import { CreateClassForm } from "../teacher-dashboard/DashboardPage";

/** My Classes: every class this teacher owns, with its roster, today's periods and the routes into its work. */
export function ClassesPage() {
  const state = useApi<DashboardResponse>("/dashboard");
  return (
    <>
      <section className="hello" style={{ marginBottom: 24 }}>
        <div>
          <h1>Classes</h1>
          <p>Rosters, timetables and where each class stands. Every number comes from the class's own records.</p>
        </div>
      </section>
      <AsyncView state={state}>
        {(d) => (
          <>
            {d.classes.length === 0 ? (
              <div className="glass">
                <p style={{ marginTop: 0 }}>You have no classes yet. Create one below; a sample timetable is added so lessons are planned straight away, and you can change it.</p>
              </div>
            ) : (
              <ul className="cards-grid plain">
                {d.classes.map((c) => {
                  const today = (d.schedule ?? []).filter((p) => p.classId === c.id);
                  return (
                    <li key={c.id} className="glass class-card">
                      <div className="g-head" style={{ marginBottom: 0 }}>
                        <h2>{c.name}</h2>
                        <span className="tag grey">Join code {c.joinCode}</span>
                      </div>
                      <p className="meta">
                        Class {c.grade} · {c.academicYear}
                      </p>
                      <div className="nums">
                        <div>
                          <b>{c.studentCount}</b>
                          <span>Students</span>
                        </div>
                        <div>
                          <b>{today.length}</b>
                          <span>Periods today</span>
                        </div>
                      </div>
                      {today.length > 0 && (
                        <ul className="plain" style={{ marginBottom: 16 }}>
                          {today.map((p) => (
                            <li key={p.period} className="g-note" style={{ padding: "4px 0" }}>
                              {p.startsAt} · {p.subject}
                              {p.lesson ? `: ${p.lesson.title}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="actions-inline">
                        <Link className="pill-btn" to={`/classes/${c.id}`}>
                          Open class
                        </Link>
                        <Link className="pill-btn light" to={`/classes/${c.id}/timetable`}>
                          Timetable
                        </Link>
                        <Link className="pill-btn light" to={`/classes/${c.id}/map`}>
                          Class map
                        </Link>
                        <Link className="pill-btn light" to={`/insights?class=${c.id}`}>
                          Insights
                        </Link>
                        <Link className="pill-btn light" to={`/atlas?class=${c.id}`}>
                          Atlas
                        </Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <CreateClassForm onCreated={state.reload} />
          </>
        )}
      </AsyncView>
    </>
  );
}
