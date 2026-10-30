import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { ChapterDto, ConceptSummaryDto, CurriculumVersionDto } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";
import { PageHead } from "../../components/ui";

export function CurriculumPage() {
  const { t } = useTranslation();
  const state = useApi<{ curricula: CurriculumVersionDto[] }>("/curriculum");
  return (
    <>
      <PageHead title={t("textbook.title")} lede={t("textbook.lede")} eyebrow={t("curriculum.title")} />
      <AsyncView state={state}>
        {(d) =>
          d.curricula.length === 0 ? (
            <div className="state-empty"><p>{t("curriculum.empty")}</p></div>
          ) : (
            d.curricula.map((c) => <CurriculumBlock key={c.id} curriculum={c} />)
          )
        }
      </AsyncView>
      <section className="panel" aria-labelledby="own-h">
        <h2 id="own-h" style={{ marginTop: 0, fontSize: "var(--fs-m)" }}>{t("textbook.ownSyllabusTitle")}</h2>
        <p>{t("textbook.ownSyllabusBody")}</p>
        <Link className="btn btn-sm" to="/syllabus">{t("textbook.ownSyllabusLink")}</Link>
      </section>
    </>
  );
}

function CurriculumBlock({ curriculum }: { curriculum: CurriculumVersionDto }) {
  const { t } = useTranslation();
  const chapters = useApi<{ chapters: ChapterDto[] }>(`/curriculum/${curriculum.id}/chapters`);
  return (
    <section>
      <h2 style={{ marginTop: 0 }}>{curriculum.title}</h2>
      <p className="muted">
        {t("curriculum.meta", { board: curriculum.board, year: curriculum.academicYear, language: curriculum.language.toUpperCase() })}
      </p>
      <p className="pen">{t("textbook.provenance")}</p>
      <AsyncView state={chapters}>{(d) => d.chapters.map((ch) => <ChapterBlock key={ch.id} chapter={ch} />)}</AsyncView>
    </section>
  );
}

function ChapterBlock({ chapter }: { chapter: ChapterDto }) {
  const { t } = useTranslation();
  const concepts = useApi<{ concepts: ConceptSummaryDto[] }>(`/chapters/${chapter.id}/concepts`);
  return (
    <section className="q-card" style={{ marginTop: "var(--s5)" }}>
      <p className="mono eyebrow" style={{ marginBottom: "var(--s2)" }}>
        {t("curriculum.chapter", { n: chapter.order })} · {t("textbook.lessonCount", { count: chapter.conceptCount })}
      </p>
      <h3 style={{ marginTop: 0, fontSize: "var(--fs-l)" }}>{chapter.title}</h3>
      {chapter.summary && <p>{chapter.summary}</p>}
      {chapter.keyIdeas.length > 0 && (
        <>
          <h4>{t("textbook.keyIdeas")}</h4>
          <ul>
            {chapter.keyIdeas.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        </>
      )}
      <h4>{t("textbook.lessons")}</h4>
      <AsyncView state={concepts}>
        {(d) => {
          const title = new Map(d.concepts.map((c) => [c.id, c.title]));
          return (
            <ol className="rule-list">
              {d.concepts.map((c) => (
                <li key={c.id}>
                  <Link to={`/curriculum/concepts/${c.id}`}>{c.title}</Link>
                  <br />
                  <small>{c.learningObjective}</small>
                  {c.prerequisiteIds.length > 0 && (
                    <>
                      <br />
                      <small>
                        {t("curriculum.needsFirst")}: {c.prerequisiteIds.map((id) => title.get(id)).join(", ")}
                      </small>
                    </>
                  )}
                </li>
              ))}
            </ol>
          );
        }}
      </AsyncView>
    </section>
  );
}
