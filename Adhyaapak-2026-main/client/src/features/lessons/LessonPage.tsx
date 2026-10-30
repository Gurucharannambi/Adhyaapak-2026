import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams, useSearchParams } from "react-router";
import type { LessonResponse, LessonRunDto, QuestionWithConcept, TeachingLevel } from "@adhyaapak/shared";
import { AsyncView } from "../../components/AsyncView";
import { useApi } from "../../hooks/useApi";
import { ApiRequestError, api } from "../../services/api";
import { Banner, Chip, EmptyState, Icon, StatusGlyph } from "../../components/ui";
import { ResourceView } from "../curriculum/ResourceView";
import { FractionCanvas } from "../canvas/FractionCanvas";
import { CopilotPanel } from "./copilot/CopilotPanel";
import { RailDrawer } from "./copilot/RailDrawer";
import { PollPanel } from "./polls/PollPanel";
import { CheckStep } from "./steps/CheckStep";
import { PrepareStep } from "./steps/PrepareStep";
import { WrapStep } from "./steps/WrapStep";

type Step = "prepare" | "teach" | "check" | "wrap";
const STEPS: Step[] = ["prepare", "teach", "check", "wrap"];

const LEVELS: TeachingLevel[] = ["foundation", "guided", "challenge"];
type PrintMode = "worksheet" | "key" | null;

/**
 * One period, in four steps: Prepare, Teach, Check, Wrap up. The step shown follows where the period really is
 * (from the lesson run), and the teacher can move between steps freely. The Teach step is the lesson workspace:
 * a five-part flow, the three-level switcher per segment, private class insight and printable material.
 */
