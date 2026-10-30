import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router";
import type { ConceptDetailDto, DraftCheck, DraftQuestionDto, DraftResourceDto, DraftsResponse, GenerateQuestionsResponse, TeachingLevel } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";
import { Banner, Icon, PageHead } from "../../components/ui";
import { ApiRequestError, api } from "../../services/api";

const LEVELS: TeachingLevel[] = ["foundation", "guided", "challenge"];

/** Where AI-written questions and explanations are checked, edited and approved. Nothing here reaches students until approved. */
export function DraftsPage() {
  const { t } = useTranslation();
  const { conceptId } = useParams();
  const concept = useApi<ConceptDetailDto>(`/concepts/${conceptId}`);
  const drafts = useApi<DraftsResponse>(`/concepts/${conceptId}/drafts`);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [count, setCount] = useState(2);
  const [discarded, setDiscarded] = useState<string[]>([]);

  async function run<T>(label: string, fn: () => Promise<T>) {
    setBusy(label);
    setError(undefined);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
      return undefined;
    } finally {
      setBusy(undefined);
    }
  }

  const genQuestions = () =>
    run("questions", async () => {
      const r = await api<GenerateQuestionsResponse>(`/concepts/${conceptId}/drafts/questions`, { method: "POST", body: { count } });
      setDiscarded(r.discarded.map((d) => d.reason));
      drafts.reload();
    });
  const genExplanation = (level: TeachingLevel) =>
    run(level, async () => {
      setDiscarded([]);
      await api(`/concepts/${conceptId}/drafts/explanations`, { method: "POST", body: { level } });
      drafts.reload();
    });

  return (
    <>
      <PageHead
        title={t("drafts.title")}
        lede={t("drafts.intro")}
        back={
          <Link className="back" to={`/curriculum/concepts/${conceptId}`}>
            <Icon name="back" /> <span>{concept.data?.title ?? t("nav.curriculum")}</span>
          </Link>
        }
      />

      <AsyncView state={drafts}>
        {(d) => (
          <>
            {!d.aiAvailable && <Banner tone="info"><p>{t("drafts.aiOff")}</p></Banner>}

            <section aria-labelledby="gen-h" className="panel" style={{ marginTop: 0 }}>
              <h2 id="gen-h" style={{ fontSize: "var(--fs-m)", marginTop: 0 }}>
                {t("drafts.ask")}
              </h2>
              <div className="row" style={{ alignItems: "flex-end" }}>
                <div className="field" style={{ marginBottom: 0 }}>
                  <label htmlFor="draft-count">{t("drafts.howMany")}</label>
                  <select id="draft-count" value={count} onChange={(e) => setCount(Number(e.target.value))}>
                    {[1, 2, 3].map((n) => (
                      <option key={n}>{n}</option>
                    ))}
                  </select>
                </div>
                <button className="btn btn-primary" disabled={!d.aiAvailable || !!busy || d.questionSlotsLeft < count} onClick={() => void genQuestions()}>
                  {busy === "questions" ? t("drafts.working") : t("drafts.draftQuestions", { count })}
                </button>
                <span className="hint">{t("drafts.slotsLeft", { count: d.questionSlotsLeft })}</span>
              </div>
              <div className="row" style={{ marginTop: "var(--s3)" }}>
                <span>{t("drafts.explanation")}:</span>
                {LEVELS.map((l) => (
                  <button className="btn" key={l} disabled={!d.aiAvailable || !!busy || d.resources.some((r) => r.level === l)} onClick={() => void genExplanation(l)}>
                    {busy === l ? t("drafts.working") : t(`levels.${l}`)}
                  </button>
                ))}
              </div>
              {error && <Banner tone="err"><p>{error}</p></Banner>}
              {discarded.length > 0 && (
                <details open>
                  <summary>{t("drafts.discarded", { count: discarded.length })}</summary>
                  <ul>
                    {discarded.map((r, i) => (
                      <li key={i}>
                        <small>{r}</small>
                      </li>
                    ))}
                  </ul>
                  <small>{t("drafts.discardedNote")}</small>
                </details>
              )}
            </section>

            <h2>{t("drafts.questions", { count: d.questions.length })}</h2>
            {d.questions.length === 0 && <div className="state-empty"><p>{t("drafts.noQuestions")}</p></div>}
            {d.questions.map((q) => (
              <QuestionDraftCard key={q.id} draft={q} misconceptionKeys={concept.data?.misconceptions.map((m) => ({ key: m.key, name: m.name })) ?? []} onChanged={drafts.reload} />
            ))}

            <h2>{t("drafts.explanations", { count: d.resources.length })}</h2>
            {d.resources.length === 0 && <div className="state-empty"><p>{t("drafts.noExplanations")}</p></div>}
            {d.resources.map((r) => (
              <ResourceDraftCard key={r.id} draft={r} onChanged={drafts.reload} />
            ))}
          </>
        )}
      </AsyncView>
    </>
  );
}

