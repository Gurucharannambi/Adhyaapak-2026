/**
 * The mathematics of the equivalent-fractions canvas, written down explicitly and kept free of anything visual.
 * Every picture, step and question is derived from these functions, so what the class sees is correct by construction
 * rather than because an animation happened to line up.
 */

export interface Fraction {
  n: number;
  d: number;
}

/** What the canvas allows. Parts up to 12 stay readable on a projector; proper fractions keep one whole in view. */
export const LIMITS = { minD: 1, maxD: 12, maxMultiplier: 6 } as const;

export type Invalid = { ok: false; reason: "not_whole" | "denominator_small" | "denominator_large" | "numerator_negative" | "numerator_large" };
export type Valid = { ok: true };

export const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

/** Checks a fraction typed or stepped by the teacher. Returns why it is not allowed, in a form the interface can explain. */
export function validate(f: { n: number; d: number }): Valid | Invalid {
  if (!Number.isInteger(f.n) || !Number.isInteger(f.d)) return { ok: false, reason: "not_whole" };
  if (f.d < LIMITS.minD) return { ok: false, reason: "denominator_small" };
  if (f.d > LIMITS.maxD) return { ok: false, reason: "denominator_large" };
  if (f.n < 0) return { ok: false, reason: "numerator_negative" };
  if (f.n > f.d) return { ok: false, reason: "numerator_large" };
  return { ok: true };
}

export const simplify = (f: Fraction): Fraction => {
  const g = gcd(f.n, f.d) || 1;
  return { n: f.n / g, d: f.d / g };
};

/** Two fractions name the same amount exactly when their cross products match. No decimals, so no rounding. */
export const equivalent = (a: Fraction, b: Fraction): boolean => a.n * b.d === b.n * a.d;

export const compare = (a: Fraction, b: Fraction): -1 | 0 | 1 => {
  const x = a.n * b.d;
  const y = b.n * a.d;
  return x < y ? -1 : x > y ? 1 : 0;
};

/** The fraction after cutting every part into `k` equal pieces: top and bottom both multiplied by k. */
export const scale = (f: Fraction, k: number): Fraction => ({ n: f.n * k, d: f.d * k });

/** The largest multiplier the canvas can show for this fraction (the new denominator must stay within the limit). */
export const maxMultiplier = (f: Fraction): number => Math.max(1, Math.min(LIMITS.maxMultiplier, Math.floor(LIMITS.maxD / f.d)));

/** Multipliers that keep the equivalent fraction on the canvas. */
export const multipliersFor = (f: Fraction): number[] => Array.from({ length: maxMultiplier(f) }, (_, i) => i + 1);

/** All fractions equal to `f` that fit the canvas, smallest denominator first. */
export function equivalentsOf(f: Fraction): Fraction[] {
  const out: Fraction[] = [];
  for (let d = LIMITS.minD; d <= LIMITS.maxD; d++) {
    const n = (f.n * d) / f.d;
    if (Number.isInteger(n) && n <= d) out.push({ n, d });
  }
  return out;
}

export const show = (f: Fraction): string => `${f.n}/${f.d}`;

/**
 * The worked explanation for "multiply top and bottom by k", one claim per step. Each step states something that is
 * true of the model, so revealing them in order always tells a correct story.
 */
export function stepsFor(f: Fraction, k: number): string[] {
  const g = scale(f, k);
  const steps = [`Start with ${show(f)}: the whole is cut into ${f.d} equal parts and ${f.n === 1 ? "1 of them is" : `${f.n} of them are`} shaded.`];
  if (k === 1) return [...steps, "Choose a multiplier above to cut every part into smaller equal pieces."];
  return [
    ...steps,
    `Cut every part into ${k} equal pieces. The whole now has ${f.d} × ${k} = ${g.d} parts.`,
    `The shaded amount has not changed. It is now ${f.n} × ${k} = ${g.n} of the ${g.d} parts.`,
    `So ${show(f)} = ${show(g)}. Same amount, a different name.`,
    `Rule: multiply the top and the bottom by the same number (${k}) and the fraction stays equal.`,
  ];
}

// --- exercises -----------------------------------------------------------------------------------------------

export interface Exercise {
  id: string;
  level: "practice" | "challenge";
  prompt: string;
  from: Fraction;
  /** What the learner fills in. */
  ask: "numerator" | "denominator";
  /** The other number of the target fraction, given in the prompt. */
  given: number;
  hints: [string, string, string];
}

