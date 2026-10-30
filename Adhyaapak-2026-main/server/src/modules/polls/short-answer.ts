import type { PollDto } from "@adhyaapak/shared";
import { parseFraction, type Frac } from "../ai/verify-arithmetic";

/**
 * Grouping of typed answers, deterministic and explainable. Two answers share a group when they are the same number
 * (2/4, 1/2 and 0.5 are one group) or, for anything that is not a number, the same words ignoring case and spacing.
 * Nothing here guesses: an answer that cannot be read as a number is grouped by its text only.
 */

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

/** A number written as a whole number, fraction, mixed number or decimal, reduced. Undefined when it is not one. */
export function valueOf(text: string): Frac | undefined {
  const t = text.normalize("NFKC").trim();
  const dec = /^(\d*)\.(\d+)$/.exec(t);
  const f = dec ? { n: Number(`${dec[1] || "0"}${dec[2]}`), d: 10 ** dec[2]!.length } : parseFraction(t);
  if (!f || f.d === 0) return undefined;
  const g = gcd(f.n, f.d) || 1;
  return { n: f.n / g, d: f.d / g };
}

const textKey = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const keyOf = (s: string) => {
  const v = valueOf(s);
  return v ? `#${v.n}/${v.d}` : `t:${textKey(s)}`;
};
const tidy = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ");

/** Groups answers, most common first; ties keep the order the answers first arrived. */
export function groupAnswers(answers: string[], expected: string | null): PollDto["answers"] {
  const expectedKey = expected ? keyOf(expected) : null;
  const groups = new Map<string, { forms: Map<string, number>; count: number; first: number }>();
  answers.forEach((raw, i) => {
    const key = keyOf(raw);
    const g = groups.get(key) ?? { forms: new Map<string, number>(), count: 0, first: i };
    const form = tidy(raw);
    g.forms.set(form, (g.forms.get(form) ?? 0) + 1);
    g.count += 1;
    groups.set(key, g);
  });
  return [...groups.entries()]
    .sort(([, a], [, b]) => b.count - a.count || a.first - b.first)
    .map(([key, g]) => {
      // The label is the most common way it was written; the other ways are listed so nothing is hidden.
      const forms = [...g.forms.entries()].sort((a, b) => b[1] - a[1]);
      return { label: forms[0]![0], variants: forms.slice(1).map(([f]) => f), count: g.count, matches: expectedKey === null ? null : key === expectedKey };
    });
}
