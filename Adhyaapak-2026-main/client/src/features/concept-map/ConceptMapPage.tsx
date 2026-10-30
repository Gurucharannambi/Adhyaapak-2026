import { useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { ChapterDto, ClassMisconceptionsResponse, ConceptDetailDto, ConceptSummaryDto, CurriculumVersionDto, LearningMapResponse } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { EmptyState, Icon, MarginNote, PageHead, StatusMark } from "../../components/ui";
import { useApi } from "../../hooks/useApi";
import { followUps, nodeFacts, placeNodes } from "./conceptMapModel";
import "./concept-map.css";

const NODE_W = 210;
const NODE_H = 92;
const GAP_X = 70;
const GAP_Y = 26;

/**
 * The class's concept map: the chapter's ideas laid out by what builds on what, each with what this class's recorded
 * answers show. Selecting an idea opens its detail: definition, links, lessons, evidence, patterns and follow-ups.
 * Every statement comes from stored records; nothing here ranks students.
 */
export function ConceptMapPage() {
  const { classId } = useParams();
  const [params, setParams] = useSearchParams();
  const curricula = useApi<{ curricula: CurriculumVersionDto[] }>("/curriculum");
  const cvId = curricula.data?.curricula[0]?.id;
  const chapters = useApi<{ chapters: ChapterDto[] }>(cvId ? `/curriculum/${cvId}/chapters` : null);
  const chapterId = params.get("chapter") ?? chapters.data?.chapters[0]?.id;
  const concepts = useApi<{ concepts: ConceptSummaryDto[] }>(chapterId ? `/chapters/${chapterId}/concepts` : null);
  const map = useApi<LearningMapResponse>(`/classes/${classId}/learning-map`);
  const patterns = useApi<ClassMisconceptionsResponse>(`/classes/${classId}/misconceptions`);
  const selected = params.get("concept");
  const lesson = params.get("lesson");
  const step = params.get("step");

  const back = lesson ? `/classes/${classId}/lessons/${lesson}${step ? `?step=${step}` : ""}` : `/classes/${classId}`;
  const select = (id: string | null) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      if (id) n.set("concept", id);
      else n.delete("concept");
      return n;
    }, { replace: true });

  return (
    <>
      <PageHead
        eyebrow="Concept map"
        title="What builds on what, and where this class is"
        lede="Arrows run from an earlier idea to the idea that builds on it. The marks show what recorded answers say; they describe the class's evidence and never rank a student."
        back={
          <Link className="back" to={back}>
            <Icon name="back" /> <span>{lesson ? "Back to the lesson" : "Class"}</span>
          </Link>
        }
      />
      {chapters.data && chapters.data.chapters.length > 1 && (
        <div className="field" style={{ maxWidth: 320 }}>
          <label htmlFor="cm-chapter">Chapter</label>
          <select id="cm-chapter" value={chapterId ?? ""} onChange={(e) => setParams({ chapter: e.target.value }, { replace: true })}>
            {chapters.data.chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.order}. {c.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <AsyncView state={concepts}>
        {(c) =>
          c.concepts.length === 0 ? (
            <EmptyState title="This chapter has no concepts yet." />
          ) : (
            <MapBody classId={classId!} concepts={c.concepts} map={map.data} patterns={patterns.data} selected={selected} onSelect={select} lesson={lesson} step={step} />
          )
        }
      </AsyncView>
    </>
  );
}

function MapBody({ classId, concepts, map, patterns, selected, onSelect, lesson, step }: { classId: string; concepts: ConceptSummaryDto[]; map: LearningMapResponse | undefined; patterns: ClassMisconceptionsResponse | undefined; selected: string | null; onSelect: (id: string | null) => void; lesson: string | null; step: string | null }) {
  const [zoom, setZoom] = useState(1);
  const frame = useRef<HTMLDivElement>(null);
  const pos = useMemo(() => placeNodes(concepts.map((c) => ({ id: c.id, prerequisiteIds: c.prerequisiteIds }))), [concepts]);
  const cols = Math.max(...[...pos.values()].map((p) => p.col)) + 1;
  const rows = Math.max(...[...pos.values()].map((p) => p.row)) + 1;
  const width = cols * NODE_W + (cols - 1) * GAP_X;
  const height = rows * NODE_H + (rows - 1) * GAP_Y;
  const at = (id: string) => {
    const p = pos.get(id)!;
    return { x: p.col * (NODE_W + GAP_X), y: p.row * (NODE_H + GAP_Y) };
  };
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const classSize = map?.students.length ?? 0;
  const countsOf = (id: string) => map?.concepts.find((m) => m.id === id)?.counts;
  const edges = concepts.flatMap((c) => c.prerequisiteIds.filter((p) => byId.has(p)).map((p) => ({ from: p, to: c.id })));

  const fit = () => {
    const w = frame.current?.clientWidth ?? width;
    setZoom(Math.max(0.4, Math.min(1.4, (w - 24) / width)));
  };

  return (
    <div className="cm">
      <section className="cm-canvas" aria-label="Concept graph">
        <div className="cm-tools" role="group" aria-label="Map view">
          <button type="button" className="btn btn-sm" onClick={() => setZoom((z) => Math.min(1.6, +(z + 0.2).toFixed(2)))} aria-label="Zoom in">+</button>
          <button type="button" className="btn btn-sm" onClick={() => setZoom((z) => Math.max(0.4, +(z - 0.2).toFixed(2)))} aria-label="Zoom out">−</button>
          <button type="button" className="btn btn-sm" onClick={fit}>Fit to view</button>
          <button type="button" className="btn btn-sm" onClick={() => setZoom(1)}>Reset</button>
          <span className="hint" aria-live="polite">{Math.round(zoom * 100)}%</span>
        </div>
        <div className="cm-frame" ref={frame} tabIndex={0} aria-label="Scrollable map. Use the arrow keys to move around.">
          <div className="cm-plane" style={{ width: width * zoom, height: height * zoom }}>
            <div className="cm-scale" style={{ width, height, transform: `scale(${zoom})` }}>
              <svg className="cm-edges" width={width} height={height} aria-hidden="true">
                <defs>
                  <marker id="cm-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                    <path d="M0 0L10 5L0 10z" fill="currentColor" />
                  </marker>
                </defs>
                {edges.map((e) => {
                  const a = at(e.from);
                  const b = at(e.to);
                  const x1 = a.x + NODE_W;
                  const y1 = a.y + NODE_H / 2;
                  const x2 = b.x;
                  const y2 = b.y + NODE_H / 2;
                  const mx = (x1 + x2) / 2;
                  const on = selected === e.from || selected === e.to;
                  return <path key={`${e.from}-${e.to}`} d={`M${x1} ${y1}C${mx} ${y1},${mx} ${y2},${x2 - 3} ${y2}`} className={on ? "cm-edge is-on" : "cm-edge"} markerEnd="url(#cm-arrow)" />;
                })}
              </svg>
              {concepts.map((c) => {
                const p = at(c.id);
                const facts = nodeFacts(countsOf(c.id), classSize);
                const top = facts.present[0];
                return (
                  <button
                    key={c.id}
                    type="button"
                    className={selected === c.id ? "cm-node is-selected" : "cm-node"}
                    style={{ left: p.x, top: p.y, width: NODE_W, height: NODE_H }}
                    aria-pressed={selected === c.id}
                    onClick={() => onSelect(selected === c.id ? null : c.id)}
                  >
                    <span className="cm-node-title">{c.title}</span>
                    {facts.quiet ? <StatusMark status="not_enough_evidence" /> : top ? <StatusMark status={top.status} words={`${facts.present.map((x) => `${x.count} ${x.status.replace(/_/g, " ")}`).join(" · ")}`} /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <p className="hint">Marks use shape and words, not colour alone. Showing the evidence this class has recorded for each idea.</p>
      </section>

      <aside className="cm-detail" aria-label="Concept detail" aria-live="polite">
        {selected && byId.has(selected) ? (
          <Detail key={selected} classId={classId} concept={byId.get(selected)!} facts={nodeFacts(countsOf(selected), classSize)} patterns={patterns?.patterns.filter((x) => x.conceptId === selected) ?? []} onSelect={onSelect} lesson={lesson} step={step} />
        ) : (
          <>
            <h2 style={{ marginTop: 0, fontSize: "var(--fs-m)" }}>Choose an idea</h2>
            <p className="muted">Select a box to see its definition, what it builds on, the lessons, this class's evidence and ways to follow up.</p>
          </>
        )}
      </aside>
    </div>
  );
}

function Detail({ classId, concept, facts, patterns, onSelect, lesson, step }: { classId: string; concept: ConceptSummaryDto; facts: ReturnType<typeof nodeFacts>; patterns: ClassMisconceptionsResponse["patterns"]; onSelect: (id: string | null) => void; lesson: string | null; step: string | null }) {
  const detail = useApi<ConceptDetailDto>(`/concepts/${concept.id}`);
  return (
    <AsyncView state={detail}>
      {(d) => {
        const steps = followUps({ facts, prerequisites: d.prerequisites, patterns: patterns.map((p) => ({ name: p.name, studentCount: p.studentCount })) });
        const lessonQuery = lesson ? `?lesson=${lesson}${step ? `&step=${step}` : ""}` : "";
        return (
          <>
            <h2 style={{ marginTop: 0, fontSize: "var(--fs-l)" }}>{d.title}</h2>
            <p>{d.description}</p>
            <p>
              <strong>Learning objective:</strong> {d.learningObjective}
            </p>

            <h3>Builds on</h3>
            {d.prerequisites.length === 0 ? <p className="muted">Nothing earlier in this chapter.</p> : <ul className="plain rule-list">{d.prerequisites.map((p) => <li key={p.id}><button className="btn btn-link" onClick={() => onSelect(p.id)}>{p.title}</button></li>)}</ul>}
            <h3>Leads to</h3>
            {d.dependents.length === 0 ? <p className="muted">Nothing later in this chapter.</p> : <ul className="plain rule-list">{d.dependents.map((p) => <li key={p.id}><button className="btn btn-link" onClick={() => onSelect(p.id)}>{p.title}</button></li>)}</ul>}

            <h3>This class's evidence</h3>
            {facts.quiet ? (
              <p>
                <span className="chip">Not enough evidence</span> No student has enough recorded answers on this idea to describe it yet. One or two answers are kept but not judged.
              </p>
            ) : (
              <>
                <p className="muted">
                  {facts.withEvidence} of {facts.classSize} students have enough recorded answers on this idea to describe it.
                </p>
                <ul className="plain">
                  {facts.present.map((p) => (
                    <li key={p.status}>
                      <StatusMark status={p.status} /> <span className="muted">· {p.count} {p.count === 1 ? "student" : "students"}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {patterns.length > 0 && (
              <>
                <h3>Answer patterns seen</h3>
                <ul>
                  {patterns.map((p) => (
                    <li key={p.patternId}>
                      {p.name}: {p.studentCount} {p.studentCount === 1 ? "student" : "students"}
                    </li>
                  ))}
                </ul>
                <MarginNote>Provisional: a pattern is a possibility until you confirm it.</MarginNote>
              </>
            )}
            <p>
              <Link to={`/classes/${classId}/map`}>See the answers behind this on the class map →</Link>
            </p>

            <h3>Lesson</h3>
            <p>
              <Link className="btn btn-sm" to={`/classes/${classId}/lessons/${d.id}`}>
                Open the lesson
              </Link>
            </p>

            <h3>Ways to follow up</h3>
            {steps.length === 0 ? (
              <p className="muted">{facts.quiet ? "There is not enough evidence to suggest a follow-up yet." : "The evidence does not point to a follow-up for this idea."}</p>
            ) : (
              <ul className="plain rule-list">
                {steps.map((s) => (
                  <li key={s.label}>
                    {s.conceptId ? <button className="btn btn-link" onClick={() => onSelect(s.conceptId)}>{s.label}</button> : <strong>{s.label}</strong>}
                    <span className="hint" style={{ display: "block" }}>{s.why}</span>
                  </li>
                ))}
              </ul>
            )}
            {lesson && <p className="hint">Opening another idea keeps your place: <Link to={`/classes/${classId}/lessons/${lesson}${step ? `?step=${step}` : ""}`}>back to the lesson</Link> restores it{lessonQuery ? "" : ""}.</p>}
          </>
        );
      }}
    </AsyncView>
  );
}
