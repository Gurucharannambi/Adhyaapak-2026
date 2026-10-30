import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { FractionCanvas } from "../canvas/FractionCanvas";
import type { PresentationResponse, TeachingLevel } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";
import { useBodyClass } from "../../hooks/useBodyClass";
import { Manipulative } from "../curriculum/Manipulative";
import { buildSlides, type Slide } from "./presentation-slides";

/**
 * Projector view. It is fed only by `/concepts/:id/presentation`, which the server limits to teaching
 * content, and it has no access to class data: this component never loads classes, students or results.
 */
export function PresentationPage() {
  const { conceptId } = useParams();
  const state = useApi<PresentationResponse>(`/concepts/${conceptId}/presentation`);
  return (
    <AsyncView state={state}>{(p) => <Deck presentation={p} />}</AsyncView>
  );
}

export function Deck({ presentation }: { presentation: PresentationResponse }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  // A copilot suggestion can open the projector straight at the level it recommends.
  const [params] = useSearchParams();
  const asked = params.get("level");
  const [level, setLevel] = useState<TeachingLevel>(() => presentation.levels.find((l) => l.level === asked)?.level ?? presentation.levels[0]?.level ?? "foundation");
  const [index, setIndex] = useState(0);
  const [whiteboard, setWhiteboard] = useState(false);
  useBodyClass("chalk", ...(whiteboard ? ["theme-white"] : []));
  const slides = useMemo(() => buildSlides(presentation, level), [presentation, level]);
  const last = slides.length - 1;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " " || e.key === "PageDown") {
        e.preventDefault();
        setIndex((i) => Math.min(last, i + 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        setIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "Escape") navigate(-1);
      else if (["1", "2", "3"].includes(e.key)) {
        const l = presentation.levels[Number(e.key) - 1];
        if (l) {
          setLevel(l.level);
          setIndex(1);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last, navigate, presentation.levels]);

  const slide = slides[Math.min(index, last)]!;
  return (
    <main>
      <section className="slide" aria-live="polite">
        <SlideView slide={slide} />
      </section>

      <footer className="p-controls">
        <div className="row">
          <button onClick={() => navigate(-1)}>← {t("present.exit")}</button>
          <div className="row" role="group" aria-label={t("concept.levels")}>
            {presentation.levels.map((l, i) => (
              <button
                key={l.level}
                aria-pressed={level === l.level}
                onClick={() => {
                  setLevel(l.level);
                  setIndex(1);
                }}
              >
                {i + 1}. {t(`levels.${l.level}`)}
              </button>
            ))}
          </div>
          <button aria-pressed={whiteboard} onClick={() => setWhiteboard((w) => !w)}>
            {t("present.whiteboard", { defaultValue: "Whiteboard" })}
          </button>
        </div>
        <div className="row">
          <button disabled={index === 0} onClick={() => setIndex((i) => Math.max(0, i - 1))}>
            ← {t("present.back")}
          </button>
          <button disabled={index >= last} onClick={() => setIndex((i) => Math.min(last, i + 1))}>
            {t("present.next")} →
          </button>
          <span aria-live="polite">
            {Math.min(index, last) + 1} / {slides.length}
          </span>
        </div>
        <small>{t("present.keys")}</small>
      </footer>
    </main>
  );
}

function SlideView({ slide }: { slide: Slide }) {
  switch (slide.kind) {
    case "title":
      return (
        <>
          <h1>{slide.title}</h1>
          <p>{slide.objective}</p>
        </>
      );
    case "canvas":
      return <FractionCanvas large persistKey="projector" />;
    case "text":
      return (
        <>
          <h1>{slide.heading}</h1>
          {slide.text && <p>{slide.text}</p>}
          <Manipulative spec={slide.manipulative} large />
        </>
      );
    case "steps":
      return (
        <>
          <h1>{slide.heading}</h1>
          {slide.lead && <p>{slide.lead}</p>}
          <ol>
            {slide.items.slice(0, slide.visible).map((s, i) => (
              <li key={i}>
                {s}
              </li>
            ))}
          </ol>
          <Manipulative spec={slide.manipulative} large />
        </>
      );
    case "question":
      return (
        <>
          <p className="bar-label">
            {slide.number} / {slide.total}
          </p>
          <h1>{slide.stem}</h1>
          <ul className="plain">
            {slide.options.map((o) => (
              <li key={o.id}>
                <strong>{o.id.toUpperCase()}.</strong> {o.text}
              </li>
            ))}
          </ul>
        </>
      );
  }
}
