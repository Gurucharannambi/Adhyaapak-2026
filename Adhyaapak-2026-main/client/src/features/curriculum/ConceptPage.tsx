import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { ConceptDetailDto, ResourceDto, TeachingLevel } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";
import { Chip, EmptyState, Icon, MarginNote } from "../../components/ui";
import { BilingualView } from "./BilingualView";
import { ResourceView } from "./ResourceView";

const LEVELS: TeachingLevel[] = ["foundation", "guided", "challenge"];

export function ConceptPage() {
  const { t } = useTranslation();
  const { conceptId } = useParams();
  const state = useApi<ConceptDetailDto>(`/concepts/${conceptId}`);
  const [level, setLevel] = useState<TeachingLevel>("foundation");

  return (
    <>
      <Link className="back" to="/curriculum">
        <Icon name="back" /> <span>{t("nav.curriculum")}</span>
      </Link>
      <AsyncView state={state}>
        {(c) => {
          const resource = c.resources.find((r) => r.level === level);
          const notes = c.resources.filter((r) => r.type === "teacher_note");
          return (
            <>
              <h1>{c.title}</h1>
              <p>
                <Link className="btn" to={`/curriculum/concepts/${c.id}/drafts`}>{t("drafts.link")}</Link>
              </p>
              <p>{c.description}</p>
              <p>
                <strong>{t("concept.objective")}:</strong> {c.learningObjective}
              </p>

              <p className="decide-box" style={{ background: "var(--blue-t)", borderColor: "var(--blue-line)", maxWidth: "none" }} aria-label={t("concept.sequence")}>
                {c.prerequisites.length > 0 ? (
                  <>
                    {t("concept.firstUnderstand")}:{" "}
                    {c.prerequisites.map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && ", "}
                        <Link to={`/curriculum/concepts/${p.id}`}>{p.title}</Link>
                      </span>
                    ))}{" "}
                    →{" "}
                  </>
                ) : (
                  <>{t("concept.noPrereq")} → </>
                )}
                <strong>{c.title}</strong>
                {c.dependents.length > 0 && (
                  <>
                    {" "}
                    →{" "}
                    {c.dependents.map((p, i) => (
                      <span key={p.id}>
                        {i > 0 && ", "}
                        <Link to={`/curriculum/concepts/${p.id}`}>{p.title}</Link>
                      </span>
                    ))}
                  </>
                )}
              </p>

              <section aria-labelledby="teach-h">
                <h2 id="teach-h">{t("concept.teaching")}</h2>
                <div className="tabs" role="tablist" aria-label={t("concept.levels")}>
                  {LEVELS.map((l) => (
                    <button className="tab" key={l} role="tab" aria-selected={level === l} onClick={() => setLevel(l)}>
                      {t(`levels.${l}`)}
                    </button>
                  ))}
                </div>
                <div className="tabpanel" role="tabpanel">
                  <p className="hint">{t(`levels.${level}Help`)}</p>
                  {resource ? <ResourceView resource={resource} /> : <EmptyState title={t("concept.noResource")} />}
                  {notes.map((n) => (
                    <aside key={n.id}>
                      <MarginNote>
                        <b>{t("concept.teacherNote")}:</b> {String(n.content.text ?? "")}
                      </MarginNote>
                    </aside>
                  ))}
                </div>
              </section>

              <BilingualView conceptId={c.id} level={level} />

              <section aria-labelledby="q-h">
                <h2 id="q-h">{t("concept.questions", { count: c.questions.length })}</h2>
                {c.questions.map((q) => (
                  <article key={q.id} className="q-card">
                    <h4>{q.stem}</h4>
                    <p>
                      <Chip tone="role">{t(`concept.role.${q.role}`)}</Chip> <span className="hint">{t("concept.difficulty", { n: q.difficulty })}</span>
                    </p>
                    <ul className="plain">
                      {q.options.map((o) => (
                        <li key={o.id}>
                          {o.id.toUpperCase()}. {o.text}
                          {o.id === q.correctOptionId && <strong> ✓ {t("concept.correct")}</strong>}
                          {o.misconceptionKey && (
                            <small>
                              {" "}
                              — {t("concept.pointsTo")}: {c.misconceptions.find((m) => m.key === o.misconceptionKey)?.name ?? o.misconceptionKey}
                            </small>
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="hint">{q.explanation}</p>
                  </article>
                ))}
              </section>

              {c.misconceptions.length > 0 && (
                <section aria-labelledby="m-h">
                  <h2 id="m-h">{t("concept.misconceptions")}</h2>
                  {c.misconceptions.map((m) => (
                    <article key={m.id} className="pattern">
                      <h3>{m.name}</h3>
                      <p>{m.description}</p>
                      <p>
                        <small>
                          {t("concept.examples")}: {m.exampleWrongAnswers.join("; ")}
                        </small>
                      </p>
                      <p>
                        <strong>{t("concept.whatToDo")}:</strong> {m.recommendedExplanation}
                      </p>
                    </article>
                  ))}
                </section>
              )}

              <footer style={{ marginTop: "var(--s6)" }}>
                <small className="hint">
                  {t("concept.provenance")}: {c.provenance.source}
                  {c.provenance.note ? ` — ${c.provenance.note}` : ""} · {t("concept.status")}: {c.reviewStatus}
                </small>
              </footer>
            </>
          );
        }}
      </AsyncView>
    </>
  );
}