function CheckBanner({ check }: { check: DraftCheck }) {
  const { t } = useTranslation();
  if (check.status === "verified")
    return (
      <Banner tone="ok">
        <p>{t("drafts.verified")}</p>
      </Banner>
    );
  if (check.status === "failed")
    return (
      <Banner tone="err">
        <div>
          <p>
            <strong>{t("drafts.failed")}</strong>
          </p>
          <ul>
            {check.issues.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      </Banner>
    );
  return (
    <Banner tone="warn">
      <p>
        <strong>{t("drafts.notChecked")}</strong> {t("drafts.notCheckedHelp")}
      </p>
    </Banner>
  );
}

function useDraftAction(onChanged: () => void) {
  const { t } = useTranslation();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  async function act(fn: () => Promise<unknown>) {
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
  return { error, busy, act };
}

function QuestionDraftCard({ draft, misconceptionKeys, onChanged }: { draft: DraftQuestionDto; misconceptionKeys: Array<{ key: string; name: string }>; onChanged: () => void }) {
  const { t } = useTranslation();
  const [stem, setStem] = useState(draft.stem);
  const [options, setOptions] = useState(draft.options);
  const [correct, setCorrect] = useState(draft.correctOptionId);
  const [difficulty, setDifficulty] = useState(draft.difficulty);
  const [role, setRole] = useState(draft.role);
  const [explanation, setExplanation] = useState(draft.explanation);
  const [confirmed, setConfirmed] = useState(false);
  const [check, setCheck] = useState(draft.check);
  const { error, busy, act } = useDraftAction(onChanged);

  const keys = [...misconceptionKeys];
  for (const o of draft.options) if (o.misconceptionKey && !keys.some((k) => k.key === o.misconceptionKey)) keys.push({ key: o.misconceptionKey, name: o.misconceptionKey });
  const needsHand = check.status === "not_applicable";

  const save = () =>
    act(async () => {
      const r = await api<DraftQuestionDto>(`/question-drafts/${draft.id}`, { method: "PATCH", body: { stem, options, correctOptionId: correct, difficulty, role, explanation } });
      setCheck(r.check);
    });

  return (
    <article className="q-card" style={{ borderStyle: "dashed", borderColor: "var(--red)" }}>
      <p>
        <span className="chip ai">{t("drafts.badge")}</span> <span className="hint">{draft.provenanceNote}</span>
      </p>
      <CheckBanner check={check} />
      <label>
        {t("drafts.stem")}
        <textarea value={stem} onChange={(e) => setStem(e.target.value)} rows={2} />
      </label>
      <fieldset>
        <legend>{t("drafts.optionsLegend")}</legend>
        {options.map((o, i) => (
          <div key={o.id} style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
            <input type="radio" name={`correct-${draft.id}`} aria-label={t("drafts.markCorrect", { letter: o.id.toUpperCase() })} checked={correct === o.id} onChange={() => setCorrect(o.id)} />
            <strong>{o.id.toUpperCase()}.</strong>
            <input className="input" aria-label={t("drafts.optionText", { letter: o.id.toUpperCase() })} value={o.text} onChange={(e) => setOptions((x) => x.map((y, j) => (j === i ? { ...y, text: e.target.value } : y)))} />
            <select aria-label={t("drafts.pattern", { letter: o.id.toUpperCase() })} value={o.misconceptionKey ?? ""} onChange={(e) => setOptions((x) => x.map((y, j) => (j === i ? { ...y, misconceptionKey: e.target.value || null } : y)))}>
              <option value="">{t("drafts.noPattern")}</option>
              {keys.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.name}
                </option>
              ))}
            </select>
          </div>
        ))}
      </fieldset>
      <div className="row" style={{ alignItems: "flex-start" }}>
        <label>
          {t("drafts.difficulty")}
          <select value={difficulty} onChange={(e) => setDifficulty(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n}>{n}</option>
            ))}
          </select>
        </label>
        <label>
          {t("drafts.role")}
          <select value={role} onChange={(e) => setRole(e.target.value as typeof role)}>
            {(["diagnostic", "guided", "challenge"] as const).map((r) => (
              <option key={r} value={r}>
                {t(`concept.role.${r}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label>
        {t("drafts.explain")}
        <textarea value={explanation} onChange={(e) => setExplanation(e.target.value)} rows={2} />
      </label>

      {needsHand && (
        <label className="choice" style={{ cursor: "pointer" }}>
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          {t("drafts.iChecked")}
        </label>
      )}
      <p>
        <button className="btn btn-sm" disabled={busy} onClick={() => void save()}>
          {t("drafts.save")}
        </button>{" "}
        <button className="btn btn-primary" disabled={busy || check.status === "failed" || (needsHand && !confirmed)} onClick={() => void act(() => api(`/question-drafts/${draft.id}/review`, { method: "POST", body: { decision: "approve", ...(needsHand ? { checkedByHand: true } : {}) } }))}>
          {t("drafts.approve")}
        </button>{" "}
        <button className="btn btn-danger" disabled={busy} onClick={() => void act(() => api(`/question-drafts/${draft.id}/review`, { method: "POST", body: { decision: "reject" } }))}>
          {t("drafts.reject")}
        </button>
      </p>
      {error && <Banner tone="err"><p>{error}</p></Banner>}
    </article>
  );
}

function ResourceDraftCard({ draft, onChanged }: { draft: DraftResourceDto; onChanged: () => void }) {
  const { t } = useTranslation();
  const [title, setTitle] = useState(draft.title);
  const [summary, setSummary] = useState(draft.content.summary);
  const [steps, setSteps] = useState(draft.content.steps.join("\n"));
  const [problem, setProblem] = useState(draft.content.workedExample?.problem ?? "");
  const [exSteps, setExSteps] = useState((draft.content.workedExample?.steps ?? []).join("\n"));
  const [commonError, setCommonError] = useState(draft.content.commonError ?? "");
  const [prompt, setPrompt] = useState(draft.content.prompt ?? "");
  const [confirmed, setConfirmed] = useState(false);
  const [check, setCheck] = useState(draft.check);
  const { error, busy, act } = useDraftAction(onChanged);

  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);
  const body = () => ({
    title,
    content: {
      summary,
      steps: lines(steps),
      workedExample: problem.trim() ? { problem: problem.trim(), steps: lines(exSteps) } : null,
      commonError: commonError.trim() || null,
      prompt: prompt.trim() || null,
    },
  });
  const save = () =>
    act(async () => {
      const r = await api<DraftResourceDto>(`/resource-drafts/${draft.id}`, { method: "PATCH", body: body() });
      setCheck(r.check);
    });

  return (
    <article className="q-card" style={{ borderStyle: "dashed", borderColor: "var(--red)" }}>
      <p>
        <strong>{t(`levels.${draft.level}`)}</strong> <span className="chip ai">{t("drafts.badge")}</span> <span className="hint">{draft.provenanceNote}</span>
      </p>
      <CheckBanner check={check} />
      <label>
        {t("drafts.resTitle")}
        <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label>
        {t("drafts.summary")}
        <textarea value={summary} onChange={(e) => setSummary(e.target.value)} rows={2} />
      </label>
      <label>
        {t("drafts.steps")}
        <textarea value={steps} onChange={(e) => setSteps(e.target.value)} rows={4} />
      </label>
      <label>
        {t("drafts.exampleProblem")}
        <input className="input" value={problem} onChange={(e) => setProblem(e.target.value)} />
      </label>
      <label>
        {t("drafts.exampleSteps")}
        <textarea value={exSteps} onChange={(e) => setExSteps(e.target.value)} rows={3} />
      </label>
      <label>
        {t("concept.commonError")}
        <input className="input" value={commonError} onChange={(e) => setCommonError(e.target.value)} />
      </label>
      <label>
        {t("concept.tryThis")}
        <input className="input" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <label className="choice" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
        {t("drafts.iReadIt")}
      </label>
      <p>
        <button className="btn btn-sm" disabled={busy} onClick={() => void save()}>
          {t("drafts.save")}
        </button>{" "}
        <button className="btn btn-primary" disabled={busy || check.status === "failed" || !confirmed} onClick={() => void act(() => api(`/resource-drafts/${draft.id}/review`, { method: "POST", body: { decision: "approve", checkedByHand: true } }))}>
          {t("drafts.approve")}
        </button>{" "}
        <button className="btn btn-danger" disabled={busy} onClick={() => void act(() => api(`/resource-drafts/${draft.id}/review`, { method: "POST", body: { decision: "reject" } }))}>
          {t("drafts.reject")}
        </button>
      </p>
      {error && <Banner tone="err"><p>{error}</p></Banner>}
    </article>
  );
}
