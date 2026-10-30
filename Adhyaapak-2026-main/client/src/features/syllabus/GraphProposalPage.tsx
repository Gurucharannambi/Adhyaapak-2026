import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams } from "react-router";
import type { ProposalConceptDto, ProposalDto, PublishResponse } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { Banner, Icon } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { ApiRequestError, api } from "../../services/api";
import { GraphView } from "./GraphView";

/**
 * Review of an AI-proposed concept graph. Every prerequisite the document does not back up needs an
 * explicit decision here, and nothing is published until the teacher confirms.
 */
export function GraphProposalPage() {
  const { t } = useTranslation();
  const { proposalId } = useParams();
  const navigate = useNavigate();
  const state = useApi<ProposalDto>(`/graph-proposals/${proposalId}`);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [published, setPublished] = useState<PublishResponse>();
  const [newTitle, setNewTitle] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      state.reload();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AsyncView state={state}>
      {(p) => {
        const name = new Map(p.concepts.map((c) => [c.id, c.title]));
        const draft = p.status === "draft";
        const pendingFirst = [...p.edges].sort((a, b) => Number(b.decision === "pending") - Number(a.decision === "pending"));
        return (
          <>
            <Link className="back" to="/syllabus">
              <Icon name="back" /> <span>{t("syllabus.title")}</span>
            </Link>
            <h1>{p.title}</h1>
            <p className="muted">
              {t("syllabus.proposalMeta", { grade: p.grade, subject: p.subject, board: p.board, year: p.academicYear })} · {t(`syllabus.status.${p.status}`)} · {t("syllabus.madeBy", { model: p.model })}
            </p>
            <p>{t("syllabus.reviewIntro")}</p>

            {p.suspiciousDocument && <Banner tone="warn"><p>{t("syllabus.suspicious")}</p></Banner>}
            {p.notes.length > 0 && (
              <details open>
                <summary>{t("syllabus.notes", { count: p.notes.length })}</summary>
                <ul>
                  {p.notes.map((n) => (
                    <li key={n}>
                      <span className="pen inline">{n}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <h2>{t("syllabus.picture")}</h2>
            <p className="hint">{t("syllabus.legend")}</p>
            <GraphView concepts={p.concepts} edges={p.edges} label={t("syllabus.pictureLabel", { count: p.concepts.length })} />

            <h2>{t("syllabus.prereqs", { count: p.edges.length })}</h2>
            {p.edges.length === 0 && <div className="state-empty"><p>{t("syllabus.noPrereqs")}</p></div>}
            <ul className="plain">
              {pendingFirst.map((e) => (
                <li key={e.id} className={e.decision === "pending" ? "answer-block needs" : "answer-block"}>
                  <strong>
                    {name.get(e.prerequisiteConceptId)} → {name.get(e.dependentConceptId)}
                  </strong>{" "}
                  <span className={e.decision === "pending" ? "chip decide" : "chip"}>{t(`syllabus.decision.${e.decision}`)}</span>
                  <br />
                  {e.grounding === "document" && e.evidenceQuote && (
                    <span className="hint">
                      ✓ {t("syllabus.fromDoc")}: “{e.evidenceQuote}”
                    </span>
                  )}
                  {e.grounding === "inferred" && (
                    <span className="pen" style={{ display: "block" }}>
                      <b>{t("syllabus.notInDoc")}</b> {t("syllabus.notInDocHelp")} ({t(`syllabus.conf.${e.confidence}`)})
                    </span>
                  )}
                  {e.grounding === "teacher" && <span className="hint">✎ {t("syllabus.byYou")}</span>}
                  {e.grounding === "document" && e.confidence === "low" && <span className="hint"> ({t("syllabus.conf.low")})</span>}
                  {draft && (
                    <span className="actions-inline" style={{ marginTop: "var(--s2)" }}>
                      <button className="btn btn-sm btn-primary" disabled={busy || e.decision === "accepted"} onClick={() => void act(() => api(`/graph-proposals/${p.id}/edges/${e.id}`, { method: "PATCH", body: { decision: "accepted" } }))}>
                        {t("syllabus.accept")}
                      </button>
                      <button className="btn btn-sm btn-danger" disabled={busy || e.decision === "rejected"} onClick={() => void act(() => api(`/graph-proposals/${p.id}/edges/${e.id}`, { method: "PATCH", body: { decision: "rejected" } }))}>
                        {t("syllabus.reject")}
                      </button>
                    </span>
                  )}
                </li>
              ))}
            </ul>

            {draft && p.concepts.length >= 2 && (
              <form
                onSubmit={(ev) => {
                  ev.preventDefault();
                  void act(() => api(`/graph-proposals/${p.id}/edges`, { method: "POST", body: { prerequisiteConceptId: from, dependentConceptId: to } }));
                }}
                className="row"
                style={{ alignItems: "flex-end", marginBottom: "var(--s5)" }}
              >
                <label>
                  {t("syllabus.mustKnowFirst")}
                  <select value={from} onChange={(e) => setFrom(e.target.value)} required>
                    <option value="" />
                    {p.concepts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {t("syllabus.beforeLearning")}
                  <select value={to} onChange={(e) => setTo(e.target.value)} required>
                    <option value="" />
                    {p.concepts.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="btn" type="submit" style={{ marginBottom: "var(--s4)" }} disabled={busy || !from || !to}>
                  {t("syllabus.addPrereq")}
                </button>
              </form>
            )}

            <h2>{t("syllabus.concepts", { count: p.concepts.length })}</h2>
            {p.concepts.map((c) => (
              <ConceptEditor key={c.id} proposalId={p.id} concept={c} editable={draft} onChanged={state.reload} />
            ))}
            {draft && (
              <form
                onSubmit={(ev) => {
                  ev.preventDefault();
                  void act(async () => {
                    await api(`/graph-proposals/${p.id}/concepts`, { method: "POST", body: { title: newTitle } });
                    setNewTitle("");
                  });
                }}
                className="row"
                style={{ alignItems: "flex-end", marginBottom: "var(--s5)" }}
              >
                <label>
                  {t("syllabus.addConcept")}
                  <input className="input" value={newTitle} onChange={(e) => setNewTitle(e.target.value)} />
                </label>
                <button className="btn" type="submit" style={{ marginBottom: "var(--s4)" }} disabled={busy || !newTitle.trim()}>
                  {t("classPage.add")}
                </button>
              </form>
            )}

            {error && <Banner tone="err"><p>{error}</p></Banner>}

            <section aria-labelledby="pub-h" className="publish-box">
              <h2 id="pub-h" style={{ marginTop: 0 }}>
                {t("syllabus.publishTitle")}
              </h2>
              {published || p.publishedCurriculumVersionId ? (
                <>
                  <p className="chip ok">✓ {published ? t("syllabus.published", { version: published.version, concepts: published.conceptCount, edges: published.edgeCount }) : t("syllabus.alreadyPublished")}</p>
                  <p>
                    <Link className="btn" to="/curriculum">{t("syllabus.seeCurriculum")}</Link>
                  </p>
                  <p className="pen">{t("syllabus.nextSteps")}</p>
                </>
              ) : p.status === "discarded" ? (
                <p>{t("syllabus.discardedMsg")}</p>
              ) : (
                <>
                  {p.blockers.length > 0 && (
                    <div className="decide-box" role="status">
                      <ul style={{ margin: 0 }}>
                        {p.blockers.map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="pen">{t("syllabus.publishWarning")}</p>
                  <div className="choice">
                    <input id="pub-confirm" type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} disabled={!p.canPublish} />
                    <label htmlFor="pub-confirm">{t("syllabus.confirmPublish")}</label>
                  </div>
                  <div className="btn-row">
                    <button className="btn btn-primary"
                      disabled={busy || !p.canPublish || !confirmed}
                      onClick={() =>
                        void act(async () => {
                          setPublished(await api<PublishResponse>(`/graph-proposals/${p.id}/publish`, { method: "POST", body: { confirm: true } }));
                        })
                      }
                    >
                      {t("syllabus.publish")}
                    </button>
                    <button className="btn btn-danger" disabled={busy} onClick={() => void act(async () => { await api(`/graph-proposals/${p.id}/discard`, { method: "POST" }); navigate("/syllabus"); })}>
                      {t("syllabus.discard")}
                    </button>
                  </div>
                </>
              )}
            </section>
          </>
        );
      }}
    </AsyncView>
  );
}

function ConceptEditor({ proposalId, concept, editable, onChanged }: { proposalId: string; concept: ProposalConceptDto; editable: boolean; onChanged: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(concept.title);
  const [description, setDescription] = useState(concept.description);
  const [objective, setObjective] = useState(concept.learningObjective);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  if (!editable)
    return (
      <article className="q-card">
        <strong>{concept.title}</strong>
        <br />
        <span className="hint">{concept.learningObjective}</span>
      </article>
    );

  return (
    <article className="q-card">
      <label>
        {t("syllabus.conceptTitle")}
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        {t("syllabus.conceptDescription")}
        <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label>
        {t("concept.objective")}
        <input className="input" value={objective} onChange={(e) => setObjective(e.target.value)} />
      </label>
      <p className="hint">
        {concept.addedByTeacher ? `✎ ${t("syllabus.byYou")}` : concept.grounded ? `✓ ${t("syllabus.conceptInDoc")}: “${concept.evidenceQuote}”` : `⚠ ${t("syllabus.conceptNotQuoted")}`}
      </p>
      <div className="actions-inline">
        <button className="btn btn-sm" disabled={busy} onClick={() => void run(() => api(`/graph-proposals/${proposalId}/concepts/${concept.id}`, { method: "PATCH", body: { title, description, learningObjective: objective } }))}>
          {t("drafts.save")}
        </button>
        <button className="btn btn-sm btn-danger" disabled={busy} onClick={() => void run(() => api(`/graph-proposals/${proposalId}/concepts/${concept.id}`, { method: "DELETE" }))}>
          {t("syllabus.removeConcept")}
        </button>
      </div>
      {error && <Banner tone="err"><p>{error}</p></Banner>}
    </article>
  );
}
