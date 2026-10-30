export interface Frac {
  n: number;
  d: number;
}

export type Verification = { status: "verified" | "failed" | "not_applicable"; issues: string[] };

/** Parses "3/4", "2 1/3" (mixed) or "5". Returns undefined for anything else. Keeps the numbers as written. */
export function parseFraction(text: string): Frac | undefined {
  const t = text.normalize("NFKC").replace(/[⁄∕]/g, "/").trim();
  let m = /^(\d+)\s+(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m) {
    const whole = Number(m[1]);
    const d = Number(m[3]);
    return { n: whole * d + Number(m[2]), d };
  }
  m = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (m) return { n: Number(m[1]), d: Number(m[2]) };
  m = /^(\d+)$/.exec(t);
  if (m) return { n: Number(m[1]), d: 1 };
  return undefined;
}

const sameValue = (a: Frac, b: Frac) => a.d !== 0 && b.d !== 0 && a.n * b.d === b.n * a.d;
const sameWritten = (a: Frac, b: Frac) => a.n === b.n && a.d === b.d;

export interface QuestionLike {
  stem: string;
  options: Array<{ text: string; misconceptionKey?: string | null }>;
  correctIndex: number;
}

/**
 * Checks "a/b + c/d = ?" and "a/b − c/d = ?" questions with plain arithmetic, so the app does not have
 * to take the model's word for the answer or for what a wrong option represents:
 *  - the marked answer must equal the true result, and no other option may equal it;
 *  - an option tagged with a known error pattern must really be what that error produces
 *    (adds-denominators → (a+c)/(b+d); subtracts-denominators → (a−c)/(b−d);
 *     combines-tops-multiplies-bottoms → (a+c)/(b×d)).
 * Other question shapes return "not_applicable": the teacher must check those by eye.
 */
export function verifyFractionArithmetic(q: QuestionLike): Verification {
  const cmp = verifyComparison(q);
  if (cmp) return cmp;
  const equiv = verifyEquivalence(q);
  if (equiv) return equiv;
  const m = /^\s*(\d+)\s*\/\s*(\d+)\s*([+\-−–])\s*(\d+)\s*\/\s*(\d+)\s*=\s*\?\s*$/.exec(q.stem.normalize("NFKC"));
  if (!m) return { status: "not_applicable", issues: [] };

  const [a, b, c, d] = [Number(m[1]), Number(m[2]), Number(m[4]), Number(m[5])] as const;
  const add = m[3] === "+";
  const issues: string[] = [];
  if (b === 0 || d === 0) return { status: "failed", issues: ["The question has a zero denominator."] };

  // True value, kept exact as a fraction.
  const truth: Frac = add ? { n: a * d + c * b, d: b * d } : { n: a * d - c * b, d: b * d };
  if (truth.n < 0) issues.push("The result would be negative, which is not suitable for Class 6.");

  const parsed = q.options.map((o) => parseFraction(o.text));
  const correct = parsed[q.correctIndex];
  if (!correct) issues.push("The marked answer is not a fraction we can check.");
  else if (!sameValue(correct, truth)) issues.push(`The marked answer is wrong: ${a}/${b} ${add ? "+" : "−"} ${c}/${d} is not ${q.options[q.correctIndex]!.text}.`);

  parsed.forEach((p, i) => {
    if (i !== q.correctIndex && p && sameValue(p, truth)) issues.push(`Option ${String.fromCharCode(65 + i)} is also a correct answer.`);
  });

  const expectedFor: Record<string, { frac: Frac; ops: ("+" | "-")[] }> = {
    "adds-denominators": { frac: { n: a + c, d: b + d }, ops: ["+"] },
    "subtracts-denominators": { frac: { n: a - c, d: b - d }, ops: ["-"] },
    "combines-tops-multiplies-bottoms": { frac: { n: a + c, d: b * d }, ops: ["+"] },
  };
  q.options.forEach((o, i) => {
    if (!o.misconceptionKey || i === q.correctIndex) return;
    const rule = expectedFor[o.misconceptionKey];
    if (!rule) return; // A pattern this checker does not know: left to the teacher.
    const opChar: "+" | "-" = add ? "+" : "-";
    if (!rule.ops.includes(opChar)) {
      issues.push(`Option ${String.fromCharCode(65 + i)} is tagged "${o.misconceptionKey}", which does not apply to ${add ? "addition" : "subtraction"}.`);
      return;
    }
    const p = parsed[i];
    // A zero denominator ("3/0") is what the error really produces, so compare as written there.
    const ok = p && (rule.frac.d === 0 ? sameWritten(p, rule.frac) : sameValue(p, rule.frac) || sameWritten(p, rule.frac));
    if (!ok) issues.push(`Option ${String.fromCharCode(65 + i)} is tagged "${o.misconceptionKey}" but is not what that mistake gives (${rule.frac.n}/${rule.frac.d}).`);
  });

  return { status: issues.length ? "failed" : "verified", issues };
}

/**
 * Checks "Which fraction is equivalent to a/b?" and "Which of these is NOT equivalent to a/b?":
 *  - exactly one option may fit the question (one equivalent option, or exactly one that is not);
 *  - the marked answer must be that option;
 *  - "adds-same-number-to-both" must be (a+k)/(b+k) for some k, and "multiplies-numerator-only" must be (a×m)/b.
 */
