import { useEffect, useReducer, useState } from "react";
import { type CanvasState, EXERCISES, INITIAL, LIMITS, answerOf, check, equivalentsOf, maxMultiplier, multipliersFor, reduce, scale, show, stepsFor, validate, type Exercise, type Fraction, type Invalid } from "./fraction-model";
import { FractionBar, FractionCircle, type Focus } from "./FractionDiagrams";
import "./canvas.css";

const loadSaved = (key: string): CanvasState | null => {
  try {
    const raw = sessionStorage.getItem(`adhyaapak.canvas.${key}`);
    if (!raw) return null;
    const s = JSON.parse(raw) as CanvasState;
    return validate(s.base).ok && Number.isInteger(s.k) && s.k >= 1 && s.k <= maxMultiplier(s.base) ? { ...s, revealed: Math.max(0, Math.min(s.revealed, stepsFor(s.base, s.k).length)), history: Array.isArray(s.history) ? s.history : [] } : null;
  } catch {
    return null;
  }
};
const save = (key: string, s: CanvasState) => {
  try {
    sessionStorage.setItem(`adhyaapak.canvas.${key}`, JSON.stringify(s));
  } catch {
    // storage unavailable: the canvas simply starts fresh next time
  }
};

const WHY: Record<Invalid["reason"], string> = {
  not_whole: "Use whole numbers.",
  denominator_small: "The bottom number must be at least 1: a whole cannot be cut into 0 parts.",
  denominator_large: `The canvas shows at most ${LIMITS.maxD} equal parts.`,
  numerator_negative: "The top number cannot be negative here.",
  numerator_large: "Keep the top no larger than the bottom, so the fraction stays within one whole.",
};

/**
 * The equivalent-fractions canvas. One explicit model (fraction-model.ts) drives the bar, the circle, the explanation steps
 * and the questions, so changing the fraction updates every picture together and nothing depends on animation state.
 * `large` is for the projector.
 */
