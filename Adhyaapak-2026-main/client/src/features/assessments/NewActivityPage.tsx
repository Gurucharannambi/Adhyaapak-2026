import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { ChapterDto, ConceptSummaryDto, CurriculumVersionDto, QuestionWithConcept } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";
import { ApiRequestError, api } from "../../services/api";
import { Banner, Icon, PageHead } from "../../components/ui";

type Mode = "diagnostic" | "prerequisite_pulse";

/** Build a short diagnostic or a Prerequisite Pulse: suggest from the approved bank, review, then create. */
export function NewActivityPage() {
  const { t } = useTranslation();
  const { classId } = useParams();
  const navigate = useNavigate();
  const [search] = useSearchParams();

  const curricula = useApi<{ curricula: CurriculumVersionDto[] }>("/curriculum");
  const firstCurriculum = curricula.data?.curricula[0]?.id;
  const chapters = useApi<{ chapters: ChapterDto[] }>(firstCurriculum ? `/curriculum/${firstCurriculum}/chapters` : null);
  const chapterId = chapters.data?.chapters[0]?.id;
  const concepts = useApi<{ concepts: ConceptSummaryDto[] }>(chapterId ? `/chapters/${chapterId}/concepts` : null);

  const [mode, setMode] = useState<Mode>("diagnostic");
  const [picked, setPicked] = useState<string[]>([]);
  const [count, setCount] = useState(3);
  const [suggested, setSuggested] = useState<QuestionWithConcept[]>();
  const [included, setIncluded] = useState<Set<string>>(new Set());
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const list = concepts.data?.concepts ?? [];
  // Arriving from a lesson: start with that concept already chosen.
  const fromLesson = search.get("concept");
  useEffect(() => {
    if (fromLesson && list.some((c) => c.id === fromLesson)) setPicked((p) => (p.length ? p : [fromLesson]));
  }, [fromLesson, concepts.data]);
  const titleOf = (id: string) => list.find((c) => c.id === id)?.title ?? "";

  function toggle(id: string) {
    setSuggested(undefined);
    if (mode === "prerequisite_pulse") return setPicked([id]);
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < 5 ? [...p, id] : p));
  }

  async function suggest() {
    setBusy(true);
    setError(undefined);
    try {
      const body = mode === "diagnostic" ? { mode, conceptIds: picked, count } : { mode, targetConceptId: picked[0], count };
      const r = await api<{ questions: QuestionWithConcept[] }>(`/classes/${classId}/assessments/suggest`, { method: "POST", body });
      setSuggested(r.questions);
      setIncluded(new Set(r.questions.map((q) => q.id)));
      setTitle(mode === "diagnostic" ? t("activity.defaultDiagnosticTitle", { concept: titleOf(picked[0]!) }) : t("activity.defaultPulseTitle", { concept: titleOf(picked[0]!) }));
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!suggested) return;
    setBusy(true);
    setError(undefined);
    try {
      const ids = suggested.filter((q) => included.has(q.id)).map((q) => q.id);
      const r = await api<{ id: string }>(`/classes/${classId}/assessments`, { method: "POST", body: { title, type: mode, questionIds: ids } });
      navigate(`/activities/${r.id}`);
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        title={t("activity.newTitle")}
        back={
          <Link className="back" to={`/classes/${classId}`}>
            <Icon name="back" /> <span>{t("activity.backToClass")}</span>
          </Link>
        }
      />

      <fieldset className="field">
        <legend>{t("activity.kind")}</legend>
        {(["diagnostic", "prerequisite_pulse"] as const).map((m) => (
          <label key={m} className="choice" style={{ cursor: "pointer" }}>
            <input
              type="radio"
              name="mode"
              checked={mode === m}
              onChange={() => {
                setMode(m);
                setPicked([]);
                setSuggested(undefined);
              }}
            />
            <span>
              <strong>{t(`activity.mode.${m}`)}</strong> — {t(`activity.modeHelp.${m}`)}
            </span>
          </label>
        ))}
      </fieldset>

      <AsyncView state={concepts}>
        {() => (
          <fieldset className="field">
            <legend>{mode === "diagnostic" ? t("activity.pickConcepts") : t("activity.pickTopic")}</legend>
            {list.map((c) => (
              <label key={c.id} className="choice" style={{ cursor: "pointer" }}>
                <input type={mode === "diagnostic" ? "checkbox" : "radio"} name="concept" checked={picked.includes(c.id)} onChange={() => toggle(c.id)} />
                {c.title}
              </label>
            ))}
          </fieldset>
        )}
      </AsyncView>

      <div className="field" style={{ maxWidth: 200 }}>
        <label htmlFor="act-count">{t("activity.count")}</label>
        <select
          id="act-count"
          value={count}
          onChange={(e) => {
            setCount(Number(e.target.value));
            setSuggested(undefined);
          }}
        >
          {[2, 3, 4, 5].map((n) => (
            <option key={n}>{n}</option>
          ))}
        </select>
      </div>
      <div className="btn-row">
        <button className="btn btn-primary" disabled={busy || picked.length === 0} onClick={() => void suggest()}>
          {t("activity.suggest")}
        </button>
      </div>
      {error && <Banner tone="err"><p>{error}</p></Banner>}

      {suggested && (
        <section aria-labelledby="sug-h">
          <h2 id="sug-h">{t("activity.review")}</h2>
          {suggested.length === 0 && <div className="state-empty"><p>{t("activity.noQuestions")}</p></div>}
          {suggested.map((q) => (
            <article key={q.id} className="q-card">
              <label className="choice" style={{ cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={included.has(q.id)}
                  onChange={() =>
                    setIncluded((s) => {
                      const n = new Set(s);
                      if (n.has(q.id)) n.delete(q.id);
                      else n.add(q.id);
                      return n;
                    })
                  }
                />
                <strong>{q.stem}</strong>
              </label>
              <small>
                {q.conceptTitle} · {t("concept.difficulty", { n: q.difficulty })}
              </small>
              <ul className="plain">
                {q.options.map((o) => (
                  <li key={o.id}>
                    {o.id.toUpperCase()}. {o.text}
                    {o.id === q.correctOptionId && <strong> ✓ {t("concept.correct")}</strong>}
                  </li>
                ))}
              </ul>
            </article>
          ))}
          {suggested.length > 0 && (
            <>
              <div className="field">
                <label htmlFor="act-title">{t("activity.title")}</label>
                <input className="input" id="act-title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="btn-row">
                <button className="btn btn-primary" disabled={busy || included.size === 0 || !title.trim()} onClick={() => void create()}>
                  {t("activity.create", { count: included.size })}
                </button>
              </div>
            </>
          )}
        </section>
      )}
    </>
  );
}