export function LessonPage() {
  const { t } = useTranslation();
  const { classId, conceptId } = useParams();
  const state = useApi<LessonResponse>(`/classes/${classId}/lessons/${conceptId}`);
  const runState = useApi<LessonRunDto>(`/classes/${classId}/lessons/${conceptId}/run`);
  const [params, setParams] = useSearchParams();
  const [print, setPrint] = useState<PrintMode>(null);
  const [error, setError] = useState<string>();
  const [starting, setStarting] = useState(false);
  // One drawer at a time: the copilot or the quick poll.
  const [drawer, setDrawer] = useState<"copilot" | "poll" | null>(null);
  const rail = drawer === "copilot";
  // Stable, because the drawer re-runs its focus handling whenever onClose changes.
  const closeDrawer = useCallback(() => setDrawer(null), []);

  const run = runState.data;
  const derived: Step = !run || run.state === "not_started" ? "prepare" : run.state === "teaching" ? "teach" : run.state === "checking" || run.state === "paused" ? "check" : "wrap";
  const step: Step = STEPS.find((s) => s === params.get("step")) ?? derived;
  const go = (s: Step) => setParams({ step: s }, { replace: true });

  async function startLesson() {
    setStarting(true);
    try {
      await api(`/classes/${classId}/lessons/${conceptId}/run`, { method: "POST" });
      runState.reload();
      go("teach");
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    } finally {
      setStarting(false);
    }
  }

  // The browser's print dialog needs the print-only block rendered first.
  useEffect(() => {
    if (!print) return;
    const id = setTimeout(() => {
      window.print();
      setPrint(null);
    }, 80);
    return () => clearTimeout(id);
  }, [print]);

  async function toggleTaught(taught: boolean) {
    setError(undefined);
    try {
      await api(`/classes/${classId}/lessons/${conceptId}/taught`, { method: "PUT", body: { taught } });
      state.reload();
    } catch (e) {
      setError(e instanceof ApiRequestError ? e.message : t("common.unexpectedError"));
    }
  }

  if (runState.loading && !runState.data && !params.get("step")) {
    return (
      <p className="state-loading" role="status">
        {t("common.loading")}
      </p>
    );
  }

  return (
    <AsyncView state={state}>
      {(lesson) => {
        const byId = new Map(lesson.questions.map((q) => [q.id, q]));
        const qs = (ids: string[]) => ids.map((id) => byId.get(id)).filter((q): q is QuestionWithConcept => !!q);
        const totalMinutes = lesson.flow.reduce((n, s) => n + s.minutes, 0);
        const worksheet = lesson.flow.flatMap((s) => qs(s.questionIds));

        return (
          <>
            <div className="no-print">
              <header className="lesson-head">
                <div className="lesson-head-row">
                  <Link className="back" to={`/classes/${classId}`} style={{ margin: 0, minHeight: 0 }}>
                    <Icon name="back" /> <span>{t("activity.backToClass")}</span>
                  </Link>
                  <h1 className="lesson-title">{lesson.concept.title}</h1>
                </div>
                <p className="lesson-objective">
                  <strong>{t("concept.objective")}:</strong> {lesson.concept.learningObjective}
                </p>
              </header>
              <div className="lesson-bar">
                <div className="lesson-bar-row">
                <ol className="life" aria-label={t("run.steps", { defaultValue: "Lesson steps" })} style={{ margin: 0 }}>
                  {STEPS.map((s, i) => (
                    <li key={s} aria-current={step === s ? "step" : undefined} className={STEPS.indexOf(step) > i ? "done" : undefined}>
                      <button style={{ color: "inherit", font: "inherit", minHeight: 0, padding: 0, background: "none", border: 0, cursor: "pointer" }} onClick={() => go(s)}>
                        {i + 1}. {t(`run.step.${s}`, { defaultValue: { prepare: "Prepare", teach: "Teach", check: "Check", wrap: "Wrap up" }[s] })}
                      </button>
                    </li>
                  ))}
                </ol>
                <div className="command-bar" role="toolbar" aria-label={t("run.tools", { defaultValue: "Classroom tools" })}>
                  <button type="button" className="btn btn-sm" aria-expanded={rail} onClick={() => setDrawer((d) => (d === "copilot" ? null : "copilot"))}>
                    {t("run.copilot", { defaultValue: "Copilot" })}
                  </button>
                  <button type="button" className="btn btn-sm" aria-expanded={drawer === "poll"} onClick={() => setDrawer((d) => (d === "poll" ? null : "poll"))}>
                    {t("run.poll", { defaultValue: "Quick poll" })}
                  </button>
                  <Link className="btn btn-sm" to={`/classes/${classId}/concept-map?lesson=${lesson.concept.id}&step=${step}&concept=${lesson.concept.id}`}>
                    {t("run.conceptMap", { defaultValue: "Concept map" })}
                  </Link>
                  <Link className="btn btn-sm" to={`/present/${lesson.concept.id}`}>
                    {t("run.projector", { defaultValue: "Projector" })}
                  </Link>
                </div>
                </div>
              </div>
              <RailDrawer open={rail} onClose={closeDrawer} title={t("run.copilot", { defaultValue: "Copilot" })}>
                <CopilotPanel classId={classId!} lesson={lesson} reloadKey={`${run?.state ?? "none"}-${run?.assessmentId ?? ""}`} />
              </RailDrawer>
              <RailDrawer open={drawer === "poll"} onClose={closeDrawer} title={t("run.poll", { defaultValue: "Quick poll" })}>
                <PollPanel classId={classId!} conceptId={lesson.concept.id} />
              </RailDrawer>
              {step === "teach" && (lesson.chapter.summary || lesson.chapter.keyIdeas.length > 0) && (
                <details className="slim-details">
                  <summary>
                    {t("lesson.fromTextbook")} · {t("lesson.chapterLine", { n: lesson.chapter.order, title: lesson.chapter.title })}
                  </summary>
                  {lesson.chapter.summary && <p>{lesson.chapter.summary}</p>}
                  {lesson.chapter.keyIdeas.length > 0 && (
                    <ul>
                      {lesson.chapter.keyIdeas.map((k) => (
                        <li key={k}>{k}</li>
                      ))}
                    </ul>
                  )}
                </details>
              )}
              {error && <Banner tone="err"><p>{error}</p></Banner>}

              {step === "prepare" && <PrepareStep classId={classId!} lesson={lesson} onPrint={setPrint} onStart={() => void startLesson()} starting={starting} onCheckStarted={() => { runState.reload(); go("check"); }} />}
              {step === "check" && run && <CheckStep classId={classId!} lesson={lesson} run={run} onRunChanged={runState.reload} onGo={go} />}
              {step === "check" && !run && <p className="state-loading" role="status">{t("common.loading")}</p>}
              {step === "wrap" && run && <WrapStep classId={classId!} conceptId={lesson.concept.id} run={run} onRunChanged={runState.reload} lesson={lesson} />}

              {step === "teach" && (
              <>
              {lesson.concept.key === "equivalent-fractions" && (
                <section aria-labelledby="canvas-h" style={{ marginBottom: "var(--s5)" }}>
                  <h2 id="canvas-h" style={{ marginTop: 0, fontSize: "var(--fs-l)" }}>{t("run.canvas", { defaultValue: "Interactive canvas" })}</h2>
                  <FractionCanvas persistKey={`${classId}:${lesson.concept.id}`} />
                </section>
              )}
              <div className="lesson-grid">
                <section aria-labelledby="flow-h">
                  <h2 id="flow-h" style={{ marginTop: 0, fontSize: "var(--fs-l)" }}>{t("lesson.flow", { minutes: totalMinutes })}</h2>
                  <ol className="plan">
                    {lesson.flow.map((seg, i) => (
                      <Segment key={seg.key} index={i + 1} seg={seg} lesson={lesson} questions={qs(seg.questionIds)} classId={classId!} />
                    ))}
                  </ol>
                </section>

                <aside aria-labelledby="ins-h" className="aside-private">
                  <nav aria-label={t("run.jump", { defaultValue: "Jump to a part of the lesson" })}>
                    <p className="mono eyebrow" style={{ marginBottom: "var(--s2)" }}>{t("run.timeline", { defaultValue: "Lesson timeline" })}</p>
                    <ol className="plain timeline">
                      {lesson.flow.map((seg, i) => (
                        <li key={seg.key}>
                          <a href={`#seg-${seg.key}`}>
                            <span className="timeline-n">{i + 1}</span>
                            <span>{t(`lesson.seg.${seg.key}`)}</span>
                            <span className="hint">{t("lesson.minutes", { count: seg.minutes })}</span>
                          </a>
                        </li>
                      ))}
                    </ol>
                  </nav>
                  <div className="btn-row" style={{ margin: "var(--s3) 0" }}>
                    <Link className="btn btn-sm" to={`/present/${lesson.concept.id}`}>{t("lesson.present")}</Link>
                    <button className="btn btn-sm" onClick={() => setPrint("worksheet")}>{t("lesson.printWorksheet")}</button>
                    <button className="btn btn-sm" onClick={() => setPrint("key")}>{t("lesson.printKey")}</button>
                  </div>
                  <hr />
                  <h2 id="ins-h" style={{ fontSize: "var(--fs-m)", marginTop: 0 }}>
                    {t("lesson.insights")}
                  </h2>
                  <p>
                    <span className="chip private"><Icon name="lock" /> {t("lesson.privateNote")}</span>
                  </p>
                  {lesson.insights.counts.not_enough_evidence === lesson.insights.studentCount ? (
                    <p>{t("lesson.noInsights")}</p>
                  ) : (
                    <ul className="plain rule-list">
                      {(Object.keys(lesson.insights.counts) as Array<keyof typeof lesson.insights.counts>)
                        .filter((s) => lesson.insights.counts[s] > 0)
                        .map((s) => (
                          <li key={s}>
                            <StatusGlyph status={s} size={15} /> {lesson.insights.counts[s]} {t(`status.${s}`).toLowerCase()}
                          </li>
                        ))}
                    </ul>
                  )}
                  {lesson.insights.patterns.map((p) => (
                    <p key={p.name}>
                      ⚑ {p.name} ({t("lesson.studentsCount", { count: p.studentCount })})
                    </p>
                  ))}
                  <p>
                    <Link to={`/classes/${classId}/map`}>{t("map.open")}</Link>
                    <br />
                    <Link to={`/classes/${classId}/branch-board?concept=${lesson.concept.id}`}>{t("board.open")}</Link>
                  </p>
                  {lesson.taught ? (
                    <p>
                      <Chip tone="ok">✓ {t("lesson.taughtOn", { date: new Date(lesson.taught.at).toLocaleDateString() })}</Chip>{" "}
                      <button className="btn btn-sm" onClick={() => void toggleTaught(false)}>{t("lesson.unmark")}</button>
                    </p>
                  ) : (
                    <button className="btn btn-sm" onClick={() => void toggleTaught(true)}>{t("lesson.markTaught")}</button>
                  )}
                </aside>
              </div>
              <div className="btn-row step-bar">
                <button className="btn" onClick={() => go("prepare")}>← {t("run.step.prepare", { defaultValue: "Prepare" })}</button>
                <button className="btn btn-primary" onClick={() => go("check")}>{t("run.teach.toCheck", { defaultValue: "Start the 2-minute check" })} →</button>
              </div>
              </>
              )}
            </div>

            {print === "worksheet" && (
              <div className="print-only">
                <h1>{lesson.concept.title}</h1>
                <p>
                  {t("lesson.nameLine")}: ______________________ {t("lesson.dateLine")}: ____________
                </p>
                <ol>
                  {worksheet.map((q) => (
                    <li key={q.id} style={{ marginBottom: "1.2rem", pageBreakInside: "avoid" }}>
                      <p>{q.stem}</p>
                      <p>{q.options.map((o) => `${o.id.toUpperCase()}. ${o.text}`).join("      ")}</p>
                      <p>{t("lesson.answerLine")}: ________</p>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {print === "key" && (
              <div className="print-only">
                <h1>
                  {lesson.concept.title} — {t("lesson.keyTitle")}
                </h1>
                <p>{t("lesson.keyNote")}</p>
                <ol>
                  {worksheet.map((q) => (
                    <li key={q.id} style={{ marginBottom: "0.8rem" }}>
                      <p>
                        {q.stem} <strong>{q.correctOptionId.toUpperCase()}</strong> — {q.options.find((o) => o.id === q.correctOptionId)?.text}
                      </p>
                      <small>{q.explanation}</small>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </>
        );
      }}
    </AsyncView>
  );
}

function Segment({ index, seg, lesson, questions, classId }: { index: number; seg: LessonResponse["flow"][number]; lesson: LessonResponse; questions: QuestionWithConcept[]; classId: string }) {
  const { t } = useTranslation();
  // Each segment has its own teaching level: a way of teaching this part, not a label for any student.
  const [level, setLevel] = useState<TeachingLevel>("guided");
  const [shown, setShown] = useState<Set<string>>(new Set());
  const switchable = seg.key === "teach" || seg.key === "practise";
  const resource = lesson.concept.resources.find((r) => r.level === level);

  const visible = seg.key === "practise" ? questions.filter((q) => (level === "challenge" ? q.role === "challenge" : q.role === "guided")) : questions;

  const body = (
    <>
      {seg.key === "teach" && (resource ? <ResourceView resource={resource} /> : <EmptyState title={t("concept.noResource")} />)}

      {seg.key !== "teach" && visible.length === 0 && <p>{seg.key === "practise" && questions.length > 0 ? t("lesson.noneAtLevel") : t("lesson.noQuestion")}</p>}

      {seg.key !== "teach" &&
        visible.map((q) => (
          <article key={q.id} className="q-card">
            <h4>{q.stem}</h4>
            <ul className="plain">
              {q.options.map((o) => (
                <li key={o.id}>
                  {o.id.toUpperCase()}. {o.text}
                  {shown.has(q.id) && o.id === q.correctOptionId && <strong> ✓</strong>}
                </li>
              ))}
            </ul>
            <button className="btn"
              onClick={() =>
                setShown((s) => {
                  const n = new Set(s);
                  if (n.has(q.id)) n.delete(q.id);
                  else n.add(q.id);
                  return n;
                })
              }
            >
              {shown.has(q.id) ? t("lesson.hideAnswer") : t("lesson.showAnswer")}
            </button>
            {shown.has(q.id) && (
              <p>
                <small>{q.explanation}</small>
              </p>
            )}
          </article>
        ))}

      {seg.key === "check" && questions.length > 0 && (
        <p>
          <Link to={`/classes/${classId}/activities/new?concept=${lesson.concept.id}`}>{t("lesson.runCheck")} →</Link>
        </p>
      )}
    </>
  );

  return (
    <li id={`seg-${seg.key}`}>
      <h3>
        <span className="sr-only">{index}. </span>
        {t(`lesson.seg.${seg.key}`)} <span className="mins">({t("lesson.minutes", { count: seg.minutes })})</span>
      </h3>
      <p className="hint">{t(`lesson.segHelp.${seg.key}`)}</p>

      {switchable && (
        <>
          <div className="tabs" role="tablist" aria-label={t("concept.levels")}>
            {LEVELS.map((l) => (
              <button className="tab" key={l} role="tab" aria-selected={level === l} onClick={() => setLevel(l)}>
                {t(`levels.${l}`)}
              </button>
            ))}
          </div>
          <div className="tabpanel" role="tabpanel">
            {body}
          </div>
        </>
      )}
      {!switchable && body}

    </li>
  );
}