export function FractionCanvas({ large = false, persistKey }: { large?: boolean; persistKey?: string }) {
  const [state, dispatchRaw] = useReducer(reduce, INITIAL, (init) => (persistKey ? loadSaved(persistKey) ?? init : init));
  // Only a screen preference, never a record: the canvas is remembered for this tab so leaving the lesson for the
  // concept map and coming back does not reset what the teacher was showing.
  const dispatch: typeof dispatchRaw = (a) => dispatchRaw(a);
  useEffect(() => {
    if (persistKey) save(persistKey, state);
  }, [persistKey, state]);
  const [view, setView] = useState<"both" | "bars" | "circles">("both");
  const [focus, setFocus] = useState<Focus>("none");
  const [mode, setMode] = useState<"explore" | "practice" | "challenge">("explore");
  const [draft, setDraft] = useState<{ n: string; d: string }>({ n: "1", d: "2" });
  const [problem, setProblem] = useState<Invalid["reason"]>();

  const { base, k } = state;
  const eq = scale(base, k);
  const steps = stepsFor(base, k);

  /** Teacher types or steps a fraction. Invalid input is explained, not silently ignored. */
  function tryBase(n: number, d: number) {
    const v = validate({ n, d });
    if (!v.ok) return setProblem(v.reason);
    setProblem(undefined);
    dispatch({ type: "setBase", base: { n, d } });
    setDraft({ n: String(n), d: String(d) });
  }
  const typed = (key: "n" | "d", value: string) => {
    setDraft((x) => ({ ...x, [key]: value }));
    const n = Number(key === "n" ? value : draft.n);
    const d = Number(key === "d" ? value : draft.d);
    if (value.trim() === "") return;
    tryBase(n, d);
    if (!validate({ n, d }).ok) setDraft((x) => ({ ...x, [key]: value }));
  };

  const dimOriginal = focus === "equivalent";
  const dimEquivalent = focus === "original";
  const match = focus === "match";

  return (
    <section className={large ? "fc fc-large" : "fc"} aria-label="Equivalent fractions canvas">
      <div className="fc-stage" data-focus={focus}>
        {view !== "circles" && (
          <div className="fc-row">
            <p className="fc-caption">{show(base)}</p>
            <FractionBar f={base} label={`Bar showing ${base.n} of ${base.d} equal parts shaded`} dim={dimOriginal} outline={match} />
          </div>
        )}
        {view !== "circles" && (
          <div className="fc-row">
            <p className="fc-caption">{show(eq)}</p>
            <FractionBar f={eq} label={`Bar showing ${eq.n} of ${eq.d} equal parts shaded`} dim={dimEquivalent} outline={match} />
          </div>
        )}
        {view !== "bars" && (
          <div className="fc-circles">
            <FractionCircle f={base} label={`Circle showing ${base.n} of ${base.d} equal slices shaded`} dim={dimOriginal} outline={match} />
            <span className="fc-equals" aria-hidden="true">=</span>
            <FractionCircle f={eq} label={`Circle showing ${eq.n} of ${eq.d} equal slices shaded`} dim={dimEquivalent} outline={match} />
          </div>
        )}
        <p className="fc-equation" aria-live="polite">
          {show(base)} = {show(eq)}
        </p>
      </div>

      <div className="fc-controls" role="group" aria-label="Fraction controls">
        <fieldset className="fc-fieldset">
          <legend>Fraction</legend>
          <div className="fc-fraction-input">
            <Stepper label="top number" value={draft.n} onChange={(v) => typed("n", v)} onStep={(by) => tryBase(base.n + by, base.d)} />
            <span className="fc-bar" aria-hidden="true" />
            <Stepper label="bottom number" value={draft.d} onChange={(v) => typed("d", v)} onStep={(by) => tryBase(base.n, base.d + by)} />
          </div>
          {problem && (
            <p className="field-err" role="alert">
              <span>{WHY[problem]}</span>
            </p>
          )}
        </fieldset>

        <fieldset className="fc-fieldset">
          <legend>Multiply top and bottom by</legend>
          <div className="fc-chips" role="radiogroup" aria-label="Multiplier">
            {multipliersFor(base).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={k === m} className={k === m ? "fc-chip is-on" : "fc-chip"} onClick={() => dispatch({ type: "setMultiplier", k: m })}>
                × {m}
              </button>
            ))}
          </div>
          <p className="hint">
            {maxMultiplier(base) < LIMITS.maxMultiplier ? `Larger multipliers would need more than ${LIMITS.maxD} parts.` : `Up to × ${LIMITS.maxMultiplier}.`} Same fractions on this canvas: {equivalentsOf(base).map(show).join(", ")}.
          </p>
        </fieldset>

        <fieldset className="fc-fieldset">
          <legend>Show</legend>
          <div className="fc-chips" role="radiogroup" aria-label="Pictures">
            {(["both", "bars", "circles"] as const).map((v) => (
              <button key={v} type="button" role="radio" aria-checked={view === v} className={view === v ? "fc-chip is-on" : "fc-chip"} onClick={() => setView(v)}>
                {v === "both" ? "Bars and circles" : v === "bars" ? "Bars" : "Circles"}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="fc-fieldset">
          <legend>Focus the class</legend>
          <div className="fc-chips" role="radiogroup" aria-label="Spotlight">
            {([["none", "Off"], ["original", "The start"], ["equivalent", "The new name"], ["match", "Same shaded amount"]] as const).map(([v, label]) => (
              <button key={v} type="button" role="radio" aria-checked={focus === v} className={focus === v ? "fc-chip is-on" : "fc-chip"} onClick={() => setFocus(v)}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <div className="fc-actions">
          <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: "undo" })} disabled={state.history.length === 0}>
            Undo
          </button>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => {
              dispatch({ type: "reset" });
              setDraft({ n: "1", d: "2" });
              setProblem(undefined);
              setFocus("none");
            }}
          >
            Reset
          </button>
        </div>
      </div>

      <div className="fc-tabs tabs" role="tablist" aria-label="Canvas mode">
        {(["explore", "practice", "challenge"] as const).map((m) => (
          <button key={m} type="button" role="tab" className="tab" aria-selected={mode === m} onClick={() => setMode(m)}>
            {m === "explore" ? "Explain" : m === "practice" ? "Practice" : "Challenge"}
          </button>
        ))}
      </div>

      {mode === "explore" ? (
        <div className="fc-panel" role="tabpanel">
          <ol className="fc-steps" aria-label="Explanation, revealed one step at a time">
            {steps.slice(0, state.revealed).map((s, i) => (
              <li key={`${base.n}-${base.d}-${k}-${i}`} className="fc-step">
                {s}
              </li>
            ))}
          </ol>
          {state.revealed === 0 && <p className="muted">The explanation is hidden. Reveal it one step at a time.</p>}
          <div className="btn-row" style={{ margin: 0 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => dispatch({ type: "revealNext" })} disabled={state.revealed >= steps.length}>
              {state.revealed === 0 ? "Reveal the first step" : "Reveal the next step"}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => dispatch({ type: "hideSteps" })} disabled={state.revealed === 0}>
              Hide the explanation
            </button>
            <span className="hint">
              {state.revealed} of {steps.length}
            </span>
          </div>
        </div>
      ) : (
        <ExercisePanel level={mode} />
      )}
    </section>
  );
}