export const EXERCISES: Exercise[] = [
  { id: "p1", level: "practice", prompt: "1/2 = ?/4", from: { n: 1, d: 2 }, ask: "numerator", given: 4, hints: ["Look at the bottom numbers: 2 became 4.", "What did you multiply 2 by to get 4?", "Do the same to the top: 1 × 2 = ?"] },
  { id: "p2", level: "practice", prompt: "2/3 = ?/9", from: { n: 2, d: 3 }, ask: "numerator", given: 9, hints: ["Compare the bottom numbers: 3 and 9.", "3 × 3 = 9, so the multiplier is 3.", "Multiply the top by 3 as well: 2 × 3 = ?"] },
  { id: "p3", level: "practice", prompt: "3/4 = 9/?", from: { n: 3, d: 4 }, ask: "denominator", given: 9, hints: ["Compare the top numbers: 3 and 9.", "3 × 3 = 9, so the multiplier is 3.", "Multiply the bottom by 3: 4 × 3 = ?"] },
  { id: "c1", level: "challenge", prompt: "5/6 = ?/12", from: { n: 5, d: 6 }, ask: "numerator", given: 12, hints: ["How many times does 6 fit into 12?", "The multiplier is 2.", "5 × 2 = ?"] },
  { id: "c2", level: "challenge", prompt: "4/10 = 2/?", from: { n: 4, d: 10 }, ask: "denominator", given: 2, hints: ["This time the top got smaller: 4 became 2.", "4 ÷ 2 = 2, so divide the bottom by 2 too.", "10 ÷ 2 = ?"] },
];

export type Verdict = { status: "invalid"; message: string } | { status: "correct"; message: string } | { status: "wrong"; message: string };

/** Judges an answer by the model (cross-multiplication), never by comparing to a stored string. */
export function check(ex: Exercise, raw: string): Verdict {
  const text = raw.trim();
  if (text === "") return { status: "invalid", message: "Type a whole number." };
  if (!/^\d+$/.test(text)) return { status: "invalid", message: "Use a whole number, like 6." };
  const value = Number(text);
  if (ex.ask === "denominator" && value === 0) return { status: "invalid", message: "The bottom of a fraction cannot be 0." };
  const target: Fraction = ex.ask === "numerator" ? { n: value, d: ex.given } : { n: ex.given, d: value };
  if (equivalent(ex.from, target)) return { status: "correct", message: `Yes: ${show(ex.from)} = ${show(target)}.` };
  return { status: "wrong", message: `Not yet: ${show(target)} is not the same amount as ${show(ex.from)}.` };
}

/** The answer to an exercise, derived from the model, shown only when the teacher reveals it. */
export function answerOf(ex: Exercise): number {
  return ex.ask === "numerator" ? (ex.from.n * ex.given) / ex.from.d : (ex.from.d * ex.given) / ex.from.n;
}

// --- canvas state ----------------------------------------------------------------------------------------------

export interface CanvasState {
  base: Fraction;
  k: number;
  /** How many explanation steps the teacher has revealed. */
  revealed: number;
  history: Array<{ base: Fraction; k: number }>;
}

export type CanvasAction =
  | { type: "setBase"; base: Fraction }
  | { type: "setMultiplier"; k: number }
  | { type: "revealNext" }
  | { type: "hideSteps" }
  | { type: "undo" }
  | { type: "reset" };

export const INITIAL: CanvasState = { base: { n: 1, d: 2 }, k: 2, revealed: 0, history: [] };

/** All changes go through here, so the same inputs always give the same canvas, and undo is exact. */
export function reduce(s: CanvasState, a: CanvasAction): CanvasState {
  const remember = { history: [...s.history, { base: s.base, k: s.k }].slice(-20) };
  switch (a.type) {
    case "setBase": {
      if (!validate(a.base).ok) return s;
      const k = Math.min(s.k, maxMultiplier(a.base));
      return { ...s, ...remember, base: a.base, k, revealed: 0 };
    }
    case "setMultiplier":
      if (!Number.isInteger(a.k) || a.k < 1 || a.k > maxMultiplier(s.base)) return s;
      return { ...s, ...remember, k: a.k, revealed: 0 };
    case "revealNext":
      return { ...s, revealed: Math.min(stepsFor(s.base, s.k).length, s.revealed + 1) };
    case "hideSteps":
      return { ...s, revealed: 0 };
    case "undo": {
      const prev = s.history[s.history.length - 1];
      return prev ? { ...s, base: prev.base, k: prev.k, revealed: 0, history: s.history.slice(0, -1) } : s;
    }
    case "reset":
      return INITIAL;
  }
}