function verifyEquivalence(q: QuestionLike): Verification | undefined {
  const m = /^\s*which\b[^?]*?\b(not\s+)?equivalent\s+to\s+(\d+)\s*\/\s*(\d+)\s*\??\s*$/i.exec(q.stem.normalize("NFKC"));
  if (!m) return undefined;
  const wantNot = !!m[1];
  const base: Frac = { n: Number(m[2]), d: Number(m[3]) };
  if (base.d === 0) return { status: "failed", issues: ["The question has a zero denominator."] };

  const issues: string[] = [];
  const parsed = q.options.map((o) => parseFraction(o.text));
  parsed.forEach((p, i) => {
    if (!p) issues.push(`Option ${String.fromCharCode(65 + i)} is not a fraction we can check.`);
  });
  if (issues.length) return { status: "failed", issues };

  const fits = parsed.map((p) => (wantNot ? !sameValue(p!, base) : sameValue(p!, base)));
  const fitting = fits.filter(Boolean).length;
  if (fitting !== 1) issues.push(wantNot ? `Exactly one option should be NOT equivalent to ${base.n}/${base.d}, but ${fitting} are.` : `Exactly one option should be equivalent to ${base.n}/${base.d}, but ${fitting} are.`);
  else if (!fits[q.correctIndex]) issues.push(`The marked answer is wrong: ${q.options[fits.indexOf(true)]!.text} is the one that fits.`);

  q.options.forEach((o, i) => {
    if (!o.misconceptionKey || i === q.correctIndex) return;
    const p = parsed[i]!;
    const letter = String.fromCharCode(65 + i);
    if (o.misconceptionKey === "adds-same-number-to-both") {
      const ok = Array.from({ length: 30 }, (_, k) => k + 1).some((k) => p.n === base.n + k && p.d === base.d + k);
      if (!ok) issues.push(`Option ${letter} is tagged "adds-same-number-to-both" but is not (${base.n}+k)/(${base.d}+k) for any whole k.`);
    } else if (o.misconceptionKey === "multiplies-numerator-only") {
      const ok = p.d === base.d && p.n > base.n && p.n % base.n === 0;
      if (!ok) issues.push(`Option ${letter} is tagged "multiplies-numerator-only" but is not the numerator multiplied with the denominator unchanged.`);
    }
  });
  return { status: issues.length ? "failed" : "verified", issues };
}

/**
 * Checks "Which is greater: a/b or c/d?" (also larger / smaller / less) questions:
 *  - the marked answer must be the right fraction (or an "equal" option when the two are equal);
 *  - a question about two equal fractions cannot name one of them as the answer;
 *  - an option tagged "bigger-denominator-bigger" must be the fraction with the larger denominator, and must not be the answer.
 * Returns undefined when the stem is not this shape.
 */
function verifyComparison(q: QuestionLike): Verification | undefined {
  const m = /^\s*which\s+is\s+(greater|larger|bigger|smaller|less)\s*(?:than)?\s*:?\s*(\d+)\s*\/\s*(\d+)\s+or\s+(\d+)\s*\/\s*(\d+)\s*\??\s*$/i.exec(q.stem.normalize("NFKC"));
  if (!m) return undefined;
  const wantBigger = /^(greater|larger|bigger)$/i.test(m[1]!);
  const x: Frac = { n: Number(m[2]), d: Number(m[3]) };
  const y: Frac = { n: Number(m[4]), d: Number(m[5]) };
  if (x.d === 0 || y.d === 0) return { status: "failed", issues: ["The question has a zero denominator."] };

  const issues: string[] = [];
  const cross = x.n * y.d - y.n * x.d; // sign tells which is bigger
  const answerText = q.options[q.correctIndex]?.text ?? "";
  const answerFrac = parseFraction(answerText);
  const saysEqual = /\b(equal|the same)\b/i.test(answerText) && !/\bunequal\b/i.test(answerText);

  if (cross === 0) {
    if (!saysEqual) issues.push(`${m[2]}/${m[3]} and ${m[4]}/${m[5]} are equal, so no fraction can be the answer.`);
  } else {
    const winner = (cross > 0) === wantBigger ? x : y;
    if (!answerFrac || !sameValue(answerFrac, winner)) issues.push(`The marked answer is wrong: the ${wantBigger ? "greater" : "smaller"} fraction is ${winner.n}/${winner.d}.`);
    q.options.forEach((o, i) => {
      if (i === q.correctIndex) return;
      const p = parseFraction(o.text);
      if (p && sameValue(p, winner)) issues.push(`Option ${String.fromCharCode(65 + i)} is also a correct answer.`);
    });
  }

  q.options.forEach((o, i) => {
    if (o.misconceptionKey !== "bigger-denominator-bigger" || i === q.correctIndex) return;
    const p = parseFraction(o.text);
    const largerDen = x.d === y.d ? undefined : x.d > y.d ? x : y;
    if (!p || !largerDen || !sameValue(p, largerDen)) issues.push(`Option ${String.fromCharCode(65 + i)} is tagged "bigger-denominator-bigger" but is not the fraction with the larger denominator.`);
  });
  return { status: issues.length ? "failed" : "verified", issues };
}