function Stepper({ label, value, onChange, onStep }: { label: string; value: string; onChange: (v: string) => void; onStep: (by: number) => void }) {
  return (
    <div className="fc-stepper">
      <button type="button" className="btn btn-sm" aria-label={`Decrease the ${label}`} onClick={() => onStep(-1)}>
        −
      </button>
      <input className="input" inputMode="numeric" aria-label={`The ${label}`} value={value} onChange={(e) => onChange(e.target.value)} />
      <button type="button" className="btn btn-sm" aria-label={`Increase the ${label}`} onClick={() => onStep(1)}>
        +
      </button>
    </div>
  );
}

/** Questions generated from the model: each answer is checked by equivalence, hints come one at a time, the answer only on request. */
function ExercisePanel({ level }: { level: Exercise["level"] }) {
  const list = EXERCISES.filter((e) => e.level === level);
  const [index, setIndex] = useState(0);
  const [value, setValue] = useState("");
  const [hints, setHints] = useState(0);
  const [verdict, setVerdict] = useState<ReturnType<typeof check>>();
  const [shown, setShown] = useState(false);
  const ex = list[Math.min(index, list.length - 1)]!;
  const reset = (i: number) => {
    setIndex(i);
    setValue("");
    setHints(0);
    setVerdict(undefined);
    setShown(false);
  };
  const from: Fraction = ex.from;
  return (
    <div className="fc-panel" role="tabpanel">
      <p className="mono eyebrow" style={{ marginBottom: "var(--s2)" }}>
        {level === "practice" ? "Practice" : "Challenge"} · {Math.min(index, list.length - 1) + 1} of {list.length}
      </p>
      <p className="fc-prompt">
        Fill in the missing {ex.ask}: <strong>{ex.prompt}</strong>
      </p>
      <form
        className="fc-answer"
        onSubmit={(e) => {
          e.preventDefault();
          setVerdict(check(ex, value));
        }}
      >
        <label htmlFor={`ex-${ex.id}`} className="sr-only">
          Your answer
        </label>
        <input id={`ex-${ex.id}`} className="input" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} aria-describedby="ex-feedback" />
        <button type="submit" className="btn btn-primary btn-sm">
          Check
        </button>
      </form>
      <p id="ex-feedback" role="status" className={verdict?.status === "correct" ? "fc-ok" : verdict ? "fc-bad" : "hint"}>
        {verdict ? verdict.message : `Start from ${show(from)}.`}
      </p>
      {hints > 0 && (
        <ol className="fc-hints" aria-label="Hints">
          {ex.hints.slice(0, hints).map((h) => (
            <li key={h}>{h}</li>
          ))}
        </ol>
      )}
      <div className="btn-row" style={{ margin: 0 }}>
        <button type="button" className="btn btn-sm" onClick={() => setHints((h) => Math.min(3, h + 1))} disabled={hints >= 3}>
          {hints === 0 ? "Give a hint" : "Another hint"}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setShown(true)} disabled={shown}>
          Show the answer
        </button>
        <button type="button" className="btn btn-sm" onClick={() => reset(index + 1 < list.length ? index + 1 : 0)}>
          Next question
        </button>
      </div>
      {shown && (
        <p className="fc-reveal">
          Answer: <strong>{answerOf(ex)}</strong>. {show(from)} = {ex.ask === "numerator" ? `${answerOf(ex)}/${ex.given}` : `${ex.given}/${answerOf(ex)}`}.
        </p>
      )}
    </div>
  );
}
